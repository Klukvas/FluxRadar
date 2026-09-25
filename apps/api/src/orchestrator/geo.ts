// GEO-модуль в оркестраторе: двухэтапная генерация контекстных вопросов v0.4.
// Первый AI-запрос получает только обезличенный структурированный контекст
// профиля и генерирует discovery-вопросы; отдельные запросы затем проверяют
// видимость сайта по ним. Прямые вопросы называют бренд/домен и задаются
// closed-book — без поиска и инструментов.
// Тесты получают согласованные дефолтные фикстуры, а production — Anthropic
// либо fail-closed provider без фиктивных ответов.
// Провайдер инъектируется через WorkerDeps — тесты и production собирают его
// этой же фабрикой.

import type {
  AiConsent,
  AiProvider,
  AiProviderName,
  AiQuotaTracker,
  AiRequest,
  AiRequestOutcome,
  MockAiFixture,
} from '@fluxradar/ai';
import {
  AnthropicProvider,
  brandIsHostname,
  GeminiProvider,
  mockRoutingProvider,
  OpenAiProvider,
  OPT_IN_VISIBILITY_PROVIDERS,
  PerplexityProvider,
  RoutingAiProvider,
  runAiRequest,
  UnconfiguredProvider,
} from '@fluxradar/ai';

import type { IntegrationConfig } from '../integrations/config.ts';
import { readIntegrationConfig } from '../integrations/config.ts';

/**
 * The providers a paid scan asks its visibility questions, in execution order.
 * Google and Perplexity are deliberately absent: they are opt-in recipients and
 * a scan reaches them only by naming them with a notice that covers them.
 */
export const GEO_VISIBILITY_PROVIDERS: readonly AiProviderName[] = ['anthropic', 'openai'];

/**
 * The providers this scan asks.
 *
 * The defaults are always asked, even when the stored consent does not cover
 * them: the request then records `ConsentMissing` and the module reports
 * Partial with the reason, which is the honest answer. An opt-in provider is
 * the opposite — it is asked only when the scan's own consent names it, so a
 * customer who never chose Gemini or Perplexity never has a request built for
 * them at all.
 */
export function geoProvidersFor(consent: AiConsent | null): readonly AiProviderName[] {
  const optedIn = (consent?.providers ?? []).filter((provider) =>
    OPT_IN_VISIBILITY_PROVIDERS.includes(provider as (typeof OPT_IN_VISIBILITY_PROVIDERS)[number]),
  );
  return [...GEO_VISIBILITY_PROVIDERS, ...new Set(optedIn)];
}

/** How the report names each provider: the product first, then the vendor. */
export const GEO_PROVIDER_DISPLAY_NAMES: Readonly<Record<AiProviderName, string>> = {
  openai: 'ChatGPT · OpenAI',
  anthropic: 'Claude · Anthropic',
  google: 'Gemini · Google',
  perplexity: 'Perplexity',
};

export const GEO_PROMPT_VERSION = 'geo-questions-v5';
export const GEO_QUERY_GENERATOR_PROMPT_VERSION = 'geo-query-generation-v2';
export const GEO_SYSTEM_INSTRUCTIONS =
  'Search the web before answering, and cite the pages you rely on. ' +
  'Answer factually in at most 200 words. Do not narrate your searches. ' +
  'State what you could not verify and do not invent facts. ' +
  'An answer is an observation from this request, not proof of remembered or training knowledge.';

/**
 * The direct questions are closed-book observations, and the prompt has to say
 * so in every way that matters.
 *
 * Asked without these constraints, a model reads a business out of the words
 * inside a domain and the country its TLD belongs to, writes a fluent paragraph
 * about a company it has never heard of, and the report records it as what AI
 * assistants "know" about the site. Abstention is therefore named as a complete
 * answer, guessing from spelling is named as something not to do, and nothing
 * the model returns may be presented as proof of its training data.
 */
export const GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS =
  'Answer only from what you already know. Do not browse the web, do not search, do not use any ' +
  'tool, and do not use anything from earlier in this conversation. ' +
  'If you do not recognise the subject, say so plainly: "I have no information about this" is a ' +
  'complete and correct answer, and is more useful than a guess. ' +
  'Never infer a business from the spelling of a name, from the words inside a domain, or from ' +
  'its country code, and never describe what such a site probably or typically offers. ' +
  'State plainly which parts you are unsure about. Your answer is one observation from one ' +
  'request: do not claim it proves what is or is not in your training data.';

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
  /**
   * Отмена прогона. Генерация вопросов — первый платный запрос GEO, и отменённый
   * скан обязан прервать его, а не дожидаться ответа: наружу идёт
   * AiRequestCancelledError, который разбирает worker.
   */
  readonly signal?: AbortSignal;
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
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
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

