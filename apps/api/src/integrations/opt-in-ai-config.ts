// Google (Gemini) and Perplexity: opt-in AI recipients.
//
// These two differ from Anthropic and OpenAI in one way that matters more than
// any setting here: a paid scan never selects them. A key alone changes nothing
// — the scan must name the provider and its stored notice must cover it
// (packages/ai/src/consent.ts). Configuring them only makes the opt-in possible.
//
// What is configurable is deliberately narrow. Customer context — page text,
// brand facts, the site's own URLs — is what these requests carry, so the host
// it is sent to is not an environment variable. Google's host is a constant in
// the adapter and its API version may only be one of the documented ones;
// Perplexity's endpoint may only be one of the two documented URLs, because that
// provider is mid-rename and an owner may need the other one before the next
// release. Anything else is `invalid`, never a silent fallback: falling back to
// the default would send customer context somewhere the operator did not choose,
// and accepting the value would send it somewhere nobody documented.

import {
  GEMINI_API_VERSIONS,
  GEMINI_DEFAULT_MODEL,
  OPT_IN_VISIBILITY_PROVIDERS,
  PERPLEXITY_DEFAULT_MODEL,
  PERPLEXITY_ENDPOINTS,
} from '@fluxradar/ai';
import type { AiProviderName } from '@fluxradar/ai';

export const DEFAULT_GEMINI_MODEL = GEMINI_DEFAULT_MODEL;
export const DEFAULT_PERPLEXITY_MODEL = PERPLEXITY_DEFAULT_MODEL;

export const GEMINI_ENV_VARS = {
  apiKey: 'GOOGLE_AI_API_KEY',
  model: 'GOOGLE_AI_MODEL',
  apiVersion: 'GOOGLE_AI_API_VERSION',
} as const;

export const PERPLEXITY_ENV_VARS = {
  apiKey: 'PERPLEXITY_API_KEY',
  model: 'PERPLEXITY_MODEL',
  endpointUrl: 'PERPLEXITY_ENDPOINT_URL',
} as const;

export type OptInAiConfigResult =
  | { readonly state: 'configured'; readonly model: string }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

export function readGeminiConfig(env: NodeJS.ProcessEnv = process.env): OptInAiConfigResult {
  const apiKey = trimmed(env[GEMINI_ENV_VARS.apiKey]);
  const model = trimmed(env[GEMINI_ENV_VARS.model]) ?? DEFAULT_GEMINI_MODEL;
  if (apiKey === null) return { state: 'not_configured' };
  const apiVersion = trimmed(env[GEMINI_ENV_VARS.apiVersion]);
  // The adapter would refuse this value anyway, but it would do so while
  // building a provider for a scan someone already paid for. Saying it at boot
  // costs the operator a redeploy instead of costing a customer their module.
  if (apiVersion !== null && !GEMINI_API_VERSIONS.includes(apiVersion)) {
    return {
      state: 'invalid',
      missing: [GEMINI_ENV_VARS.apiVersion],
      reason:
        `${GEMINI_ENV_VARS.apiVersion} must be one of the documented Gemini API ` +
        `versions (${GEMINI_API_VERSIONS.join(', ')})`,
    };
  }
  return { state: 'configured', model };
}

export function readPerplexityConfig(env: NodeJS.ProcessEnv = process.env): OptInAiConfigResult {
  const apiKey = trimmed(env[PERPLEXITY_ENV_VARS.apiKey]);
  const model = trimmed(env[PERPLEXITY_ENV_VARS.model]) ?? DEFAULT_PERPLEXITY_MODEL;
  if (apiKey === null) return { state: 'not_configured' };
  const endpointUrl = trimmed(env[PERPLEXITY_ENV_VARS.endpointUrl]);
  if (endpointUrl !== null && !PERPLEXITY_ENDPOINTS.includes(endpointUrl)) {
    return {
      state: 'invalid',
      missing: [PERPLEXITY_ENV_VARS.endpointUrl],
      reason:
        `${PERPLEXITY_ENV_VARS.endpointUrl} must be one of the documented Perplexity ` +
        `endpoints (${PERPLEXITY_ENDPOINTS.join(', ')})`,
    };
  }
  return { state: 'configured', model };
}

/**
 * Which opt-in recipients this deployment can actually serve.
 *
 * The names travel to the browser so the new-scan form offers only choices the
 * deployment can keep — offering the rest would sell a paid scan whose GEO
 * module is Partial before it starts. A provider name is a public product fact
 * (the notice names both companies); no key, host, model or variable name is
 * exposed by this, and a half-configured provider counts as absent here exactly
 * as it does everywhere else.
 */
export function availableOptInAiProviders(
  env: NodeJS.ProcessEnv = process.env,
): readonly AiProviderName[] {
  const readers: Readonly<
    Record<(typeof OPT_IN_VISIBILITY_PROVIDERS)[number], OptInAiConfigResult>
  > = {
    google: readGeminiConfig(env),
    perplexity: readPerplexityConfig(env),
  };
  return OPT_IN_VISIBILITY_PROVIDERS.filter((provider) => readers[provider].state === 'configured');
}
