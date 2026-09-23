// The AI provider's own mock guard, asserted rather than assumed.
//
// `MockAiProvider` answers from fixtures. Reaching it outside a test run would
// put invented GEO visibility findings into a paid report, so the selection is
// pinned here for every environment name a deployment can actually carry — the
// same failure shape the fake mailbox had (see email/mock-email.test.ts).

import type { AiProviderName, AiRequest } from '@fluxradar/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultAiProvider } from './geo.ts';

/** Every recipient the default provider routes to, opt-in ones included. */
const ROUTED_PROVIDERS: readonly AiProviderName[] = ['anthropic', 'openai', 'google', 'perplexity'];

function requestTo(provider: AiProviderName): AiRequest {
  return { ...REQUEST, provider };
}

const REQUEST: AiRequest = {
  scanId: 'scan-1',
  provider: 'anthropic',
  promptVersion: 'guard-test-v1',
  sequence: 1,
  question: 'Does this reach a provider?',
  brandFacts: [],
  pageTitles: [],
  systemInstructions: 'none',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Leaves the suite's own NODE_ENV/VITEST markers behind, as a deployment has none. */
function asDeployment(nodeEnv: string): void {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('VITEST', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
}

describe('createDefaultAiProvider', () => {
  it('routes every provider to the fixture adapter inside the test run', async () => {
    // Asked of each adapter rather than of the wrapper: the provider is a router
    // over four of them, and one real adapter hidden among three mocks would
    // spend money on exactly the scans this guard exists to protect.
    //
    // The refusal is the evidence. This question matches no GEO fixture, so a
    // fixture adapter says so by name — which no real adapter and no
    // unconfigured one can say, and which no network call was needed to reach.
    const provider = createDefaultAiProvider('Acme', 'acme.example');
    for (const name of ROUTED_PROVIDERS) {
      await expect(provider.send(requestTo(name), 'prompt')).rejects.toThrow(/mock fixture/i);
    }
  });

  it.each(['production', 'staging', ''])(
    'never answers from fixtures for NODE_ENV=%p, on any routed provider',
    async (nodeEnv) => {
      asDeployment(nodeEnv);
      const provider = createDefaultAiProvider('Acme', 'acme.example');
      for (const name of ROUTED_PROVIDERS) {
        // Unconfigured here, so a refusal is the right answer and a fixture
        // answer is the wrong one. Either way it is not an invented finding.
        await expect(provider.send(requestTo(name), 'prompt')).rejects.toThrow(/not configured/i);
      }
    },
  );

  it('fails closed without a key: the provider refuses instead of inventing an answer', async () => {
    asDeployment('production');
    const provider = createDefaultAiProvider('Acme', 'acme.example');
    await expect(provider.send(REQUEST, 'prompt')).rejects.toThrow(/not configured/i);
  });
});