const NO_GUESSING_SUFFIX =
  ' If you do not recognise it, say that you have no information instead of guessing.';

/**
 * The direct questions of one scan.
 *
 * A profile whose owner never typed a name is called after its hostname, so the
 * subject of the question *is* the domain. Asking such a profile to "name its
 * official website" hands it the answer and measures nothing, so that second
 * question is asked only when there is a real brand name and the domain is
 * genuinely absent from the question — which is the only case where naming the
 * site is something the model has to know.
 */
export function closedBookQuestions(brand: string, siteDomain: string): readonly string[] {
  if (brandIsHostname(brand, siteDomain)) {
    return [
      `What do you know about the business associated with ${siteDomain}?${NO_GUESSING_SUFFIX}`,
    ];
  }
  return [
    `What do you know about ${brand}?${NO_GUESSING_SUFFIX}`,
    `What independently verifiable facts can you report about ${brand}? Name its official ` +
      `website if you know it, and state what you cannot verify.${NO_GUESSING_SUFFIX}`,
  ];
}

/**
 * Библиотека вопросов скана — по одному набору на провайдера.
 *
 * Фиксированные closed-book-вопросы используют стабильный `q<sequence>`, а
 * generated discovery-вопросы получают identity из нормализованного текста
 * вопроса (D-176). Sequence restarts at 1 for each provider: `ai_request_key`
 * already carries the provider name (D-015) and GEO findings carry it in
 * `normalized_resource`, so quota, idempotency and fingerprints stay distinct.
 *
 * `brandFacts` and `pageTitles` stay empty for every question here: a
 * closed-book observation that was handed the site's own description would be
 * measuring our prompt, not the model.
 *
 * Only the discovery questions carry `webSearch`. A direct question is now a
 * closed-book observation, and question generation and the UX review must stay
 * recall-only — none of the three may ever get tools.
 */
export function buildGeoRequests(
  scanId: string,
  brand: string,
  siteDomain: string,
  discoveryQuestions: readonly string[] = [],
  providers: readonly AiProviderName[] = GEO_VISIBILITY_PROVIDERS,
): readonly AiRequest[] {
  const direct = closedBookQuestions(brand, siteDomain);
  const questions = [...direct, ...discoveryQuestions];
  const shared = {
    scanId,
    brandFacts: [],
    pageTitles: [],
    // Sonnet 5 thinks by default, and thinking shares the answer's token budget
    // it does not need here.
    reasoningMode: 'disabled' as const,
  };
  // Sequence restarts per provider: it is part of ai_request_key together with
  // the provider (D-015), so the same question asked of two vendors stays two
  // distinct requests for quota, idempotency and fingerprints.
  return providers.flatMap((provider) =>
    questions.map((question, index) => {
      const isDirect = index < direct.length;
      return {
        ...shared,
        provider,
        sequence: index + 1,
        question,
        systemInstructions: isDirect
          ? GEO_CLOSED_BOOK_SYSTEM_INSTRUCTIONS
          : GEO_SYSTEM_INSTRUCTIONS,
        // A discovery question asks what an assistant says about this market
        // today, which only a searching assistant can answer. A direct question
        // asks what the model already knows, so it gets no search and no tools —
        // an answer produced by reading the site back to us measures nothing.
        ...(isDirect ? {} : { webSearch: true as const }),
        promptVersion: `${GEO_PROMPT_VERSION}-${isDirect ? 'closed-book' : 'discovery'}`,
      };
    }),
  );
}

/**
 * Deterministic answer texts, so an evaluator fixture can quote them exactly.
 *
 * `knownBrand` is written the way a model actually fails on an unknown site: it
 * keeps the name it was given and invents everything around it — a trade, a
 * city, and a brand name that is not the one the profile states. A fixture that
 * instead described the profile correctly would make every local run and every
 * screenshot end in a green verdict that the evaluator had not earned.
 *
 * The invented name contradicts the profile on the *same* attribute it states:
 * the profile's `Brand name` field against a different asserted brand name. An
 * answer that gave the business a legal entity name would not be a
 * contradiction at all — a trading brand and a registered company name coexist
 * routinely — and a demo fixture must not teach the opposite.
 */
