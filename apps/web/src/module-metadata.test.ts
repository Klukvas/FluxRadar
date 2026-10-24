import { describe, expect, it } from 'vitest';

import type { GeoObservation } from './api';
import {
  answerPositionOf,
  answerToneOf,
  geoAnswerDigestOf,
  geoChecksOf,
  ruleCheckResult,
  ruleChecksOf,
  type RuleCheck,
} from './module-metadata';

// Module metadata is stored JSON whose shape grew between releases, so these
// readers must turn an old or malformed row into "less to show" — never a throw,
// and never a check the audit did not record.

function check(overrides: Partial<RuleCheck> = {}): RuleCheck {
  return {
    ruleId: 'A11Y-001',
    title: 'text contrast',
    targetKind: 'page',
    informational: false,
    applicableTargets: 3,
    affectedTargets: 0,
    notApplicableReason: null,
    ...overrides,
  };
}

describe('ruleChecksOf', () => {
  it('reads the recorded checks and drops entries it cannot trust', () => {
    const checks = ruleChecksOf({
      ruleChecks: [
        {
          ruleId: 'A11Y-001',
          title: 'text contrast',
          targetKind: 'page',
          scoring: 'scored',
          applicableTargets: 3,
          affectedTargets: 1,
        },
        {
          ruleId: 'A11Y-011',
          title: 'audit transparency',
          targetKind: 'environment',
          scoring: 'informational',
          applicableTargets: 1,
          affectedTargets: 0,
        },
        { ruleId: 'A11Y-002', title: 'alt text', applicableTargets: '3', affectedTargets: 0 },
        null,
        'A11Y-003',
      ],
    });

    expect(checks).toEqual([
      check({ affectedTargets: 1 }),
      check({
        ruleId: 'A11Y-011',
        title: 'audit transparency',
        targetKind: 'environment',
        informational: true,
        applicableTargets: 1,
      }),
    ]);
  });

  it('reads the reason a rule gave for having nothing to judge', () => {
    const [judged, unjudged] = ruleChecksOf({
      ruleChecks: [
        {
          ruleId: 'SEO-TECH-011',
          title: 'weakly linked pages',
          targetKind: 'page',
          scoring: 'scored',
          applicableTargets: 0,
          affectedTargets: 0,
          notApplicableReason: 'no-candidates',
        },
        // A row written before rules named their reason, and one whose reason is
        // not a string: both read as "no reason recorded", never as a throw.
        {
          ruleId: 'SEO-TECH-009',
          title: 'orphan pages',
          targetKind: 'page',
          scoring: 'scored',
          applicableTargets: 0,
          affectedTargets: 0,
          notApplicableReason: 7,
        },
      ],
    });

    expect(judged?.notApplicableReason).toBe('no-candidates');
    expect(unjudged?.notApplicableReason).toBeNull();
  });

  it('is empty for a row recorded before checks were stored', () => {
    expect(ruleChecksOf(undefined)).toEqual([]);
    expect(ruleChecksOf({ standard: 'WCAG 2.2 AA' })).toEqual([]);
  });
});

describe('ruleCheckResult', () => {
  it('never calls a check with nothing to look at a pass', () => {
    expect(ruleCheckResult(check({ applicableTargets: 0 }))).toBe('notApplicable');
  });

  it('separates a clean check from one that found something', () => {
    expect(ruleCheckResult(check())).toBe('passed');
    expect(ruleCheckResult(check({ affectedTargets: 2 }))).toBe('issues');
  });

  it('reports what an informational rule found as a note, not an issue', () => {
    expect(ruleCheckResult(check({ informational: true, affectedTargets: 1 }))).toBe('noted');
  });
});

describe('geoChecksOf', () => {
  it('is null for a section that recorded none of its checks', () => {
    expect(geoChecksOf(undefined)).toBeNull();
    expect(geoChecksOf({ standard: 'AI crawler readiness' })).toBeNull();
  });

  it('reads crawler access, page readiness and the generated questions', () => {
    const checks = geoChecksOf({
      robots: {
        status: 'available',
        agents: [
          { userAgent: 'GPTBot', status: 'allowed' },
          { userAgent: 'ClaudeBot', status: 'sometimes' },
        ],
      },
      pages: { checked: 4, extractableContent: 3, structuredData: 1, socialPreview: 0, checks: [] },
      providerVisibility: {
        queryGeneration: {
          status: 'Completed',
          generatedQuestions: ['Which clinics offer implants?', 7],
        },
      },
    });

    expect(checks).toEqual({
      robotsReadable: true,
      crawlers: [{ userAgent: 'GPTBot', status: 'allowed', purpose: 'training' }],
      pages: { checked: 4, extractableContent: 3, structuredData: 1, socialPreview: 0 },
      queryGeneration: { status: 'Completed', questions: ['Which clinics offer implants?'] },
    });
  });

  it('does not treat an unreadable robots.txt as readable', () => {
    expect(geoChecksOf({ robots: { status: 'unavailable', agents: [] } })).toMatchObject({
      robotsReadable: false,
      pages: null,
      queryGeneration: null,
    });
  });
});

it('validates crawler purposes and supports the original six legacy agents', () => {
  const checks = geoChecksOf({
    robots: {
      status: 'available',
      agents: [
        { userAgent: 'Claude-User', status: 'allowed', purpose: 'user-fetch' },
        { userAgent: 'GPTBot', status: 'blocked' },
        { userAgent: 'GPTBot', status: 'allowed', purpose: 'invented' },
        { userAgent: 'Unknown', status: 'allowed' },
      ],
    },
  });
  expect(checks?.crawlers).toEqual([
    { userAgent: 'Claude-User', status: 'allowed', purpose: 'user-fetch' },
    { userAgent: 'GPTBot', status: 'blocked', purpose: 'training' },
  ]);
});

