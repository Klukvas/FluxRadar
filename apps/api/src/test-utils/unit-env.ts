// Unit-suite defaults: no live provider, no live mailbox, no live money.
//
// Every outbound client in this package takes an injectable fetcher and falls
// back to the global one. That fallback is correct in production and dangerous
// in a unit test: a forgotten injection reaches PageSpeed (billable), Anthropic
// (billable), Resend (a real message to a real address) or FastSpring's
// `POST /returns` (a real refund) — and the test still passes, because a live
// answer looks like a good answer.
//
// So the unit suite has no `fetch`. A test that means to exercise a client
// passes its own fake transport; a test that reaches the global one fails with
// the URL it tried, which is the fastest possible way to find the missing seam.

import { afterEach, beforeEach, vi } from 'vitest';

/** Marks the failure as the harness's doing rather than the provider's. */
export class UnitSuiteNetworkError extends Error {
  constructor(target: string) {
    super(
      `Network access is disabled in the API unit suite (tried ${target}). ` +
        'Inject a fake transport into the client under test, or move the case to the ' +
        'database/integration suite.',
    );
    this.name = 'UnitSuiteNetworkError';
  }
}

function describeTarget(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input instanceof Request) return input.url;
  return 'an unnamed request';
}

const blockedFetch: typeof fetch = (input) => {
  throw new UnitSuiteNetworkError(describeTarget(input));
};

beforeEach(() => {
  vi.stubGlobal('fetch', blockedFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Outbound-side-effect switches are pinned off for the whole unit suite, so a
 * module that reads them at import time sees the safe value. They are assigned
 * rather than defaulted: a value inherited from the developer's shell is exactly
 * what must not decide whether a unit test can send an email or a refund.
 */
process.env.FLUXRADAR_REFUND_DISPATCH = 'off';
process.env.FLUXRADAR_ENABLE_MOCK_EMAIL = '';
