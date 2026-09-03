// Контрактные тесты T-10 для оркестрации запроса (§5): pre-response отказ →
// нет материала ai_response и квота не тронута; retry бесплатен; ошибка
// провайдера освобождает резерв; redaction встроен в pipeline.

import { AI_REQUEST_CAPS } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { AiModuleError } from './errors.js';
import { geoVisibilityFixtures, MockAiProvider } from './mock-provider.js';
import { CHARS_PER_TOKEN } from './prompt-builder.js';
import { AiQuotaTracker } from './quota.js';
import { aiRequestKey } from './request-key.js';
import { runAiRequest } from './run-request.js';
import { BRAND, DOMAIN, makeConsent, makeRequest } from './testing/harness.js';
import type { AiProvider, NormalizedAiResponse } from './types.js';

const fixtures = geoVisibilityFixtures(BRAND, DOMAIN);

/** Провайдер-обёртка со счётчиком обращений: pre-response ветки его не зовут. */
function countingProvider(inner: AiProvider = new MockAiProvider(fixtures)): {
  provider: AiProvider;
  calls: () => number;
} {
  let sendCalls = 0;
  const provider: AiProvider = {
    config: inner.config,
    send: (request, promptText) => {
      sendCalls += 1;
      return inner.send(request, promptText);
    },
  };
  return { provider, calls: () => sendCalls };
}

function baseOptions(provider: AiProvider): {
  provider: AiProvider;
  quota: AiQuotaTracker;
  consent: ReturnType<typeof makeConsent>;
} {
  return { provider, quota: AiQuotaTracker.withLimit(50), consent: makeConsent() };
}

describe('runAiRequest — happy path', () => {
  it('consent → prompt → redaction → reserve → send → commit', async () => {
    const { provider } = countingProvider();
    const result = await runAiRequest(makeRequest(), baseOptions(provider));
    expect(result.outcome.kind).toBe('response');
    if (result.outcome.kind !== 'response') return;
    expect(result.quota.spent).toBe(1);
    expect(result.quota.outstanding).toBe(0);
    // Ключ считается от точного redacted-текста, ушедшего провайдеру (D-015/D-175).
    expect(result.outcome.aiRequestKey).toBe(
      aiRequestKey('scan-t10', 'openai', result.outcome.promptText, 1),
    );
    expect(result.outcome.response.rawText).toContain(BRAND);
  });

  it('retry с тем же ключом не списывает квоту повторно', async () => {
    const { provider } = countingProvider();
    const request = makeRequest();
    const first = await runAiRequest(request, baseOptions(provider));
    const second = await runAiRequest(request, { ...baseOptions(provider), quota: first.quota });
    expect(second.outcome.kind).toBe('response');
    expect(second.quota.spent).toBe(1);
    if (first.outcome.kind === 'response' && second.outcome.kind === 'response') {
      expect(second.outcome.aiRequestKey).toBe(first.outcome.aiRequestKey);
      expect(second.outcome.response).toEqual(first.outcome.response);
    }
  });

  it('redaction-маркеры не выталкивают prompt за input cap (re-cap, D-177)', async () => {
    const { provider } = countingProvider();
    // Prompt усечён до cap, но полон email-ов: каждая замена на [REDACTED:email]
    // длиннее исходного значения и без re-cap выталкивает текст за 8000 tokens.
    const request = makeRequest({
      question: 'What are alternatives to manual website audits?',
      pageTitles: Array.from({ length: 4000 }, (_, index) => `u${index}@x.co`),
    });
    const result = await runAiRequest(request, baseOptions(provider));
    expect(result.outcome.kind).toBe('response');
    if (result.outcome.kind !== 'response') return;
    const charBudget = AI_REQUEST_CAPS.maxInputTokens * CHARS_PER_TOKEN;
    expect(result.outcome.promptText.length).toBeLessThanOrEqual(charBudget);
    expect(result.outcome.inputTruncated).toBe(true);
    // Мок оценивает usage от финального текста — cap контракта §5 соблюдён.
    expect(result.outcome.response.usage.inputTokens).toBeLessThanOrEqual(
      AI_REQUEST_CAPS.maxInputTokens,
    );
    // Ключ считается от финального (re-capped) текста, ушедшего провайдеру.
    expect(result.outcome.aiRequestKey).toBe(
      aiRequestKey('scan-t10', 'openai', result.outcome.promptText, 1),
    );
  });

  it('секреты вырезаются из prompt до отправки, audit — только счётчики', async () => {
    const { provider } = countingProvider();
    const request = makeRequest({
      brandFacts: ['Contact: owner@fluxradar.test', 'Internal API at 10.0.0.5'],
    });
    const result = await runAiRequest(request, baseOptions(provider));
    expect(result.outcome.kind).toBe('response');
    if (result.outcome.kind !== 'response') return;
    expect(result.outcome.promptText).toContain('[REDACTED:email]');
    expect(result.outcome.promptText).toContain('[REDACTED:private-ip]');
    expect(result.outcome.promptText).not.toContain('owner@fluxradar.test');
    expect(result.outcome.redaction.email).toBe(1);
    expect(result.outcome.redaction['private-ip']).toBe(1);
  });
});