function defaultGeoAnswers(brand: string, siteHostname: string) {
  return {
    unknownDomain:
      `I have no reliable information about the business associated with ${siteHostname}. ` +
      'I would be guessing from the name, and a guess is not an answer.',
    knownBrand:
      `${brand} is a website audit service for small teams. Its brand name is ` +
      `Northwind Digital, not ${brand}, and it is based in Berlin. ` +
      `See https://${siteHostname}/ for scan pricing and module coverage.`,
    verifiableFacts:
      `The official website of ${brand} appears to be https://${siteHostname}/. ` +
      'I cannot verify its ownership, size or location.',
    discoveryBest:
      `${brand} could be relevant for this audience. ` +
      `See https://${siteHostname}/ for the official details.`,
    discoveryOptions: `${brand} is one option worth comparing: https://${siteHostname}/.`,
  } as const;
}

function evaluationBody(payload: Record<string, unknown>): MockAiFixture['response'] {
  return {
    status: 'completed',
    output_text: JSON.stringify(payload),
    usage: { input_tokens: 900, output_tokens: 90 },
  };
}

/**
 * Дефолтные фикстуры мока покрывают closed-book-вопросы, оба варианта
 * контекстного вопроса и оценку каждого полученного ответа.
 *
 * The evaluator fixtures come first and key on a phrase that exists only inside
 * an answer: an evaluation request quotes the original question back, so a
 * fixture keyed on the question itself would answer the judge with the answer.
 *
 * Only the discovery answers declare `web_search_calls`: they are the only
 * requests that still carry web search, and declaring it keeps `search_units`
 * reaching the export in tests exactly as it would in production.
 */
export function defaultGeoFixtures(brand: string, siteHostname: string): readonly MockAiFixture[] {
  const answers = defaultGeoAnswers(brand, siteHostname);
  return [
    {
      questionIncludes: 'I have no reliable information about the business',
      response: evaluationBody({
        answerDescribesSubject: false,
        claims: [],
        overall: 'no-description',
      }),
    },
    {
      // The judge's fixture for that answer, claim by claim: the name is the
      // one thing the profile can confirm, and a name confirms identity only —
      // never what the business does or where it is. The same field does
      // contradict a *different* brand name, which is the one thing here the
      // profile can settle outright.
      questionIncludes: 'is a website audit service for small teams',
      response: evaluationBody({
        answerDescribesSubject: true,
        claims: [
          {
            claim: `The answer is about the business the profile names, ${brand}.`,
            verdict: 'matched',
            answerQuote: `${brand} is`,
            sourceId: 'profile-1',
            sourceQuote: brand,
          },
          {
            claim: 'The business is a website audit service for small teams.',
            verdict: 'unverified',
            answerQuote: 'a website audit service for small teams',
          },
          {
            claim: `The brand name of the business is Northwind Digital, not ${brand}.`,
            verdict: 'contradicted',
            answerQuote: `Its brand name is Northwind Digital, not ${brand}`,
            sourceId: 'profile-1',
            sourceQuote: brand,
          },
          {
            claim: 'The business is based in Berlin.',
            verdict: 'unverified',
            answerQuote: 'it is based in Berlin',
          },
        ],
        overall: 'contradicts-evidence',
      }),
    },
    {
      questionIncludes: 'The official website of',
      response: evaluationBody({
        answerDescribesSubject: true,
        claims: [
          {
            claim: 'The answer names an official website for the business.',
            verdict: 'unverified',
            answerQuote: 'The official website of',
          },
        ],
        overall: 'unverified',
      }),
    },
    {
      questionIncludes: 'could be relevant for this audience',
      response: evaluationBody({
        answerDescribesSubject: true,
        claims: [
          {
            claim: 'The answer suggests the business fits this audience.',
            verdict: 'unverified',
            answerQuote: 'could be relevant for this audience',
          },
        ],
        overall: 'unverified',
      }),
    },
    {
      questionIncludes: 'is one option worth comparing',
      response: evaluationBody({
        answerDescribesSubject: true,
        claims: [
          {
            claim: 'The answer lists the business among the options.',
            verdict: 'unverified',
            answerQuote: 'is one option worth comparing',
          },
        ],
        overall: 'unverified',
      }),
    },
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
      questionIncludes: 'the business associated with',
      response: {
        status: 'completed',
        output_text: answers.unknownDomain,
        usage: { input_tokens: 90, output_tokens: 36 },
      },
    },
    {
      questionIncludes: 'What do you know about',
      response: {
        status: 'completed',
        output_text: answers.knownBrand,
        citations: [`https://${siteHostname}/`],
        usage: { input_tokens: 120, output_tokens: 42 },
      },
    },
    {
      questionIncludes: 'independently verifiable',
      response: {
        status: 'completed',
        output_text: answers.verifiableFacts,
        usage: { input_tokens: 96, output_tokens: 31 },
      },
    },
    {
      questionIncludes: 'Which providers best match',
      response: {
        status: 'completed',
        output_text: answers.discoveryBest,
        citations: [`https://${siteHostname}/`],
        web_search_calls: 2,
        usage: { input_tokens: 104, output_tokens: 28 },
      },
    },
    {
      questionIncludes: 'What are the best options',
      response: {
        status: 'completed',
        output_text: answers.discoveryOptions,
        citations: [`https://${siteHostname}/`],
        web_search_calls: 3,
        usage: { input_tokens: 104, output_tokens: 28 },
      },
    },
  ];
}

