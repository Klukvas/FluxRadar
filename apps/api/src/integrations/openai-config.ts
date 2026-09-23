// OpenAI model selection, mirroring anthropic-config.ts.
//
// One default lives here and nowhere else, so the API, the deploy workflow and
// .env.example cannot drift apart. Without OPENAI_API_KEY every OpenAI request
// is an unavailable provider and the GEO module reports Partial — never a
// silently skipped provider and never an invented answer.

import { OPENAI_DEFAULT_MODEL } from '@fluxradar/ai';

/**
 * The model this release is written and tested against. It is the adapter's own
 * default rather than a second copy of the identifier: the request is built in
 * `packages/ai`, so a divergence here would only show up as an API rejecting
 * every GEO request.
 */
export const DEFAULT_OPENAI_MODEL = OPENAI_DEFAULT_MODEL;

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