describe('runAiRequest — pre-response отказ (без ответа, без списания)', () => {
  it('нет consent → ConsentMissing, провайдер не вызывался', async () => {
    const { provider, calls } = countingProvider();
    const quota = AiQuotaTracker.withLimit(50);
    const result = await runAiRequest(makeRequest(), { provider, quota, consent: null });
    expect(result.outcome).toMatchObject({ kind: 'unavailable', reason: 'ConsentMissing' });
    expect(result.quota).toBe(quota);
    expect(result.quota.spent).toBe(0);
    expect(calls()).toBe(0);
  });

  it('consent чужого скана трактуется как отсутствие записи (§5)', async () => {
    const { provider, calls } = countingProvider();
    const result = await runAiRequest(makeRequest(), {
      ...baseOptions(provider),
      consent: makeConsent({ scanId: 'another-scan' }),
    });
    expect(result.outcome).toMatchObject({ kind: 'unavailable', reason: 'ConsentMissing' });
    expect(calls()).toBe(0);
  });

  it('consent не покрывает провайдера → ConsentMissing', async () => {
    const { provider, calls } = countingProvider();
    const result = await runAiRequest(makeRequest(), {
      ...baseOptions(provider),
      consent: makeConsent({ providers: ['google'] }),
    });
    expect(result.outcome).toMatchObject({ kind: 'unavailable', reason: 'ConsentMissing' });
    expect(calls()).toBe(0);
  });

  it('redaction timeout (fail-closed) → RedactionBlocked, без вызова провайдера', async () => {
    const { provider, calls } = countingProvider();
    let tick = 0;
    const result = await runAiRequest(makeRequest(), {
      ...baseOptions(provider),
      redaction: { now: () => (tick += 3000) },
    });
    expect(result.outcome).toMatchObject({ kind: 'unavailable', reason: 'RedactionBlocked' });
    expect(result.quota.spent).toBe(0);
    expect(result.quota.outstanding).toBe(0);
    expect(calls()).toBe(0);
  });

  it('исчерпанная квота → QuotaExceeded, без вызова провайдера', async () => {
    const { provider, calls } = countingProvider();
    const result = await runAiRequest(makeRequest(), {
      ...baseOptions(provider),
      quota: AiQuotaTracker.withLimit(0),
    });
    expect(result.outcome).toMatchObject({ kind: 'unavailable', reason: 'QuotaExceeded' });
    expect(calls()).toBe(0);
  });
});

describe('runAiRequest — ошибки провайдера', () => {
  it('UnavailableError → освобождение резерва (spent 0, outstanding 0)', async () => {
    const { provider } = countingProvider();
    const result = await runAiRequest(
      makeRequest({ question: 'No fixture matches this question' }),
      baseOptions(provider),
    );
    expect(result.outcome).toMatchObject({ kind: 'unavailable', reason: 'ProviderUnavailable' });
    expect(result.quota.spent).toBe(0);
    expect(result.quota.outstanding).toBe(0);
  });

  it('ответ вне контракта §5 → ProviderContract + release, записи нет', async () => {
    const brokenProvider: AiProvider = {
      config: new MockAiProvider(fixtures).config,
      send: async (): Promise<NormalizedAiResponse> => ({
        provider: 'openai',
        apiVersion: 'v1',
        modelId: 'gpt-5-mini',
        requestId: 'resp_broken',
        requestIdSource: 'provider',
        createdAt: '2026-01-01T00:00:00.000Z',
        rawText: 'answer',
        citations: [],
        // Нарушение GEO-PROVIDER-001: total != input + output.
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 16 },
        usageSource: 'provider',
        finishReason: 'stop',
      }),
    };
    const result = await runAiRequest(makeRequest(), baseOptions(brokenProvider));
    expect(result.outcome).toMatchObject({ kind: 'unavailable', reason: 'ProviderContract' });
    expect(result.quota.spent).toBe(0);
    expect(result.quota.outstanding).toBe(0);
  });

  it('неожиданное исключение провайдера — AiModuleError наверх (баг, не ветка §5)', async () => {
    const explodingProvider: AiProvider = {
      config: new MockAiProvider(fixtures).config,
      send: async (): Promise<NormalizedAiResponse> => {
        throw new Error('socket hang up');
      },
    };
    await expect(runAiRequest(makeRequest(), baseOptions(explodingProvider))).rejects.toThrow(
      AiModuleError,
    );
  });
});