/** True while Vitest runs, where no real transport may ever be built. */
export function isTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || env.VITEST === 'true';
}

/**
 * The adapter for one provider name, or a refusal.
 *
 * Production must never turn a missing external key into a fake visibility
 * result, so an unconfigured provider stays an `AiProvider` that refuses: the
 * normal pipeline then records `ProviderUnavailable`, releases quota, reports
 * the module as Partial and keeps the scan itself alive.
 */
function realProviderFor(provider: AiProviderName, config: IntegrationConfig): AiProvider {
  if (provider === 'anthropic') {
    return config.anthropicApiKey === null
      ? new UnconfiguredProvider(
          'anthropic',
          config.anthropicModel,
          config.anthropicApiVersion,
          'Anthropic',
        )
      : new AnthropicProvider({
          apiKey: config.anthropicApiKey,
          modelId: config.anthropicModel,
          apiVersion: config.anthropicApiVersion,
        });
  }
  if (provider === 'openai') {
    return config.openAiApiKey === null
      ? new UnconfiguredProvider('openai', config.openAiModel, 'v1', 'OpenAI')
      : new OpenAiProvider({ apiKey: config.openAiApiKey, modelId: config.openAiModel });
  }
  if (provider === 'google') {
    return config.googleAiApiKey === null
      ? new UnconfiguredProvider('google', config.googleAiModel, 'v1beta', 'Google')
      : new GeminiProvider({
          apiKey: config.googleAiApiKey,
          modelId: config.googleAiModel,
          ...(config.googleAiApiVersion === null ? {} : { apiVersion: config.googleAiApiVersion }),
        });
  }
  return config.perplexityApiKey === null
    ? new UnconfiguredProvider('perplexity', config.perplexityModel, 'v1', 'Perplexity')
    : new PerplexityProvider({
        apiKey: config.perplexityApiKey,
        modelId: config.perplexityModel,
        ...(config.perplexityEndpointUrl === null
          ? {}
          : { endpointUrl: config.perplexityEndpointUrl }),
      });
}

/**
 * The provider the worker uses for a scan: one routing adapter covering every
 * name a scan may ask for.
 *
 * Every name is wired, including the opt-in ones — an unwired name would be a
 * routing bug rather than the honest `ConsentMissing` an opt-in scan without
 * consent must record. What actually reaches a provider is decided by the
 * scan's request list and its stored consent, never by this factory.
 */
export function createDefaultAiProvider(brand: string, siteHostname: string): AiProvider {
  // Never spend money or send customer context during tests, even when a
  // developer has a real key in the local .env file.
  if (isTestRuntime()) {
    return mockRoutingProvider(defaultGeoFixtures(brand, siteHostname), [
      'anthropic',
      'openai',
      'google',
      'perplexity',
    ]);
  }
  const config = readIntegrationConfig();
  return new RoutingAiProvider(
    (['anthropic', 'openai', 'google', 'perplexity'] as const).map((provider) =>
      realProviderFor(provider, config),
    ),
  );
}
