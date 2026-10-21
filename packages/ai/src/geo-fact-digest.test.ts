// The site-wide summary of what AI answers say about the business: differences
// from the site grouped by where the site says otherwise, and tone per provider.

import { describe, expect, it } from 'vitest';

import { computeGeoFactDigest, computeGeoToneDigest } from './geo-fact-digest.js';
import { parseGeoEvaluation } from './geo-evaluation.js';
import type { GeoAnswerEvaluation } from './geo-evaluation.js';
import {
  ABOUT_PAGE,
  answerOutcome,
  completedEvaluation,
  contradicted,
  evidenceWith,
  judgedTone,
  PRICING_PAGE,
  unavailableEvaluation,
  unverified,
} from './testing/geo-answer-fixtures.js';
import { DOMAIN } from './testing/harness.js';

const EVIDENCE = evidenceWith([PRICING_PAGE, ABOUT_PAGE]);
const PRICE_QUOTE = 'A Basic audit costs $39';

const outcomes = [
  answerOutcome('a1', 'anthropic'),
  answerOutcome('o1', 'openai'),
  answerOutcome('o2', 'openai'),
];

function evaluations(
  entries: readonly GeoAnswerEvaluation[],
): ReadonlyMap<string, GeoAnswerEvaluation> {
  return new Map(entries.map((entry) => [entry.parentAiRequestKey, entry]));
}

describe('differences from the site', () => {
  it('groups contradicted statements by the page or profile field they were checked against', () => {
    const digest = computeGeoFactDigest({
      outcomes,
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [
          contradicted('A Basic audit costs $99.', 'page-1', PRICE_QUOTE),
          contradicted('FluxRadar is a design agency.', 'profile-2', 'Pay-per-scan website audits'),
        ]),
        completedEvaluation('o1', [
          contradicted('FluxRadar is based in Lviv.', 'page-2', 'run from Kyiv'),
        ]),
      ]),
    });

    expect(digest.answersChecked).toBe(2);
    expect(digest.differenceCount).toBe(3);
    expect(digest.groups.map((group) => group.source)).toEqual([
      { key: `page:https://${DOMAIN}/about`, kind: 'page', label: 'About', url: ABOUT_PAGE.url },
      {
        key: `page:https://${DOMAIN}/pricing`,
        kind: 'page',
        label: 'Pricing',
        url: PRICING_PAGE.url,
      },
      {
        key: 'profile:businessDescription',
        kind: 'profile',
        label: 'Business description',
        url: null,
      },
    ]);
  });

  it('folds the same statement from several answers and providers into one, keeping both quotes', () => {
    const digest = computeGeoFactDigest({
      outcomes,
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [
          contradicted('A Basic audit costs $99.', 'page-1', PRICE_QUOTE),
        ]),
        completedEvaluation('o1', [contradicted('a basic audit costs $99', 'page-1', PRICE_QUOTE)]),
        completedEvaluation('o2', [
          contradicted('A  Basic audit costs $99', 'page-1', PRICE_QUOTE),
        ]),
      ]),
    });

    expect(digest.groups).toHaveLength(1);
    expect(digest.groups[0]?.differences).toEqual([
      {
        claim: 'A Basic audit costs $99.',
        providers: ['anthropic', 'openai'],
        answerQuote: 'A Basic audit costs $99.',
        sourceQuote: PRICE_QUOTE,
      },
    ]);
    expect(digest.differenceCount).toBe(1);
  });

  it('reports no difference when nothing was contradicted', () => {
    const digest = computeGeoFactDigest({
      outcomes,
      evidence: EVIDENCE,
      answerEvaluations: evaluations([completedEvaluation('a1', [])]),
    });

    expect(digest).toEqual({ answersChecked: 1, differenceCount: 0, groups: [] });
  });

  it('does not count an unverified statement as a difference', () => {
    const digest = computeGeoFactDigest({
      outcomes,
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [unverified('FluxRadar has 40 employees.')]),
        unavailableEvaluation('o1'),
      ]),
    });

    expect(digest).toEqual({ answersChecked: 1, differenceCount: 0, groups: [] });
  });

  it('checks nothing when no evaluation ran', () => {
    expect(
      computeGeoFactDigest({ outcomes, evidence: null, answerEvaluations: new Map() }),
    ).toEqual({
      answersChecked: 0,
      differenceCount: 0,
      groups: [],
    });
  });
});

