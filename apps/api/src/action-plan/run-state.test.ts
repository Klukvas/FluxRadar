import { ACTION_PLAN_PROVIDER_TIMEOUT_MS } from '@fluxradar/ai';
import { describe, expect, it } from 'vitest';

import {
  ACTION_PLAN_MAX_ATTEMPTS,
  ACTION_PLAN_MAX_SUCCESSES,
  ACTION_PLAN_RUN_STALE_MS,
} from './policy.ts';
import { createDefaultActionPlanProvider } from './provider.ts';
import { refusedClaim } from './run-state.ts';

// The claim is one conditional update (run-state.ts): when it matches no row,
// the reason is read from the scan it failed on, so the owner is told what
// actually stopped it rather than whichever check a request happened to make
// first.

describe('why a claim was refused', () => {
  const ready = { status: 'Completed', actionPlanAttempts: 1, actionPlanSuccesses: 1 };

  it('names the spent budget, not the run in flight, once no plan is left to write', () => {
    expect(refusedClaim({ ...ready, actionPlanAttempts: ACTION_PLAN_MAX_ATTEMPTS })).toBe(
      'limit_reached',
    );
    expect(refusedClaim({ ...ready, actionPlanSuccesses: ACTION_PLAN_MAX_SUCCESSES })).toBe(
      'limit_reached',
    );
  });

  it('says the scan is not ready when a re-run took it back meanwhile', () => {
    expect(
      refusedClaim({ ...ready, status: 'Running', actionPlanAttempts: ACTION_PLAN_MAX_ATTEMPTS }),
    ).toBe('not_ready');
  });

  it('asks to try again when only another run stood in the way', () => {
    expect(refusedClaim(ready)).toBe('in_progress');
  });
});

describe('a run in flight', () => {
  it('gives the provider up before anyone may take the run over', () => {
    // A placeholder key: building the provider sends nothing.
    const provider = createDefaultActionPlanProvider({
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: 'placeholder-not-a-key',
    });

    // One request, no retry: its timeout is the whole of the run's provider time.
    expect(provider?.config).toMatchObject({
      modelId: 'claude-opus-5',
      timeoutMs: ACTION_PLAN_PROVIDER_TIMEOUT_MS,
    });
    expect(ACTION_PLAN_PROVIDER_TIMEOUT_MS).toBeLessThan(ACTION_PLAN_RUN_STALE_MS);
  });

  it('never builds a real provider under test', () => {
    expect(
      createDefaultActionPlanProvider({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'placeholder' }),
    ).toBeNull();
  });
});
