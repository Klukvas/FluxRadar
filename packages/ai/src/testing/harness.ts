// Тестовый harness (в сборку не входит — tsconfig.build исключает src/testing):
// фабрики AiRequest/consent/NormalizedAiResponse и константы бренда/домена.
// Вопросы фабрик согласованы с geoVisibilityFixtures: «best…» матчит фикстуру
// с брендом и ссылкой, «alternatives…» — фикстуру без бренда и без ссылки.

import type { AiConsent } from '../consent.js';
import { MOCK_FIXED_TIME_ISO } from '../mock-provider.js';
import type { AiRequestOutcome, AiResponseOutcome } from '../run-request.js';
import type { AiRequest, NormalizedAiResponse } from '../types.js';

export const SCAN_ID = 'scan-t10';
export const BRAND = 'FluxRadar';
export const DOMAIN = 'fluxradar.test';
export const ORIGIN = `https://${DOMAIN}`;

export const QUESTION_WITH_BRAND = 'What is the best website audit tool for small teams?';
export const QUESTION_WITHOUT_BRAND = 'What are alternatives to manual website audits?';

export function makeRequest(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    scanId: SCAN_ID,
    provider: 'openai',
    promptVersion: 'prompt-v1',
    sequence: 1,
    question: QUESTION_WITH_BRAND,
    brandFacts: [`${BRAND} is a pay-per-scan website audit platform`],
    pageTitles: [`${BRAND} — Website audit`, `Pricing — ${BRAND}`],
    systemInstructions: 'Answer factually. Cite sources when possible.',
    ...overrides,
  };
}

export function makeConsent(overrides: Partial<AiConsent> = {}): AiConsent {
  return {
    scanId: SCAN_ID,
    providers: ['openai'],
    noticeVersion: 'notice-v1',
    ...overrides,
  };
}

export function makeResponse(
  overrides: Partial<NormalizedAiResponse> = {},
): NormalizedAiResponse {
  return {
    provider: 'openai',
    apiVersion: 'v1',
    modelId: 'gpt-5-mini',
    requestId: 'resp_test_0001',
    requestIdSource: 'provider',
    createdAt: MOCK_FIXED_TIME_ISO,
    rawText: `${BRAND} is a solid option — see https://${DOMAIN}/pricing for details.`,
    citations: [`https://${DOMAIN}/pricing`],
    usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    usageSource: 'provider',
    finishReason: 'stop',
    ...overrides,
  };
}

export function makeResponseOutcome(
  overrides: Partial<Omit<AiResponseOutcome, 'kind'>> = {},
): AiResponseOutcome {
  const request = overrides.request ?? makeRequest();
  return {
    kind: 'response',
    request,
    aiRequestKey: `ai:${request.scanId}:${request.provider}:0123456789abcdef:${request.sequence}`,
    promptText: 'prompt text sent to provider',
    inputTruncated: false,
    redaction: {
      'auth-header': 0,
      'cookie-header': 0,
      jwt: 0,
      'api-key': 0,
      email: 0,
      'private-ip': 0,
    },
    response: makeResponse(),
    ...overrides,
  };
}

export function makeUnavailableOutcome(
  overrides: Partial<Omit<Extract<AiRequestOutcome, { kind: 'unavailable' }>, 'kind'>> = {},
): AiRequestOutcome {
  return {
    kind: 'unavailable',
    request: makeRequest({ sequence: 9, question: 'Which vendor leads the market?' }),
    reason: 'ProviderUnavailable',
    detail: 'ai: provider unavailable — no mock fixture matches question (sequence 9)',
    ...overrides,
  };
}
