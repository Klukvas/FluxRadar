// Who writes Action Plans in production. Tests inject their own provider
// through createApp's `createActionPlanProvider`, because the default one below
// never returns a working provider under Vitest.

import { ACTION_PLAN_PROVIDER_TIMEOUT_MS, AnthropicProvider, type AiProvider } from '@fluxradar/ai';

import {
  ACTION_PLAN_ANTHROPIC_MODEL,
  readAnthropicConfig,
} from '../integrations/anthropic-config.ts';
import { readIntegrationConfig } from '../integrations/config.ts';

/**
 * Claude Opus 5 when Anthropic is configured; null otherwise, which the POST
 * route answers with 503. Null in tests as well: a real key in a developer's
 * `.env` must never turn a test run into a paid request carrying report data.
 */
export function createDefaultActionPlanProvider(
  env: NodeJS.ProcessEnv = process.env,
): AiProvider | null {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true') return null;
  if (readAnthropicConfig(env).state !== 'configured') return null;
  const config = readIntegrationConfig(env);
  if (config.anthropicApiKey === null) return null;
  return new AnthropicProvider({
    apiKey: config.anthropicApiKey,
    modelId: ACTION_PLAN_ANTHROPIC_MODEL,
    apiVersion: config.anthropicApiVersion,
    timeoutMs: ACTION_PLAN_PROVIDER_TIMEOUT_MS,
  });
}
