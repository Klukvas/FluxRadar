import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_PROCESSING_NOTICE_VERSION } from './ai-processing-notice';
import { requestScan, type ScanRequest } from './new-scan-request';
import type { ScanScopePayload } from './scan-scope';

// The Free AI preview's consent (D-236) travels only when the owner ticked it,
// and only ever names Anthropic: the API refuses any other Free record.

function freeRequest(freeAiConsent: boolean | undefined): ScanRequest {
  return {
    accountId: 'account-1',
    profileId: 'profile-1',
    plan: 'Free',
    aiLanguage: 'en',
    scope: {} as ScanScopePayload,
    expectedProfileConfigVersion: 3,
    optInAiProviders: ['google'],
    ...(freeAiConsent === undefined ? {} : { freeAiConsent }),
    internalFreeAccess: false,
    onCheckoutStarted: vi.fn(),
  };
}

function captureBody(): { body: () => Record<string, unknown> } {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ success: true, data: { id: 'scan-1', plan: 'Free' }, error: null }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return {
    body: () => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a Free launch', () => {
  it('records Anthropic-only consent when the owner opted in', async () => {
    const { body } = captureBody();
    await requestScan(freeRequest(true));
    expect(body().aiConsent).toEqual({
      providers: ['anthropic'],
      noticeVersion: AI_PROCESSING_NOTICE_VERSION,
    });
  });

  it('sends no consent record when the box was left unticked', async () => {
    for (const choice of [false, undefined]) {
      const { body } = captureBody();
      await requestScan(freeRequest(choice));
      expect(body()).not.toHaveProperty('aiConsent');
      vi.unstubAllGlobals();
    }
  });
});
