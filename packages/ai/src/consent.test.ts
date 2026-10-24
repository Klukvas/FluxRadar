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
  noticeCoversGeoEvidence,
  noticeCoversGeoTone,
  type AiConsent,
} from './consent.js';
import { ConsentMissingError } from './errors.js';

const LEGACY_NOTICE_VERSION = 'core-ai-processing-notice-v3';
/** The notice that named Gemini and Perplexity, and nothing about evidence. */
const OPT_IN_NOTICE_VERSION = 'core-ai-processing-notice-v4';
/** The notice that disclosed evidence evaluation, and nothing about tone. */
const EVIDENCE_NOTICE_VERSION = 'core-ai-processing-notice-v5';

function consentOf(overrides: Partial<AiConsent> = {}): AiConsent {
  return {
    scanId: 'scan-consent',
    providers: ['anthropic', 'openai'],
    noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    ...overrides,
  };
}

describe('accepted notice versions', () => {
  it('makes v6 the notice a new purchase is made under', () => {
    expect(CURRENT_AI_PROCESSING_NOTICE_VERSION).toBe('core-ai-processing-notice-v6');
  });

  // v6 only adds a purpose to an existing request. A scan bought under v5 keeps
  // its retry entitlement for the transition period, as v3 and v4 did.
  it('still honours v5, v4 and v3 for the transition period', () => {
    expect(ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS).toEqual([
      'core-ai-processing-notice-v3',
      'core-ai-processing-notice-v4',
      'core-ai-processing-notice-v5',
      'core-ai-processing-notice-v6',
    ]);
    expect(isAcceptedNoticeVersion(EVIDENCE_NOTICE_VERSION)).toBe(true);
  });

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

  // The v5 bump added the evaluator, not a new recipient list. A v4 customer
  // paid for Gemini and Perplexity after reading the notice that named them,
  // and gating the opt-in providers on "newest notice" would have revoked that
  // entitlement on release day.
  it('keeps the opt-in providers a v4 record named', () => {
    const optedIn = consentOf({
      providers: ['anthropic', 'openai', 'google', 'perplexity'],
      noticeVersion: OPT_IN_NOTICE_VERSION,
    });
    expect(() => ensureConsent(optedIn, 'google')).not.toThrow();
    expect(() => ensureConsent(optedIn, 'perplexity')).not.toThrow();
    expect(() => ensureConsent(optedIn, 'openai')).not.toThrow();
  });

  // The v6 bump must not revoke the opt-in providers a v5 buyer chose either.
  it('keeps the opt-in providers a v5 record named', () => {
    const optedIn = consentOf({
      providers: ['anthropic', 'openai', 'google', 'perplexity'],
      noticeVersion: EVIDENCE_NOTICE_VERSION,
    });
    expect(() => ensureConsent(optedIn, 'google')).not.toThrow();
    expect(() => ensureConsent(optedIn, 'perplexity')).not.toThrow();
  });
});

describe('noticeCoversGeoEvidence', () => {
  // The evaluator is the only flow that sends profile fields and page text to a
  // provider, and only v5 disclosed it. If an earlier accepted notice ever
  // returned true here, a customer's site content would leave the machine under
  // a disclosure that never mentioned it.
  it('covers v5 and the current notice, and no earlier one', () => {
    expect(noticeCoversGeoEvidence(CURRENT_AI_PROCESSING_NOTICE_VERSION)).toBe(true);
    expect(noticeCoversGeoEvidence(EVIDENCE_NOTICE_VERSION)).toBe(true);
    expect(noticeCoversGeoEvidence(OPT_IN_NOTICE_VERSION)).toBe(false);
    expect(noticeCoversGeoEvidence(LEGACY_NOTICE_VERSION)).toBe(false);
  });
});

describe('noticeCoversGeoTone', () => {
  // Tone is a new purpose of the evaluator request. Only the notice that names
  // it lets the evaluator be asked; a v5 scan is judged without the question.
  // Pinned to the literal v6, not to whatever the current notice is: a bump to
  // v7 must not silently stop judging tone for the v6 scans it still accepts.
  it('covers v6 by name, independently of the current notice', () => {
    expect(noticeCoversGeoTone('core-ai-processing-notice-v6')).toBe(true);
  });

  it('covers only the v6 notice', () => {
    expect(noticeCoversGeoTone(CURRENT_AI_PROCESSING_NOTICE_VERSION)).toBe(true);
    expect(noticeCoversGeoTone(EVIDENCE_NOTICE_VERSION)).toBe(false);
    expect(noticeCoversGeoTone(OPT_IN_NOTICE_VERSION)).toBe(false);
    expect(noticeCoversGeoTone(LEGACY_NOTICE_VERSION)).toBe(false);
  });
});
