// MockAiProvider (T-10, D-172/D-173): полный детерминизм, нормализация §5,
// output cap 2000 tokens + finish_reason='length', request id / usage sources.

import { AI_REQUEST_CAPS } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { AiModuleError, UnavailableError } from './errors.js';
import {
  geoVisibilityFixtures,
  MOCK_FIXED_TIME_ISO,
  MockAiProvider,
} from './mock-provider.js';
import type { MockAiFixture } from './mock-provider.js';
import { CHARS_PER_TOKEN, TOKENIZER_VERSION } from './prompt-builder.js';
import { validateNormalizedResponse } from './response-contract.js';
import {
  BRAND,
  DOMAIN,
  makeRequest,
  QUESTION_WITHOUT_BRAND,
} from './testing/harness.js';

const fixtures = geoVisibilityFixtures(BRAND, DOMAIN);
const provider = new MockAiProvider(fixtures);
const PROMPT = 'prompt text sent to provider';

describe('MockAiProvider — детерминизм', () => {
  it('два вызова с одним запросом дают byte-identical ответы', async () => {
    const request = makeRequest();
    const first = await provider.send(request, PROMPT);
    const second = await provider.send(request, PROMPT);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('createdAt берётся из фикстуры (unix seconds), не из системных часов', async () => {
    const response = await provider.send(makeRequest(), PROMPT);
    expect(response.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('без created_at в фикстуре берётся фиксированный дефолт часов', async () => {
    const response = await provider.send(
      makeRequest({ sequence: 2, question: QUESTION_WITHOUT_BRAND }),
      PROMPT,
    );
    expect(response.createdAt).toBe(MOCK_FIXED_TIME_ISO);
  });

  it('инъектируемые часы переопределяют дефолт', async () => {
    const clocked = new MockAiProvider(fixtures, {
      now: () => new Date('2026-03-04T05:06:07.000Z'),
    });
    const response = await clocked.send(
      makeRequest({ sequence: 2, question: QUESTION_WITHOUT_BRAND }),
      PROMPT,
    );
    expect(response.createdAt).toBe('2026-03-04T05:06:07.000Z');
  });
});

describe('MockAiProvider — нормализация §5', () => {
  it('фикстура с usage и id → provider-источники, total = input + output', async () => {
    const response = await provider.send(makeRequest(), PROMPT);
    expect(response.requestIdSource).toBe('provider');
    expect(response.requestId).toBe('resp_mock_0001');
    expect(response.usageSource).toBe('provider');
    expect(response.usage.totalTokens).toBe(response.usage.inputTokens + response.usage.outputTokens);
    expect(response.tokenizerVersion).toBeUndefined();
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('фикстура без usage/id → estimated + tokenizerVersion + локальный UUID-детерминированный id', async () => {
    const request = makeRequest({ sequence: 2, question: QUESTION_WITHOUT_BRAND });
    const response = await provider.send(request, PROMPT);
    expect(response.usageSource).toBe('estimated');
    expect(response.tokenizerVersion).toBe(TOKENIZER_VERSION);
    expect(response.requestIdSource).toBe('local');
    expect(response.requestId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(response.usage.totalTokens).toBe(response.usage.inputTokens + response.usage.outputTokens);
    expect(validateNormalizedResponse(response)).toEqual([]);
    // Локальный id детерминирован: тот же prompt → тот же id.
    const again = await provider.send(request, PROMPT);
    expect(again.requestId).toBe(response.requestId);
  });
});

describe('MockAiProvider — output cap (§5)', () => {
  const capChars = AI_REQUEST_CAPS.maxOutputTokens * CHARS_PER_TOKEN;
  const oversizedFixture: MockAiFixture = {
    questionIncludes: 'oversized',
    response: { status: 'completed', output_text: 'x'.repeat(capChars + 500) },
  };

  it('output сверх 2000 tokens усечён по границе токена, finish_reason=length', async () => {
    const capped = new MockAiProvider([oversizedFixture]);
    const response = await capped.send(
      makeRequest({ question: 'Give me an oversized answer' }),
      PROMPT,
    );
    expect(response.rawText.length).toBe(capChars);
    expect(response.finishReason).toBe('length');
    expect(response.usage.outputTokens).toBe(AI_REQUEST_CAPS.maxOutputTokens);
    expect(validateNormalizedResponse(response)).toEqual([]);
  });

  it('provider-side cap (status=incomplete, max_output_tokens) → finish_reason=length без усечения', async () => {
    const incomplete = new MockAiProvider([
      {
        questionIncludes: 'partial',
        response: {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: 'short but cut by provider',
        },
      },
    ]);
    const response = await incomplete.send(makeRequest({ question: 'A partial answer' }), PROMPT);
    expect(response.finishReason).toBe('length');
    expect(response.rawText).toBe('short but cut by provider');
  });

  it('обычный полный ответ → finish_reason=stop', async () => {
    const response = await provider.send(makeRequest(), PROMPT);
    expect(response.finishReason).toBe('stop');
  });
});

describe('MockAiProvider — недоступность (GEO-METHOD-005)', () => {
  it('вопрос без фикстуры → UnavailableError (недоступный отдельный запрос)', async () => {
    await expect(
      provider.send(makeRequest({ question: 'Unmatched question' }), PROMPT),
    ).rejects.toThrow(UnavailableError);
  });

  it('фикстура с unavailable → UnavailableError с причиной', async () => {
    const flaky = new MockAiProvider([
      { questionIncludes: 'down', unavailable: 'provider maintenance window' },
    ]);
    await expect(flaky.send(makeRequest({ question: 'Is it down?' }), PROMPT)).rejects.toThrow(
      /maintenance window/,
    );
  });

  it('запрос к чужому провайдеру — AiModuleError (баг роутинга), не Unavailable', async () => {
    await expect(provider.send(makeRequest({ provider: 'google' }), PROMPT)).rejects.toSatisfy(
      (error) => error instanceof AiModuleError && !(error instanceof UnavailableError),
    );
  });
});