/** The digest a current scan stores beside its answers. */
const STORED_DIGEST = {
  facts: {
    answersChecked: 6,
    differenceCount: 1,
    groups: [
      {
        source: {
          key: 'page:https://smile.example/prices',
          kind: 'page',
          label: 'Prices',
          url: 'https://smile.example/prices/',
        },
        differences: [
          {
            claim: 'Implants cost $2,000.',
            providers: ['openai', 'anthropic'],
            answerQuote: 'implants from $2,000',
            sourceQuote: 'Implants from $500.',
          },
        ],
      },
    ],
  },
  tone: {
    judged: true,
    providers: [
      {
        provider: 'openai',
        answers: 3,
        counts: { positive: 1, neutral: 1, negative: 1, mixed: 0 },
        noDescription: 0,
        notEvaluated: 0,
      },
    ],
    negativeQuotes: [{ provider: 'openai', question: 'Which clinics?', quote: 'slow replies' }],
  },
  position: {
    competitorsConfigured: true,
    minListAnswersForMedian: 2,
    providers: [
      {
        provider: 'openai',
        discoveryAnswers: 3,
        placedAnswers: 2,
        firstPlace: 1,
        inList: 2,
        medianListRank: 1.5,
        afterCompetitors: 1,
      },
    ],
  },
};

describe('geoAnswerDigestOf', () => {
  it('reads the three parts a current scan stores', () => {
    const digest = geoAnswerDigestOf({ providerVisibility: { answerDigest: STORED_DIGEST } });

    expect(digest?.facts).toEqual({
      answersChecked: 6,
      differenceCount: 1,
      groups: STORED_DIGEST.facts.groups,
    });
    expect(digest?.tone?.negativeQuotes).toEqual([
      { provider: 'openai', question: 'Which clinics?', quote: 'slow replies' },
    ]);
    expect(digest?.position?.providers[0]).toMatchObject({ medianListRank: 1.5, firstPlace: 1 });
  });

  // `unconfirmed` arrived after the first digests were written: those read as 0.
  it('reads the unconfirmed tone count, and 0 where an older digest has none', () => {
    const older = geoAnswerDigestOf({ providerVisibility: { answerDigest: STORED_DIGEST } });
    const newer = geoAnswerDigestOf({
      providerVisibility: {
        answerDigest: {
          ...STORED_DIGEST,
          tone: {
            ...STORED_DIGEST.tone,
            providers: [{ ...STORED_DIGEST.tone.providers[0], unconfirmed: 2 }],
          },
        },
      },
    });

    expect(older?.tone?.providers[0]?.unconfirmed).toBe(0);
    expect(newer?.tone?.providers[0]?.unconfirmed).toBe(2);
  });

  it('is null for a scan recorded before the digest existed', () => {
    expect(geoAnswerDigestOf({ providerVisibility: { requests: [] } })).toBeNull();
    expect(geoAnswerDigestOf(undefined)).toBeNull();
  });

  it('drops a part it cannot trust and keeps the others', () => {
    const digest = geoAnswerDigestOf({
      providerVisibility: {
        answerDigest: { ...STORED_DIGEST, tone: { judged: 'yes' }, position: null },
      },
    });

    expect(digest?.facts?.groups).toHaveLength(1);
    expect(digest?.tone).toBeNull();
    expect(digest?.position).toBeNull();
  });

  it('drops a fact group without a source or without differences', () => {
    const digest = geoAnswerDigestOf({
      providerVisibility: {
        answerDigest: {
          facts: {
            answersChecked: 2,
            groups: [
              { source: { key: 'page:x', kind: 'page', label: 'X', url: null }, differences: [] },
              { differences: STORED_DIGEST.facts.groups[0]?.differences },
              STORED_DIGEST.facts.groups[0],
            ],
          },
        },
      },
    });

    expect(digest?.facts).toMatchObject({ answersChecked: 2, differenceCount: 1 });
    expect(digest?.facts?.groups).toHaveLength(1);
  });
});

function answered(overrides: Partial<GeoObservation> = {}): GeoObservation {
  return {
    purpose: 'discovery',
    question: 'Which clinics?',
    status: 'answered',
    reason: null,
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    answer: 'Answer',
    citations: [],
    mentions: null,
    ...overrides,
  };
}

describe('the tone and the place of one answer', () => {
  it('reads both when the API returned them', () => {
    expect(
      answerToneOf({
        status: 'Completed',
        reason: null,
        overall: 'unverified',
        answerDescribesSubject: true,
        claims: [],
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        toneEvaluated: true,
        tone: { label: 'mixed', quote: 'good but slow' },
      }),
    ).toEqual({ label: 'mixed', quote: 'good but slow' });
    expect(
      answerPositionOf(
        answered({ position: { kind: 'list', rank: 2, listSize: 4, competitorsBefore: 1 } }),
      ),
    ).toEqual({ kind: 'list', rank: 2, listSize: 4, competitorsBefore: 1 });
  });

  it('answers null for a response from an older API, or a shape it does not know', () => {
    expect(answerToneOf(undefined)).toBeNull();
    expect(answerPositionOf(answered())).toBeNull();
    expect(
      answerPositionOf(
        answered({
          position: { kind: 'prose', bucket: 'middle', competitorsBefore: 0 } as never,
        }),
      ),
    ).toBeNull();
  });
});
