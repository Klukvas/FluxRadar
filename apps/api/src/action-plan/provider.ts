// The provider the Action Plan runs on.
//
// It is built separately from the scan's provider: `createDefaultAiProvider`
// answers GEO visibility fixtures under Vitest, which are nothing like a plan,
// and the plan's model is its own constant (D-232).

import {
  ACTION_PLAN_TIMEOUT_MS,
  AnthropicProvider,
  MockAiProvider,
  UnconfiguredProvider,
} from '@fluxradar/ai';
import type { AiProvider, MockAiFixture } from '@fluxradar/ai';

import {
  ACTION_PLAN_ANTHROPIC_MODEL,
  readAnthropicConfig,
} from '../integrations/anthropic-config.ts';
import { readIntegrationConfig } from '../integrations/config.ts';
import { isTestRuntime } from '../orchestrator/geo.ts';

/**
 * Whether this deployment can write a plan at all.
 *
 * The route asks before claiming a generation, so a deployment without a key
 * answers "temporarily unavailable" instead of spending one of the scan's six
 * attempts on a request that cannot succeed. Under Vitest the provider is a
 * mock, so the answer is yes and no key is consulted.
 */
export function isActionPlanProviderConfigured(): boolean {
  return isTestRuntime() || readAnthropicConfig().state === 'configured';
}

/**
 * A deterministic plan for local runs and tests. It names no rule id on purpose:
 * the service reconciles the answer with the scan's own rules, so a fixture that
 * hardcoded one would hide exactly that step. Tests that want a usable plan pass
 * their own fixtures.
 */
export function defaultActionPlanFixtures(): readonly MockAiFixture[] {
  return [
    {
      questionIncludes: 'Write the Action Plan',
      unavailable: 'no action plan fixture configured for this test',
    },
  ];
}

export function createDefaultActionPlanProvider(): AiProvider {
  // Never spend money or send customer context during tests, even when a
  // developer has a real key in the local .env file.
  if (isTestRuntime()) {
    return new MockAiProvider(defaultActionPlanFixtures(), {
      config: {
        provider: 'anthropic',
        apiVersion: '2023-06-01',
        modelId: ACTION_PLAN_ANTHROPIC_MODEL,
        timeoutMs: 10_000,
        maxRetries: 1,
      },
    });
  }
  const config = readIntegrationConfig();
  if (config.anthropicApiKey === null) {
    return new UnconfiguredProvider(
      'anthropic',
      ACTION_PLAN_ANTHROPIC_MODEL,
      config.anthropicApiVersion,
      'Anthropic',
    );
  }
  return new AnthropicProvider({
    apiKey: config.anthropicApiKey,
    modelId: ACTION_PLAN_ANTHROPIC_MODEL,
    apiVersion: config.anthropicApiVersion,
    timeoutMs: ACTION_PLAN_TIMEOUT_MS,
  });
}
