// A small set of evaluator outputs, with what our validator must do with each.
//
// READ THIS BEFORE TRUSTING IT FOR ANYTHING IT IS NOT.
//
// These fixtures validate **our validator**: given this evidence, this answer
// and this JSON, does `parseGeoEvaluation` accept it, reject it, and derive the
// verdict the claims support?
//
// What they are not:
//
//   * not a labelled corpus. Every case here was written by the agent that
//     wrote the validator, from the evidence beside it. Nobody independent
//     labelled them, and a case the author did not think of is not covered;
//   * not a measurement of a grader. How well a real model judges real answers
//     can only be established by live requests against data someone else
//     labelled, and no live call is authorised here;
//   * not calibration. The expected verdicts are what our rule produces, so a
//     wrong rule and a matching expectation would both be green.
//
// A green run means the contract holds. It does not mean the judging is good.
//
// Not part of the published build: tsconfig.build excludes src/testing.

import { buildGeoEvidenceSnapshot, type GeoEvidenceSnapshot } from '../geo-evidence.js';
import type { GeoEvaluationVerdict } from '../geo-evaluation.js';

/** Ukrainian-language site, English answers: the judge has to cross the language. */
export const CROSS_LANGUAGE_EVIDENCE: GeoEvidenceSnapshot = buildGeoEvidenceSnapshot({
  siteDomain: 'ukrdentclub.ua',
  brandIsHostname: false,
  profile: {
    brand: 'УкрДентКлуб',
    businessDescription: 'Стоматологічна клініка в Києві: імплантація та невідкладна допомога.',
    region: 'Київ',
  },
  pages: [
    {
      url: 'https://ukrdentclub.ua/',
      title: 'УкрДентКлуб — стоматологія в Києві',
      headings: ['Імплантація', 'Невідкладна допомога'],
      visibleText: 'Ми ставимо імпланти та приймаємо невідкладних пацієнтів у Києві.',
    },
  ],
});

export interface GraderFixture {
  /** What this case is, in the words of whoever wrote it. */
  readonly label: string;
  readonly evidence: GeoEvidenceSnapshot;
  readonly answer: string;
  /** Exactly what a model returned, as text — parsed by the code under test. */
  readonly modelOutput: string;
  /** null means the validator must reject this output outright. */
  readonly expectedVerdict: GeoEvaluationVerdict | null;
  /** Substring the rejection message must contain, for a rejected fixture. */
  readonly rejectionContains?: string;
}

const KYIV_ANSWER =
  'UkrDentClub is a dental clinic in Kyiv. It offers implants and emergency dental care. ' +
  'It also operates a chain of veterinary hospitals across Poland.';

