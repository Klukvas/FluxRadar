import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestScan, type ScanRequest } from './new-scan-request';
import type { ScanScopePayload } from './scan-scope';

// The AI question's language (D-237) travels on the Free request only, and only
// together with the AI consent: without consent no question is asked, so the
// body says nothing about a language. Paid requests are unchanged.

function request(overrides: Partial<ScanRequest>): ScanRequest {
  return {
    accountId: 'account-1',
    profileId: 'profile-1',
    plan: 'Free',
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

describe('the AI language on a scan request', () => {
  it.each(['en', 'uk'] as const)(
    'sends %s with the AI consent on a Free check',
    async (language) => {
      const { bodies } = captureBodies({ id: 'scan-1', plan: 'Free' });
      await requestScan(request({ language, freeAiConsent: true }));
      expect(bodies()[0]?.language).toBe(language);
      expect(bodies()[0]).toHaveProperty('aiConsent');
    },
  );

  it.each([false, undefined])('sends no language without the AI consent (%s)', async (consent) => {
    const { bodies } = captureBodies({ id: 'scan-1', plan: 'Free' });
    await requestScan(request({ language: 'uk', freeAiConsent: consent }));
    expect(bodies()[0]).not.toHaveProperty('language');
    expect(bodies()[0]).not.toHaveProperty('aiConsent');
  });

  it('sends no language field when none was given', async () => {
    const { bodies } = captureBodies({ id: 'scan-1', plan: 'Free' });
    await requestScan(request({ freeAiConsent: true }));
    expect(bodies()[0]).not.toHaveProperty('language');
  });

  it('never sends it on a paid request', async () => {
    const { bodies } = captureBodies({ scanId: 'scan-2', id: 'scan-2', plan: 'Basic' });
    await requestScan(request({ plan: 'Basic', internalFreeAccess: true, language: 'uk' }));
    expect(bodies().length).toBeGreaterThan(0);
    for (const body of bodies()) expect(body).not.toHaveProperty('language');
  });
});
