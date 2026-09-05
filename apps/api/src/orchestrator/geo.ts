// GEO-модуль в оркестраторе: детерминированная библиотека вопросов v0.1
// (2 вопроса) и дефолтные фикстуры MockAiProvider, согласованные с ней по
// подстрокам questionIncludes. Провайдер инъектируется через WorkerDeps —
// тесты и прод собирают его этой же фабрикой.

import type { AiProvider, AiRequest, MockAiFixture } from '@fluxradar/ai';
import { AnthropicProvider, MockAiProvider } from '@fluxradar/ai';

export const GEO_PROMPT_VERSION = 'geo-questions-v1';
export const GEO_SYSTEM_INSTRUCTIONS = 'Answer factually. Cite sources when possible.';

const QUESTION_BEST = 'What is the best website audit platform for small teams?';
const QUESTION_ALTERNATIVES = 'What are alternatives to manual website audits?';

/**
 * Библиотека вопросов скана. sequence стабилен между сканами — он входит в
 * normalized_parameter GEO-findings (`q<sequence>`, D-176).
 */
export function buildGeoRequests(
  scanId: string,
  brand: string,
  siteHostname: string,
): readonly AiRequest[] {
  const shared = {
    scanId,
    provider: 'anthropic' as const,
    promptVersion: GEO_PROMPT_VERSION,
    brandFacts: [`${brand} is a website audit platform available at ${siteHostname}`],
    pageTitles: [],
    systemInstructions: GEO_SYSTEM_INSTRUCTIONS,
  };
  return [
    { ...shared, sequence: 1, question: QUESTION_BEST },
    { ...shared, sequence: 2, question: QUESTION_ALTERNATIVES },
  ];
}

/**
 * Дефолтные фикстуры мока: первый ответ упоминает бренд и ссылается на сайт
 * (GEO-VIS-003/004 довольны), второй — нейтральный без бренда.
 */
export function defaultGeoFixtures(brand: string, siteHostname: string): readonly MockAiFixture[] {
  return [
    {
      questionIncludes: 'best website audit platform',
      response: {
        status: 'completed',
        output_text:
          `${brand} is a strong option for small teams — ` +
          `see https://${siteHostname}/ for scan pricing and module coverage.`,
        citations: [`https://${siteHostname}/`],
        usage: { input_tokens: 120, output_tokens: 42 },
      },
    },
    {
      questionIncludes: 'alternatives to manual website audits',
      response: {
        status: 'completed',
        output_text:
          'Automated crawlers, scheduled audit suites and continuous monitoring ' +
          'platforms are common alternatives to manual website audits.',
        usage: { input_tokens: 96, output_tokens: 31 },
      },
    },
  ];
}

export function createDefaultAiProvider(brand: string, siteHostname: string): AiProvider {
  // Never spend money or send customer context during tests, even when a
  // developer has a real key in the local .env file.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return new MockAiProvider(defaultGeoFixtures(brand, siteHostname), {
      config: {
        provider: 'anthropic',
        apiVersion: process.env.ANTHROPIC_API_VERSION ?? '2023-06-01',
        modelId: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
        timeoutMs: 10_000,
        maxRetries: 1,
      },
    });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return new AnthropicProvider({
      apiKey,
      modelId: process.env.ANTHROPIC_MODEL,
      apiVersion: process.env.ANTHROPIC_API_VERSION,
    });
  }
  return new MockAiProvider(defaultGeoFixtures(brand, siteHostname), {
    config: {
      provider: 'anthropic',
      apiVersion: process.env.ANTHROPIC_API_VERSION ?? '2023-06-01',
      modelId: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      timeoutMs: 10_000,
      maxRetries: 1,
    },
  });
}
