// GEO-модуль в оркестраторе: двухэтапная генерация контекстных вопросов v0.4.
// Первый AI-запрос получает только обезличенный структурированный контекст
// профиля и генерирует discovery-вопросы; отдельные запросы затем проверяют
// видимость сайта по ним. Awareness-вопросы явно называют бренд/домен.
// Тесты получают согласованные дефолтные фикстуры, а production — Anthropic
// либо fail-closed provider без фиктивных ответов.
// Провайдер инъектируется через WorkerDeps — тесты и production собирают его
// этой же фабрикой.

import type {
  AiConsent,
  AiProvider,
  AiProviderConfig,
  AiQuotaTracker,
  AiRequest,
  AiRequestOutcome,
  MockAiFixture,
} from '@fluxradar/ai';
import { AnthropicProvider, MockAiProvider, runAiRequest, UnavailableError } from '@fluxradar/ai';

import { readIntegrationConfig } from '../integrations/config.ts';

export const GEO_PROMPT_VERSION = 'geo-questions-v4';
export const GEO_QUERY_GENERATOR_PROMPT_VERSION = 'geo-query-generation-v2';
export const GEO_SYSTEM_INSTRUCTIONS =
  'Answer factually. Cite sources when possible. State uncertainty and do not invent facts. ' +
  'An answer is an observation from this request, not proof of remembered or training knowledge.';

export interface GeoProfileContext {
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly language?: string | null;
  readonly businessDescription?: string | null;
  readonly offerings?: string | null;
  readonly targetLanguages?: string | null;
  readonly targetAudience?: string | null;
}

const MAX_CONTEXT_LENGTH = 360;

const GEO_QUERY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      // Anthropic's raw structured-output schema does not accept maxItems or
      // string length constraints. The prompt requests 2–4 concise questions,
      // and parseGeneratedQuestions enforces both limits after generation.
      items: { type: 'string' },
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const;

function clean(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalized === '' ? null : normalized.slice(0, MAX_CONTEXT_LENGTH);
}

function neutralValue(
  value: string | null | undefined,
  brand: string,
  hostname: string,
): string | null {
  const identifiers = [
    brand,
    hostname,
    ...hostname
      .split('.')
      .slice(0, -1)
      .filter((label) => label.length >= 4),
  ];
  const withoutAddresses = (value ?? '').replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, '');
  const neutral = identifiers
    .filter(Boolean)
    .reduce(
      (text, identifier) =>
        text.replace(
          new RegExp(
            `(?<![\\p{L}\\p{N}])${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` +
              '(?![\\p{L}\\p{N}])',
            'giu',
          ),
          '',
        ),
      withoutAddresses,
    );
  return clean(neutral.replace(/\b(?:at|by)\s*$/i, ''));
}

interface NeutralGeoContext {
  readonly topic: string;
  readonly region: string | null;
  readonly audience: string | null;
  readonly languages: string | null;
}

function neutralContext(
  brand: string,
  siteHostname: string,
  context: GeoProfileContext,
): NeutralGeoContext | null {
  // Free-form descriptions and page titles can identify the subject or teach
  // the model the answer. Only neutral structured search attributes belong here.
  const neutral = (value: string | null | undefined) => neutralValue(value, brand, siteHostname);
  const topic = [neutral(context.offerings), neutral(context.industry)].filter(Boolean).join(' · ');
  if (topic === '') return null;
  return {
    topic,
    region: neutral(context.region),
    audience: neutral(context.targetAudience),
    languages: neutral(context.targetLanguages) ?? neutral(context.language),
  };
}

function buildQueryGenerationRequest(scanId: string, context: NeutralGeoContext): AiRequest {
  const facts = [
    `Offerings and category: ${context.topic}`,
    ...(context.region === null ? [] : [`Target region: ${context.region}`]),
    ...(context.audience === null ? [] : [`Target audience: ${context.audience}`]),
    ...(context.languages === null ? [] : [`Target languages: ${context.languages}`]),
  ];
  return {
    scanId,
    provider: 'anthropic',
    promptVersion: GEO_QUERY_GENERATOR_PROMPT_VERSION,
    sequence: 1,
    question:
      'Generate neutral discovery questions that a potential customer could ask an AI assistant ' +
      'when looking for providers matching this context. Return only JSON in the form ' +
      '{"questions":["...","..."]}, with 2 to 4 concise questions. Never include a brand, ' +
      'company name, domain, URL, email address, or claim that a particular provider is best. ' +
      'Use the target languages and cover every listed language when the 2-to-4-question limit ' +
      `allows it.\n${facts.join('\n')}`,
    brandFacts: [],
    pageTitles: [],
    systemInstructions:
      'Generate realistic, neutral discovery questions from the supplied structured context. ' +
      'Do not answer the questions. Output valid JSON only.',
    // Sonnet 5 enables adaptive thinking by default, which is unnecessary for
    // this bounded extraction task and shares the response token budget. The
    // JSON schema prevents otherwise useful generations from being discarded
    // because the model wrapped or annotated the object.
    reasoningMode: 'disabled',
    responseSchema: GEO_QUERY_RESPONSE_SCHEMA,
  };
}