export const GRADER_FIXTURES: readonly GraderFixture[] = [
  {
    label: 'a fact stated in Ukrainian on the site, asserted in English by the answer',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: KYIV_ANSWER,
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The clinic is in Kyiv and places implants.',
          verdict: 'matched',
          answerQuote: 'a dental clinic in Kyiv',
          sourceId: 'page-1',
          sourceQuote: 'Ми ставимо імпланти та приймаємо невідкладних пацієнтів у Києві.',
        },
      ],
      overall: 'matches-evidence',
    }),
    expectedVerdict: 'matches-evidence',
  },
  {
    label: 'a claim the evidence neither states nor denies stays unverified, not wrong',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: KYIV_ANSWER,
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The business runs veterinary hospitals in Poland.',
          verdict: 'unverified',
          answerQuote: 'a chain of veterinary hospitals across Poland',
        },
      ],
      overall: 'unverified',
    }),
    expectedVerdict: 'unverified',
  },
  {
    label: 'a supported claim beside an unverified one is partial, not support',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: KYIV_ANSWER,
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The clinic is in Kyiv and places implants.',
          verdict: 'matched',
          answerQuote: 'a dental clinic in Kyiv',
          sourceId: 'page-1',
          sourceQuote: 'Ми ставимо імпланти та приймаємо невідкладних пацієнтів у Києві.',
        },
        {
          claim: 'The business runs veterinary hospitals in Poland.',
          verdict: 'unverified',
          answerQuote: 'a chain of veterinary hospitals across Poland',
        },
      ],
      // The model would rather call the whole answer accurate. It does not get
      // to: the verdict is derived from the claims it listed.
      overall: 'matches-evidence',
    }),
    expectedVerdict: 'partially-supported',
  },
  {
    label: 'a name in the evidence supports identity and not what the business does',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: 'УкрДентКлуб is a logistics operator that also sells dental chairs.',
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The answer is about the business the profile names.',
          verdict: 'matched',
          answerQuote: 'УкрДентКлуб is',
          sourceId: 'profile-1',
          sourceQuote: 'УкрДентКлуб',
        },
        {
          // The name matched; that says nothing about the trade. Claiming this
          // one as supported on the same quote is the false positive the
          // rubric now names explicitly.
          claim: 'The business is a logistics operator.',
          verdict: 'contradicted',
          answerQuote: 'a logistics operator',
          sourceId: 'profile-2',
          sourceQuote: 'Стоматологічна клініка в Києві',
        },
      ],
      overall: 'contradicts-evidence',
    }),
    expectedVerdict: 'contradicts-evidence',
  },
  {
    label: 'one contradiction outranks a matched claim in the same answer',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: 'UkrDentClub is a dental clinic in Lviv that does not treat emergencies.',
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The clinic is a dental clinic.',
          verdict: 'matched',
          answerQuote: 'is a dental clinic',
          sourceId: 'profile-2',
          sourceQuote: 'Стоматологічна клініка в Києві',
        },
        {
          claim: 'The clinic does not treat emergencies.',
          verdict: 'contradicted',
          answerQuote: 'does not treat emergencies',
          sourceId: 'page-1',
          sourceQuote: 'приймаємо невідкладних пацієнтів',
        },
      ],
      overall: 'matches-evidence',
    }),
    expectedVerdict: 'contradicts-evidence',
  },
  {
    label: 'a model that declines to describe the subject is an answer, not a failure',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: 'I have no information about the business associated with ukrdentclub.ua.',
    modelOutput: JSON.stringify({
      answerDescribesSubject: false,
      claims: [],
      overall: 'no-description',
    }),
    expectedVerdict: 'no-description',
  },
  {
    label: 'a quote that is not in the answer is rejected, however confident the verdict',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: KYIV_ANSWER,
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The clinic has been open since 1998.',
          verdict: 'matched',
          answerQuote: 'open since 1998',
          sourceId: 'page-1',
          sourceQuote: 'Ми ставимо імпланти',
        },
      ],
      overall: 'matches-evidence',
    }),
    expectedVerdict: null,
    rejectionContains: 'not in the answer',
  },
  {
    label: 'a source id that is not in the snapshot is rejected',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: KYIV_ANSWER,
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The clinic is in Kyiv.',
          verdict: 'matched',
          answerQuote: 'a dental clinic in Kyiv',
          sourceId: 'https://ukrdentclub.ua/about',
          sourceQuote: 'Kyiv',
        },
      ],
      overall: 'matches-evidence',
    }),
    expectedVerdict: null,
    rejectionContains: 'unknown evidence source',
  },
  {
    label: 'a quote attributed to a real source but absent from it is rejected',
    evidence: CROSS_LANGUAGE_EVIDENCE,
    answer: KYIV_ANSWER,
    modelOutput: JSON.stringify({
      answerDescribesSubject: true,
      claims: [
        {
          claim: 'The clinic employs forty dentists.',
          verdict: 'matched',
          answerQuote: 'It offers implants',
          sourceId: 'page-1',
          sourceQuote: 'сорок стоматологів',
        },
      ],
      overall: 'matches-evidence',
    }),
    expectedVerdict: null,
    rejectionContains: 'not in "page-1"',
  },
];
