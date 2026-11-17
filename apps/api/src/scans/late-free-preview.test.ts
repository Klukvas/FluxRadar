// The guard and body of "Add the AI answer" on a finished Free report (D-236),
// and the readiness rule that keeps that report readable while it runs.

import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import { describe, expect, it } from 'vitest';

import { lateRunDecision, releasedAttemptsOf } from '../orchestrator/late-free-preview-job.ts';
import {
  lateFreePreviewBodySchema,
  lateFreePreviewRefusal,
  type LateFreePreviewFacts,
} from './late-free-preview.ts';
import { isReportSnapshotReady } from './report-readiness.ts';

const ACCEPTED: LateFreePreviewFacts = {
  plan: 'Free',
  scanStatus: 'Completed',
  jobStatus: 'Done',
  geoRow: { runtimeStatus: 'Not applicable', statusReason: 'ConsentMissing' },
  consentRecorded: false,
  allowlistedOrigin: false,
  releasedAttempts: 0,
};

function codeOf(facts: LateFreePreviewFacts): string | null {
  return lateFreePreviewRefusal(facts)?.code ?? null;
}

describe('which finished reports may add their AI answer', () => {
  it('accepts a finished Free check whose answer was left out at launch', () => {
    expect(codeOf(ACCEPTED)).toBeNull();
    expect(codeOf({ ...ACCEPTED, scanStatus: 'Partial' })).toBeNull();
  });

  it.each(['Basic', 'Complete', 'Website Audit'])('refuses a %s scan', (plan) => {
    expect(codeOf({ ...ACCEPTED, plan })).toBe('FREE_AI_PREVIEW_FREE_ONLY');
  });

  it.each(['Pending', 'Queued', 'Running', 'Failed', 'Cancelled'])(
    'refuses a %s scan',
    (scanStatus) => {
      expect(codeOf({ ...ACCEPTED, scanStatus })).toBe('FREE_AI_PREVIEW_SCAN_NOT_FINISHED');
    },
  );

  it('refuses while the scan still has an open job, or has none at all', () => {
    for (const jobStatus of ['Pending', 'Claimed', null]) {
      expect(codeOf({ ...ACCEPTED, jobStatus })).toBe('FREE_AI_PREVIEW_SCAN_NOT_FINISHED');
    }
  });

  it('never asks for an operator-allowlisted origin', () => {
    expect(codeOf({ ...ACCEPTED, allowlistedOrigin: true })).toBe('FREE_AI_PREVIEW_ALLOWLISTED');
  });

  it('accepts a press after fewer than three handed-back attempts, and refuses the next', () => {
    expect(codeOf({ ...ACCEPTED, releasedAttempts: 2 })).toBeNull();
    expect(codeOf({ ...ACCEPTED, releasedAttempts: 3 })).toBe('FREE_AI_PREVIEW_ATTEMPTS_EXHAUSTED');
  });

  it('refuses a second consent for the same scan', () => {
    expect(codeOf({ ...ACCEPTED, consentRecorded: true })).toBe('FREE_AI_PREVIEW_ALREADY_ADDED');
  });

  it.each([
    [{ runtimeStatus: 'Completed', statusReason: null }],
    [{ runtimeStatus: 'Unavailable', statusReason: 'ProviderUnavailable' }],
    [{ runtimeStatus: 'Not applicable', statusReason: 'FreePreviewAllowlistedOrigin' }],
    [{ runtimeStatus: 'Not applicable', statusReason: 'FreePreviewAlreadyRequested' }],
    [{ runtimeStatus: 'Pending', statusReason: null }],
    [null],
  ])('refuses a GEO row that is not the skipped ConsentMissing one (%o)', (geoRow) => {
    expect(codeOf({ ...ACCEPTED, geoRow })).toBe('FREE_AI_PREVIEW_NOT_SKIPPED');
  });

  it('answers 409 in the usual error envelope, never a 500', () => {
    const refused = lateFreePreviewRefusal({ ...ACCEPTED, plan: 'Basic' });
    expect(refused?.status).toBe(409);
  });
});

describe('the add-answer body', () => {
  const consent = { providers: ['anthropic'], noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION };

  it('is exactly the Free consent record', () => {
    expect(lateFreePreviewBodySchema.safeParse({ aiConsent: consent }).success).toBe(true);
  });

  it.each([
    [{}],
    [{ aiConsent: { ...consent, providers: ['anthropic', 'openai'] } }],
    [{ aiConsent: { ...consent, providers: ['openai'] } }],
    [{ aiConsent: { ...consent, noticeVersion: 'core-ai-processing-notice-v1' } }],
    [{ aiConsent: { ...consent, language: 'uk' } }],
    [{ aiConsent: consent, retry: true }],
    [consent],
  ])('refuses %o', (body) => {
    expect(lateFreePreviewBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('what one late attempt may do', () => {
  it('asks only from the queued row, refuses after the provider step began', () => {
    expect(lateRunDecision({ runtimeStatus: 'Pending' })).toBe('ask');
    expect(lateRunDecision({ runtimeStatus: 'Running' })).toBe('refuse');
    for (const runtimeStatus of ['Completed', 'Partial', 'Unavailable', 'Not applicable']) {
      expect(lateRunDecision({ runtimeStatus })).toBe('nothing');
    }
    expect(lateRunDecision(null)).toBe('nothing');
  });
});

describe('report readiness while the late answer runs', () => {
  it('keeps a finished report readable under the late preview job only', () => {
    const open = { status: 'Claimed', type: 'free-ai-preview' };
    expect(isReportSnapshotReady({ status: 'Completed' }, open)).toBe(true);
    expect(isReportSnapshotReady({ status: 'Partial' }, { ...open, status: 'Pending' })).toBe(true);
    // Any other open job still means "being finalized"; so does a caller that
    // did not select the type.
    expect(isReportSnapshotReady({ status: 'Completed' }, { ...open, type: 'scan' })).toBe(false);
    expect(isReportSnapshotReady({ status: 'Completed' }, { status: 'Claimed' })).toBe(false);
    expect(isReportSnapshotReady({ status: 'Running' }, open)).toBe(false);
  });
});

describe('how many attempts were handed back', () => {
  it('reads the released note, or the count a queued row carried forward', () => {
    expect(releasedAttemptsOf({})).toBe(0);
    expect(releasedAttemptsOf({ lateAttempt: { count: 2, reason: 'SiteUnreachable' } })).toBe(2);
    expect(releasedAttemptsOf({ releasedAttempts: 1, latePreview: true })).toBe(1);
    expect(releasedAttemptsOf({ lateAttempt: { count: 'x' }, releasedAttempts: null })).toBe(0);
  });
});
