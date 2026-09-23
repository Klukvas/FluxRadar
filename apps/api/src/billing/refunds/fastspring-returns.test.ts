// Contract tests for `POST /returns`, against the payloads FastSpring's own
// reference documents (developer.fastspring.com — Returns, "Create a return").
//
// Nothing here reaches FastSpring: every case injects a transport. A test that
// actually called the returns API would refund somebody.

import { describe, expect, it, vi } from 'vitest';

import type { FastSpringConfig } from '../fastspring/config.ts';
import {
  fastSpringReasonFor,
  fastSpringReturnsAdapter,
  returnsRequestBody,
} from './fastspring-returns.ts';
import type { RefundSubmission } from './provider.ts';

const CONFIG: FastSpringConfig = {
  mode: 'test',
  liveMode: false,
  apiBaseUrl: 'https://api.fastspring.com',
  apiUsername: 'api-user',
  apiPassword: 'api-password',
  webhookSecret: 'secret',
  sessionApi: 'v2',
  currencyPolicy: 'localized',
  storefrontUrl: null,
  checkoutPath: 'fluxlab/popup-fluxlab',
  popupStorefront: 'fluxlab.test.onfastspring.com/popup-fluxlab',
  productPaths: { Basic: 'fluxradar-basic', Complete: 'fluxradar-complete' },
  sessionExpirationDays: 1,
};

const SUBMISSION: RefundSubmission = {
  providerOrderId: 'abCdE1FGH2Hij3KLMnOpqR',
  amountUsd: 55,
  currency: 'USD',
  reasonCode: 'EXTERNAL_NO_USABLE_OUTPUT',
  idempotencyKey: 'refund-dispatch:purchase-1',
};

/** Verbatim shape from the reference's success sample. */
const SUCCESS = {
  returns: [
    {
      return: 'aBCDE12fGH3iJkL4mNOpqr',
      reference: 'ABC1234567-8910-11121D',
      completed: true,
      totalReturn: 55,
      totalReturnDisplay: '$55.00',
      reason: 'Product Not Received',
      result: 'success',
      action: 'return.create',
    },
  ],
};

/** Verbatim shape from the reference's error sample. */
const REFUSAL = {
  returns: [
    {
      action: 'return.create',
      return: 'AbC1D2eFGH34ijklmnopQrs',
      result: 'error',
      error: {
        product: 'Product path is not found in the original order. Use a valid product path.',
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterWith(fetcher: typeof fetch) {
  return fastSpringReturnsAdapter({ config: CONFIG, fetcher, timeoutMs: 1_000 });
}

describe('the request body', () => {
  it('is the documented returns envelope, full refund, with a documented reason', () => {
    expect(returnsRequestBody(SUBMISSION)).toEqual({
      returns: [
        {
          order: 'abCdE1FGH2Hij3KLMnOpqR',
          reason: 'PRODUCT_NOT_RECEIVED',
          notification: 'ORIGINAL',
          refundType: 'FULL',
        },
      ],
    });
  });

  it('never sends an items list, because only whole-order returns are supported', () => {
    expect(JSON.stringify(returnsRequestBody(SUBMISSION))).not.toContain('items');
  });

  it.each([
    ['PRE_QUEUE_CANCEL', 'PRODUCT_NOT_RECEIVED'],
    ['PLATFORM_FAILURE_AFTER_RETRY', 'PRODUCT_NOT_RECEIVED'],
    ['EXTERNAL_NO_USABLE_OUTPUT', 'PRODUCT_NOT_RECEIVED'],
    ['LEGAL_SUPPORT', 'OTHER'],
  ])('maps the FluxRadar reason %s to the documented %s', (ours, theirs) => {
    expect(fastSpringReasonFor(ours)).toBe(theirs);
  });

  it('maps an unknown reason code to OTHER rather than to a code that misdescribes it', () => {
    // FastSpring's documented behaviour for an unrecognised value is to create
    // the return anyway with reason `None`, silently.
    expect(fastSpringReasonFor('SOMETHING_NEW')).toBe('OTHER');
  });
});

describe('the transport', () => {
  it('posts to /returns with basic auth and JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(SUCCESS));
    await adapterWith(fetcher).submit(SUBMISSION);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.fastspring.com/returns');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('api-user:api-password', 'utf8').toString('base64')}`,
    );
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('never puts a credential in the URL or the body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(SUCCESS));
    await adapterWith(fetcher).submit(SUBMISSION);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).not.toContain('api-password');
    expect(String(init?.body)).not.toContain('api-password');
  });
});

describe('the answer', () => {
  it('reads the documented success payload as submitted, with the return id', async () => {
    const result = await adapterWith(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(SUCCESS)),
    ).submit(SUBMISSION);
    expect(result).toEqual({
      outcome: 'submitted',
      providerRefundId: 'aBCDE12fGH3iJkL4mNOpqr',
      providerReference: 'ABC1234567-8910-11121D',
      completedByProvider: true,
      providerReasonCode: 'PRODUCT_NOT_RECEIVED',
    });
  });

  it.each([200, 400])('reads the documented error payload (HTTP %s) as refused', async (status) => {
    const result = await adapterWith(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(REFUSAL, status)),
    ).submit(SUBMISSION);
    expect(result.outcome).toBe('refused');
    expect(result.outcome === 'refused' && result.reason).toContain('product');
  });

  it('treats a timeout as uncertain, never as failed', async () => {
    const result = await adapterWith(
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('aborted', 'AbortError')),
    ).submit(SUBMISSION);
    // The request may have been executed. "Failed" would invite a retry.
    expect(result.outcome).toBe('uncertain');
  });

  it.each([500, 502, 503])('treats HTTP %s as uncertain', async (status) => {
    const result = await adapterWith(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, status)),
    ).submit(SUBMISSION);
    expect(result.outcome).toBe('uncertain');
  });

  it('treats rejected credentials as refused, because no return was created', async () => {
    const result = await adapterWith(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 })),
    ).submit(SUBMISSION);
    expect(result.outcome).toBe('refused');
  });

  it('treats a body that is not JSON as uncertain', async () => {
    const result = await adapterWith(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('<html>gateway</html>', { status: 200 })),
    ).submit(SUBMISSION);
    expect(result.outcome).toBe('uncertain');
  });

  it('treats a success with no return id as uncertain, not as submitted', async () => {
    const result = await adapterWith(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ returns: [{ result: 'success', completed: true }] })),
    ).submit(SUBMISSION);
    expect(result.outcome).toBe('uncertain');
  });

  it('treats an envelope that is not the documented one as uncertain', async () => {
    const result = await adapterWith(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([{ return: 'r1', result: 'success' }])),
    ).submit(SUBMISSION);
    expect(result.outcome).toBe('uncertain');
  });

  it('submits exactly once per call: the adapter has no retry of its own', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503));
    await adapterWith(fetcher).submit(SUBMISSION);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