describe('tone per provider', () => {
  it('counts each label per answering provider and keeps the negative quotes', () => {
    const digest = computeGeoToneDigest({
      outcomes,
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [], judgedTone('positive', 'a solid option')),
        completedEvaluation('o1', [], judgedTone('negative', 'users report slow support')),
        unavailableEvaluation('o2'),
      ]),
    });

    expect(digest.judged).toBe(true);
    expect(digest.providers).toEqual([
      {
        provider: 'anthropic',
        answers: 1,
        counts: { positive: 1, neutral: 0, negative: 0, mixed: 0 },
        noDescription: 0,
        unconfirmed: 0,
        notEvaluated: 0,
      },
      {
        provider: 'openai',
        answers: 2,
        counts: { positive: 0, neutral: 0, negative: 1, mixed: 0 },
        noDescription: 0,
        unconfirmed: 0,
        notEvaluated: 1,
      },
    ]);
    expect(digest.negativeQuotes).toEqual([
      {
        provider: 'openai',
        question: 'Which website audit tools do teams recommend?',
        quote: 'users report slow support',
      },
    ]);
  });

  it('tells a judged answer with no description apart from one never judged', () => {
    const digest = computeGeoToneDigest({
      outcomes: [answerOutcome('a1', 'anthropic'), answerOutcome('a2', 'anthropic')],
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [], judgedTone(null)),
        completedEvaluation('a2', []),
      ]),
    });

    expect(digest.providers[0]).toMatchObject({ noDescription: 1, notEvaluated: 1 });
    expect(digest.negativeQuotes).toEqual([]);
  });

  // Every answer says "no information", and the evaluator still offers a tone
  // object for some of them. The scan judged tone; nothing described the
  // business. It must not read as "tone not evaluated".
  it('counts answers that describe nothing as such, even when a tone was offered', () => {
    const offered = parseGeoEvaluation(
      JSON.stringify({
        answerDescribesSubject: false,
        claims: [],
        overall: 'no-description',
        tone: { label: 'neutral', quote: 'no information' },
      }),
      'I have no information about this business.',
      EVIDENCE,
    ).tone;
    const digest = computeGeoToneDigest({
      outcomes: [answerOutcome('a1', 'anthropic'), answerOutcome('a2', 'anthropic')],
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [], offered),
        completedEvaluation('a2', [], judgedTone(null)),
      ]),
    });

    expect(digest.judged).toBe(true);
    expect(digest.providers[0]).toMatchObject({ noDescription: 2, notEvaluated: 0 });
  });

  // Every tone the evaluator offered was refused by validation. The scan did
  // judge tone; the report must say "not confirmed", never "not evaluated".
  it('counts refused tones as unconfirmed and still calls the tone judged', () => {
    const refused = { judged: true, tone: null, adjusted: true } as const;
    const digest = computeGeoToneDigest({
      outcomes: [answerOutcome('a1', 'anthropic'), answerOutcome('a2', 'anthropic')],
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [], refused),
        completedEvaluation('a2', [], refused),
      ]),
    });

    expect(digest.judged).toBe(true);
    expect(digest.providers[0]).toMatchObject({
      unconfirmed: 2,
      notEvaluated: 0,
      noDescription: 0,
    });
  });

  it('counts confirmed and unconfirmed tones side by side', () => {
    const digest = computeGeoToneDigest({
      outcomes: [answerOutcome('a1', 'openai'), answerOutcome('a2', 'openai')],
      evidence: EVIDENCE,
      answerEvaluations: evaluations([
        completedEvaluation('a1', [], judgedTone('positive', 'a solid option')),
        completedEvaluation('a2', [], { judged: true, tone: null, adjusted: true }),
      ]),
    });

    expect(digest.providers[0]).toMatchObject({
      counts: { positive: 1, neutral: 0, negative: 0, mixed: 0 },
      unconfirmed: 1,
      notEvaluated: 0,
    });
  });

  it('is not judged at all when no evaluation asked about tone', () => {
    const digest = computeGeoToneDigest({
      outcomes,
      evidence: EVIDENCE,
      answerEvaluations: evaluations([completedEvaluation('a1', [])]),
    });

    expect(digest.judged).toBe(false);
  });
});
