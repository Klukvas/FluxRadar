import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestScan, type ScanRequest } from './new-scan-request';
import type { ScanScopePayload } from './scan-scope';

// Every launch transports the submitted GEO language independently of consent.

function request(overrides: Partial<ScanRequest>): ScanRequest {
  return {
    accountId: 'account-1',
    profileId: 'profile-1',
    plan: 'Free',
    aiLanguage: 'en',
    scope: {} as ScanScopePayload,
    expectedProfileConfigVersion: 3,
    optInAiProviders: [],
    internalFreeAccess: false,
    onCheckoutStarted: vi.fn(),
    ...overrides,
  };
}

function captureBodies(data: unknown): { bodies: () => Record<string, unknown>[] } {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true, data, error: null }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return {
    bodies: () =>
      fetchMock.mock.calls
        .map((call) => call[1]?.body)
        .filter((body): body is string => typeof body === 'string')
        .map((body) => JSON.parse(body) as Record<string, unknown>),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the frozen AI language on a scan request', () => {
  it.each(['en', 'uk', 'ru'] as const)(
    'sends %s for Free with or without consent and internal paid plans',
    async (aiLanguage) => {
      for (const plan of ['Free', 'Basic', 'Complete'] as const) {
        const { bodies } = captureBodies({ id: 'scan-1', scanId: 'scan-1', plan });
        await requestScan(
          request({ plan, aiLanguage, freeAiConsent: false, internalFreeAccess: true }),
        );
        expect(bodies()[0]?.aiLanguage).toBe(aiLanguage);
        expect(bodies()[0]).not.toHaveProperty('language');
        if (plan === 'Free') expect(bodies()[0]).not.toHaveProperty('aiConsent');
      }
    },
  );
});