export type GeoQuestionGenerationStatus =
  'Completed' | 'NotApplicable' | 'Unavailable' | 'InvalidResponse';

export interface GeoQuestionGenerationResult {
  readonly status: GeoQuestionGenerationStatus;
  readonly statusReason: string | null;
  readonly applicableChecks: 0 | 1;
  readonly completedApplicableChecks: 0 | 1;
  readonly questions: readonly string[];
  readonly outcome: AiRequestOutcome | null;
  readonly quota: AiQuotaTracker;
}

export interface GenerateGeoDiscoveryQuestionsInput {
  readonly scanId: string;
  readonly brand: string;
  readonly siteHostname: string;
  readonly context: GeoProfileContext;
  readonly consent: AiConsent | null;
  readonly provider: AiProvider;
  readonly quota: AiQuotaTracker;
}

interface ParsedQuestions {
  readonly questions: readonly string[];
  readonly error: string | null;
}

function generatedQuestionIdentifiers(brand: string, siteHostname: string): readonly string[] {
  return [
    brand,
    siteHostname,
    ...siteHostname
      .split('.')
      .slice(0, -1)
      .filter((label) => label.length >= 4),
  ]
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, values) => value.length >= 3 && values.indexOf(value) === index);
}

function compactIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function parseGeneratedQuestions(
  rawText: string,
  brand: string,
  siteHostname: string,
): ParsedQuestions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { questions: [], error: 'query generator did not return valid JSON' };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('questions' in parsed) ||
    !Array.isArray(parsed.questions)
  ) {
    return { questions: [], error: 'query generator JSON must contain a questions array' };
  }
  if (parsed.questions.length < 2 || parsed.questions.length > 4) {
    return { questions: [], error: 'query generator must return between 2 and 4 questions' };
  }
  const identifiers = generatedQuestionIdentifiers(brand, siteHostname);
  const questions: string[] = [];
  for (const candidate of parsed.questions) {
    if (typeof candidate !== 'string') {
      return { questions: [], error: 'every generated question must be a string' };
    }
    const question = candidate.replace(/\s+/g, ' ').trim();
    if (question.length < 12 || question.length > 240) {
      return { questions: [], error: 'generated questions must contain 12 to 240 characters' };
    }
    const normalized = question.toLowerCase();
    const compactQuestion = compactIdentifier(question);
    if (
      /https?:\/\/|www\.|\S+@\S+/i.test(question) ||
      identifiers.some(
        (identifier) =>
          normalized.includes(identifier) ||
          compactQuestion.includes(compactIdentifier(identifier)),
      )
    ) {
      return { questions: [], error: 'generated question contains a brand or site identifier' };
    }
    if (questions.some((existing) => existing.toLowerCase() === normalized)) {
      return { questions: [], error: 'query generator returned duplicate questions' };
    }
    questions.push(question);
  }
  return { questions, error: null };
}

/**
 * The first provider call produces neutral, domain-specific discovery questions.
 * It deliberately receives no brand/domain/free-form site description, so the
 * later visibility check cannot be primed with the answer it is supposed to measure.
 */
export async function generateGeoDiscoveryQuestions(
  input: GenerateGeoDiscoveryQuestionsInput,
): Promise<GeoQuestionGenerationResult> {
  const context = neutralContext(input.brand, input.siteHostname, input.context);
  if (context === null) {
    return {
      status: 'NotApplicable',
      statusReason: 'ProfileContextMissing',
      applicableChecks: 0,
      completedApplicableChecks: 0,
      questions: [],
      outcome: null,
      quota: input.quota,
    };
  }

  const result = await runAiRequest(buildQueryGenerationRequest(input.scanId, context), {
    provider: input.provider,
    quota: input.quota,
    consent: input.consent,
  });
  if (result.outcome.kind === 'unavailable') {
    return {
      status: 'Unavailable',
      statusReason: result.outcome.reason,
      applicableChecks: 1,
      completedApplicableChecks: 0,
      questions: [],
      outcome: result.outcome,
      quota: result.quota,
    };
  }

  const parsed = parseGeneratedQuestions(
    result.outcome.response.rawText,
    input.brand,
    input.siteHostname,
  );
  if (parsed.error !== null) {
    return {
      status: 'InvalidResponse',
      statusReason: parsed.error,
      applicableChecks: 1,
      completedApplicableChecks: 0,
      questions: [],
      outcome: result.outcome,
      quota: result.quota,
    };
  }
  return {
    status: 'Completed',
    statusReason: null,
    applicableChecks: 1,
    completedApplicableChecks: 1,
    questions: parsed.questions,
    outcome: result.outcome,
    quota: result.quota,
  };
}

