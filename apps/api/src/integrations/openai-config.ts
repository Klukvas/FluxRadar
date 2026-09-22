// OpenAI model selection, mirroring anthropic-config.ts.
//
// One default lives here and nowhere else, so the API, the deploy workflow and
// .env.example cannot drift apart. The deploy workflow does not pin a model:
// PRODUCTION_ENV_FILE is authoritative and the optional PRODUCTION_OPENAI_MODEL
// variable is the only override.

/**
 * The model this release is written and tested against (D-233): the cheapest
 * current OpenAI model that supports the `web_search` tool. A GEO request's cost
 * is dominated by the $10-per-1,000 search calls, not by tokens, so a dearer
 * model would buy little; `OPENAI_MODEL` overrides it when the live smoke run
 * says the answers are not good enough.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';

/**
 * Model identifiers OpenAI has retired. Requests naming one fail at the API,
 * which surfaces as an AI step that never produces findings — so with an API key
 * present, production refuses to boot on one instead. The list names models, not
 * secrets, and is safe to log.
 */
export const RETIRED_OPENAI_MODELS: readonly string[] = [
  'gpt-4o-search-preview',
  'gpt-4o-mini-search-preview',
];

export const OPENAI_ENV_VARS = {
  apiKey: 'OPENAI_API_KEY',
  model: 'OPENAI_MODEL',
} as const;

export type OpenAiConfigResult =
  | { readonly state: 'configured'; readonly model: string }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

export function isRetiredOpenAiModel(model: string): boolean {
  return RETIRED_OPENAI_MODELS.includes(model);
}

/**
 * The AI provider is optional: without an API key the GEO module reports its
 * OpenAI questions as unavailable and stays Partial. With a key, a retired model
 * is a configuration error and fails closed rather than producing an empty
 * analysis on every scan.
 */
export function readOpenAiConfig(env: NodeJS.ProcessEnv = process.env): OpenAiConfigResult {
  const apiKey = trimmed(env[OPENAI_ENV_VARS.apiKey]);
  const model = trimmed(env[OPENAI_ENV_VARS.model]) ?? DEFAULT_OPENAI_MODEL;
  if (apiKey === null) {
    return { state: 'not_configured' };
  }
  if (isRetiredOpenAiModel(model)) {
    return {
      state: 'invalid',
      missing: [OPENAI_ENV_VARS.model],
      reason:
        `${OPENAI_ENV_VARS.model} names a retired OpenAI model; ` +
        `this release targets ${DEFAULT_OPENAI_MODEL}`,
    };
  }
  return { state: 'configured', model };
}
