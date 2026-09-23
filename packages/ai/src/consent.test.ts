// The processing-record gate, one test per way it can refuse.
//
// This is the last check between a customer's pages and a named company, so
// every branch is pinned rather than left to read correctly: a "simplification"
// that drops the version check or the opt-in check would otherwise pass the
// whole suite while sending a v3 buyer's site to a recipient they were never
// shown.

import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  ensureConsent,
  isAcceptedNoticeVersion,
  type AiConsent,
} from './consent.js';
import { ConsentMissingError } from './errors.js';

const LEGACY_NOTICE_VERSION = 'core-ai-processing-notice-v3';

function consentOf(overrides: Partial<AiConsent> = {}): AiConsent {
  return {
    scanId: 'scan-consent',
    providers: ['anthropic', 'openai'],
    noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    ...overrides,
  };
}

describe('accepted notice versions', () => {
  it('honours the current notice and the one still inside its retry entitlement', () => {
    expect(ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS).toContain(CURRENT_AI_PROCESSING_NOTICE_VERSION);
    expect(ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS).toContain(LEGACY_NOTICE_VERSION);
    expect(isAcceptedNoticeVersion(CURRENT_AI_PROCESSING_NOTICE_VERSION)).toBe(true);
    expect(isAcceptedNoticeVersion(LEGACY_NOTICE_VERSION)).toBe(true);
  });

  it('refuses a version this release never published', () => {
    expect(isAcceptedNoticeVersion('core-ai-processing-notice-v1')).toBe(false);
  });
});

describe('ensureConsent', () => {
  it('passes a default provider named by the current notice', () => {
    expect(() => ensureConsent(consentOf(), 'openai')).not.toThrow();
  });

  it('passes a default provider named by the legacy notice a paid retry still carries', () => {
    const legacy = consentOf({ providers: ['anthropic'], noticeVersion: LEGACY_NOTICE_VERSION });
    expect(() => ensureConsent(legacy, 'anthropic')).not.toThrow();
  });

  it('refuses when no record was stored for the scan', () => {
    expect(() => ensureConsent(null, 'anthropic')).toThrow(ConsentMissingError);
  });

  it('refuses a record written under a notice this release no longer honours', () => {
    const retired = consentOf({ noticeVersion: 'core-ai-processing-notice-v1' });
    expect(() => ensureConsent(retired, 'anthropic')).toThrow(/not a processing notice/);
  });

  it('refuses a provider the record does not name', () => {
    const anthropicOnly = consentOf({ providers: ['anthropic'] });
    expect(() => ensureConsent(anthropicOnly, 'openai')).toThrow(/does not cover this provider/);
  });

  it('passes an opt-in provider the current notice names', () => {
    const optedIn = consentOf({ providers: ['anthropic', 'openai', 'google'] });
    expect(() => ensureConsent(optedIn, 'google')).not.toThrow();
  });

  // The record a v3 buyer stored cannot have named Gemini or Perplexity — that
  // notice did not mention them — so a list that somehow does is not an
  // authorisation, whatever it says.
  it('refuses an opt-in provider under a notice that predates the opt-in disclosure', () => {
    const forged = consentOf({
      providers: ['anthropic', 'google'],
      noticeVersion: LEGACY_NOTICE_VERSION,
    });
    expect(() => ensureConsent(forged, 'google')).toThrow(/predates the opt-in disclosure/);
    expect(() => ensureConsent(forged, 'perplexity')).toThrow(ConsentMissingError);
    // The same record still authorises what v3 actually disclosed.
    expect(() => ensureConsent(forged, 'anthropic')).not.toThrow();
  });
});