/**
 * Библиотека вопросов скана. Фиксированные awareness-вопросы используют
 * стабильный `q<sequence>`, а generated discovery-вопросы получают identity
 * из нормализованного текста вопроса (D-176).
 */
export function buildGeoRequests(
  scanId: string,
  brand: string,
  discoveryQuestions: readonly string[] = [],
): readonly AiRequest[] {
  // The domain is deliberately absent. These questions used to read "What is
  // <brand>, what does its official website https://<hostname> offer…", and
  // then GEO-VIS-004 checked the answer for that hostname — so a model
  // repeating the subject of the question scored "official domain cited" on
  // every site we ever scanned. Asked this way, naming the site is something
  // the model has to know.
  //
  // The brand still appears, because a question about a brand has to name it;
  // GEO-VIS-003 therefore treats these two as unmeasurable for brand awareness
  // (`geoMentionSignals`), and measures that on the neutral discovery questions
  // instead, which is the only place it ever meant anything.
  const questions = [
    `What is ${brand}? What is its official website, and who is it for?`,
    `What independently verifiable facts can you report about ${brand}? Name its official website if you know it, and state what you cannot verify.`,
    ...discoveryQuestions,
  ];
  const shared = {
    scanId,
    provider: 'anthropic' as const,
    brandFacts: [],
    pageTitles: [],
    systemInstructions: GEO_SYSTEM_INSTRUCTIONS,
  };
  return questions.map((question, index) => ({
    ...shared,
    sequence: index + 1,
    question,
    promptVersion: `${GEO_PROMPT_VERSION}-${index < 2 ? 'awareness' : 'discovery'}`,
  }));
}

/**
 * Дефолтные фикстуры мока покрывают awareness-вопрос и оба варианта
 * контекстного вопроса; ответы упоминают бренд и ссылаются на сайт, чтобы
 * локальный Complete-flow проверял именно успешную видимость.
 */
export function defaultGeoFixtures(brand: string, siteHostname: string): readonly MockAiFixture[] {
  return [
    {
      questionIncludes: 'Generate neutral discovery questions',
      response: {
        status: 'completed',
        output_text: JSON.stringify({
          questions: [
            'Which providers best match the described service, audience, and region?',
            'What are the best options for someone seeking the described offering locally?',
          ],
        }),
        usage: { input_tokens: 135, output_tokens: 48 },
      },
    },
    {
      questionIncludes: 'What is',
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
      questionIncludes: 'independently verifiable',
      response: {
        status: 'completed',
        output_text:
          `${brand} is a relevant option for this search intent. ` +
          `The official website is https://${siteHostname}/.`,
        usage: { input_tokens: 96, output_tokens: 31 },
      },
    },
    {
      questionIncludes: 'Which providers best match',
      response: {
        status: 'completed',
        output_text:
          `${brand} could be relevant for this audience. ` +
          `See https://${siteHostname}/ for the official details.`,
        citations: [`https://${siteHostname}/`],
        usage: { input_tokens: 104, output_tokens: 28 },
      },
    },
    {
      questionIncludes: 'What are the best options',
      response: {
        status: 'completed',
        output_text: `${brand} is one option: https://${siteHostname}/.`,
        citations: [`https://${siteHostname}/`],
        usage: { input_tokens: 104, output_tokens: 28 },
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
        modelId: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
        timeoutMs: 10_000,
        maxRetries: 1,
      },
    });
  }
  const config = readIntegrationConfig();
  if (config.anthropicApiKey !== null) {
    return new AnthropicProvider({
      apiKey: config.anthropicApiKey,
      modelId: config.anthropicModel,
      apiVersion: config.anthropicApiVersion,
    });
  }
  return new UnconfiguredAnthropicProvider(config.anthropicModel, config.anthropicApiVersion);
}

/**
 * Production must never turn a missing external key into a fake visibility
 * result. Keeping the refusal as an AiProvider lets the normal GEO pipeline
 * record `ProviderUnavailable`, release quota, and keep the scan itself alive.
 */
class UnconfiguredAnthropicProvider implements AiProvider {
  readonly config: AiProviderConfig;

  constructor(modelId: string, apiVersion: string) {
    this.config = {
      provider: 'anthropic',
      apiVersion,
      modelId,
      timeoutMs: 15_000,
      maxRetries: 1,
    };
  }

  async send(): Promise<never> {
    throw new UnavailableError('Anthropic API key is not configured');
  }
}
