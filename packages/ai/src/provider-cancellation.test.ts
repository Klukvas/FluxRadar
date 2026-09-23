// Cancellation behaves the same way in every adapter, so it is checked in one
// place: a cancelled run must not start a paid call, and a cancel must not be
// reported as an unavailable provider — that is what decides whether the caller
// retries the question and pays for it a second time.
//
// The last block moves up one level, to a GEO run asking several questions: a
// cancel between two of them must stop the next one and must not damage the
// answer that already arrived.

import { describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from './anthropic-provider.js';
import { AiRequestCancelledError } from './errors.js';
import { GeminiProvider } from './gemini-provider.js';
import { runGeoModule } from './geo-module.js';
import { MockAiProvider } from './mock-provider.js';
import { OpenAiProvider } from './openai-provider.js';
import { PerplexityProvider } from './perplexity-provider.js';
import { geoVisibilityFixtures } from './mock-provider.js';
import {
  BRAND,
  DOMAIN,
  ORIGIN,
  QUESTION_WITH_BRAND,
  QUESTION_WITHOUT_BRAND,
  SCAN_ID,
  makeConsent,
  makeRequest,
} from './testing/harness.js';
import type { AiProvider, AiProviderName, NormalizedAiResponse } from './types.js';

interface AdapterCase {
  readonly name: AiProviderName;
  build(fetcher: typeof fetch): AiProvider;
}

const ADAPTERS: readonly AdapterCase[] = [
  { name: 'anthropic', build: (fetcher) => new AnthropicProvider({ apiKey: 'k', fetcher }) },
  { name: 'openai', build: (fetcher) => new OpenAiProvider({ apiKey: 'k', fetcher }) },
  { name: 'google', build: (fetcher) => new GeminiProvider({ apiKey: 'k', fetcher }) },
  { name: 'perplexity', build: (fetcher) => new PerplexityProvider({ apiKey: 'k', fetcher }) },
];

describe.each(ADAPTERS)('$name adapter cancellation', (adapter) => {
  it('does not call the provider when the caller already cancelled', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = adapter.build(fetcher);
    const controller = new AbortController();
    controller.abort();

    const failure = await provider
      .send(makeRequest({ provider: adapter.name }), 'prompt', controller.signal)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    // A cancel is not a claim about the provider, so it is never the §5 outcome
    // the module is entitled to retry and pay for again.
    expect((failure as Error).name).not.toBe('UnavailableError');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('propagates a mid-flight cancel instead of reporting an unavailable provider', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort(new Error('scan cancelled by the customer'));
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    const provider = adapter.build(fetcher);

    const failure = await provider
      .send(makeRequest({ provider: adapter.name }), 'prompt', controller.signal)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).not.toBe('UnavailableError');
    expect((failure as Error).message).toBe('scan cancelled by the customer');
  });

  it('preserves a cancel that lands while the answer is still downloading', async () => {
    // `fetch` resolves on the headers; the body is a second transfer, and a
    // cancel during it arrives as a rejected `json()` rather than a rejected
    // `fetch`. Reported as "no readable body" it would be a provider outcome
    // the module is entitled to retry — and pay for twice.
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => {
        controller.abort(new Error('scan cancelled by the customer'));
        return Promise.reject(new DOMException('This operation was aborted', 'AbortError'));
      },
    } as unknown as Response);
    const provider = adapter.build(fetcher);

    const failure = await provider
      .send(makeRequest({ provider: adapter.name }), 'prompt', controller.signal)
      .catch((error: unknown) => error);

    expect((failure as Error).name).not.toBe('UnavailableError');
    expect((failure as Error).message).toBe('scan cancelled by the customer');
  });

  it('still reports a timeout as an unavailable provider', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));
    const provider = adapter.build(fetcher);
    const controller = new AbortController();

    await expect(
      provider.send(makeRequest({ provider: adapter.name }), 'prompt', controller.signal),
    ).rejects.toMatchObject({ name: 'UnavailableError' });
  });
});

describe('a run cancelled after the first provider answered', () => {
  /**
   * The seam the core lane's per-response persistence depends on.
   *
   * GEO asks several questions through one provider (and, with routing, through
   * two), one after another. When the scan is cancelled after the first answer,
   * the cancel must stop the next paid request — and the answer that already
   * arrived must reach the caller whole, because that is what the orchestrator
   * persists response by response.
   *
   * A cancelled run therefore RESOLVES with the part it paid for, marked
   * `interrupted`, instead of rejecting: throwing here would discard an answer
   * that exists at the provider and that only an ai_response record can later
   * delete (AI-001).
   */
  it('stops before the next paid question and leaves the first answer intact', async () => {
    const controller = new AbortController();
    const inner = new MockAiProvider(geoVisibilityFixtures(BRAND, DOMAIN));
    const answered: NormalizedAiResponse[] = [];
    const provider: AiProvider = {
      config: inner.config,
      send: async (request, promptText, signal) => {
        const response = await inner.send(request, promptText, signal);
        answered.push(response);
        // The customer cancels in the gap between two questions.
        controller.abort(new Error('scan cancelled by the customer'));
        return response;
      },
    };

    const run = runGeoModule(
      {
        scanId: SCAN_ID,
        plan: 'Complete',
        brand: BRAND,
        siteOrigin: ORIGIN,
        siteDomain: DOMAIN,
        consent: makeConsent(),
        requests: [
          makeRequest({ sequence: 1, question: QUESTION_WITH_BRAND }),
          makeRequest({ sequence: 2, question: QUESTION_WITHOUT_BRAND }),
        ],
      },
      { provider, signal: controller.signal },
    );

    const result = await run;

    // The second question never left: the cancel was read before the next send.
    expect(answered).toHaveLength(1);
    expect(answered[0]?.rawText).not.toBe('');
    expect(answered[0]?.requestId).not.toBe('');

    // And the answer that was paid for survives the cancel, whole.
    expect(result.interrupted).toBe(true);
    expect(result.status).toBe('Partial');
    expect(result.statusReason).toContain('ScanCancelled');
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0]?.response.rawText).toBe(answered[0]?.rawText);
    expect(result.quota.outstanding).toBe(0);
  });
});

describe('cancellation without an Error reason', () => {
  it('reports a cancelled request rather than the bare reason value', async () => {
    const provider = new MockAiProvider(geoVisibilityFixtures(BRAND, DOMAIN));
    const controller = new AbortController();
    controller.abort('shutting down');

    await expect(provider.send(makeRequest(), 'prompt', controller.signal)).rejects.toBeInstanceOf(
      AiRequestCancelledError,
    );
  });
});
