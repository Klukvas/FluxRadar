// Anthropic model selection.
//
// One default lives here and nowhere else, so the API, the deploy workflow and
// .env.example cannot drift apart. The deploy workflow deliberately does NOT
// pin a model any more: PRODUCTION_ENV_FILE is authoritative and the optional
// PRODUCTION_ANTHROPIC_MODEL secret is the only override. What used to justify
// that hardcoded pin — a base env file left on a retired model identifier — is
// instead caught here, by name, at startup.

/** The model this release is written and tested against. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';

/**
 * Model identifiers Anthropic has retired. Requests naming one fail at the API,
 * which surfaces as an AI step that never produces findings — so with an API key
 * present, production refuses to boot on one instead. The list names models, not
 * secrets, and is safe to log.
 */
export const RETIRED_ANTHROPIC_MODELS: readonly string[] = [
  'claude-sonnet-4',
  'claude-sonnet-4-0',
  'claude-3-5-sonnet-latest',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
  'claude-2.1',
  'claude-2.0',
  'claude-instant-1.2',
];

export const ANTHROPIC_ENV_VARS = {
  apiKey: 'ANTHROPIC_API_KEY',
  model: 'ANTHROPIC_MODEL',
  apiVersion: 'ANTHROPIC_API_VERSION',
} as const;

export type AnthropicConfigResult =
  | { readonly state: 'configured'; readonly model: string }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

export function isRetiredAnthropicModel(model: string): boolean {
  return RETIRED_ANTHROPIC_MODELS.includes(model);
}

/**
 * The AI provider is optional: without an API key the GEO step reports its own
 * unavailable state. With a key, a retired model is a configuration error and
 * fails closed rather than producing an empty analysis on every scan.
 */
export function readAnthropicConfig(env: NodeJS.ProcessEnv = process.env): AnthropicConfigResult {
  const apiKey = trimmed(env[ANTHROPIC_ENV_VARS.apiKey]);
  const model = trimmed(env[ANTHROPIC_ENV_VARS.model]) ?? DEFAULT_ANTHROPIC_MODEL;
  if (apiKey === null) {
    return { state: 'not_configured' };
  }
  if (isRetiredAnthropicModel(model)) {
    return {
      state: 'invalid',
      missing: [ANTHROPIC_ENV_VARS.model],
      reason:
        `${ANTHROPIC_ENV_VARS.model} names a retired Anthropic model; ` +
        `this release targets ${DEFAULT_ANTHROPIC_MODEL}`,
    };
  }
  return { state: 'configured', model };
}
