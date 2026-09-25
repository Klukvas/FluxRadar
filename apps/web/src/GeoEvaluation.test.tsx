// What the AI SEO / GEO section shows about a direct question.
//
// It used to end in two badges that both read "not measured": the question
// named the brand, and for a profile called after its own hostname it named the
// domain too, so neither signal could mean anything. These tests hold the
// replacement to its promises — that each state is distinguishable, in both
// languages, and that an absent check never renders as a passed one.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GeoEvaluation, GeoEvidence, GeoObservation, ScanModule } from './api';
import type { Language } from './i18n';
import { ModuleChecksPanel } from './ModuleChecks';

const EVIDENCE: GeoEvidence = {
  sufficiency: 'substantive',
  limits: ['This evidence is only what this scan observed.'],
  sources: [
    {
      id: 'profile-1',
      kind: 'profile',
      label: 'Brand name',
      url: null,
      excerpt: 'Smile Clinic',
      provenance: 'owner-entered profile field (unverified claim by the site owner)',
    },
    {
      id: 'page-1',
      kind: 'page',
      label: 'Smile Clinic — dental care in Kyiv',
      url: 'https://smile.example/',
      excerpt: 'We place implants and see emergency patients in Kyiv.',
      provenance: 'text read from the public page during this scan',
    },
  ],
};

const GEO_MODULE: ScanModule = {
  module: 'AI SEO / GEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 100,
  applicableChecks: 4,
  completedApplicableChecks: 4,
  usableOutput: true,
  metadata: {},
};

function observation(overrides: Partial<GeoObservation> = {}): GeoObservation {
  return {
    purpose: 'closed-book',
    question: 'What do you know about the business associated with smile.example?',
    status: 'answered',
    reason: null,
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    answer: 'Smile Clinic is a dental clinic in Kyiv that places implants.',
    citations: [],
    mentions: { brand: 'brand-is-hostname', domain: 'named-in-question' },
    ...overrides,
  };
}

function evaluation(overrides: Partial<GeoEvaluation> = {}): GeoEvaluation {
  return {
    status: 'Completed',
    reason: null,
    overall: 'matches-evidence',
    answerDescribesSubject: true,
    claims: [
      {
        claim: 'The business is a dental clinic in Kyiv.',
        verdict: 'matched',
        answerQuote: 'a dental clinic in Kyiv',
        sourceId: 'page-1',
        sourceQuote: 'We place implants and see emergency patients in Kyiv.',
      },
    ],
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    ...overrides,
  };
}

function open(
  observations: readonly GeoObservation[],
  language: Language = 'en',
  evidence: GeoEvidence | null = EVIDENCE,
): HTMLElement {
  render(
    <ModuleChecksPanel
      module={GEO_MODULE}
      observations={observations}
      evidence={evidence}
      language={language}
    />,
  );
  return document.querySelector('.geo-observation') as HTMLElement;
}

/** The whole section, where the lead paragraph above the cards is rendered. */
function panel(): HTMLElement {
  return document.querySelector('.module-checks') as HTMLElement;
}

afterEach(cleanup);

describe('a closed-book observation', () => {
  it('shows what the evidence says instead of two "not measured" badges', () => {
    const card = open([observation({ evaluation: evaluation() })]);

    expect(within(card).queryByLabelText('Mention signals')).toBeNull();
    expect(card).toHaveTextContent('Direct question, asked closed-book');
    expect(card).toHaveTextContent('Checked claims supported by your site’s evidence');
    expect(card).toHaveTextContent('The business is a dental clinic in Kyiv.');
    expect(card).toHaveTextContent('From the answer');
    expect(card).toHaveTextContent('a dental clinic in Kyiv');
    expect(card).toHaveTextContent('We place implants and see emergency patients in Kyiv.');
    expect(card).toHaveTextContent('Smile Clinic — dental care in Kyiv');
    // The verdict covers the listed claims and nothing else, and says so.
    expect(card).toHaveTextContent('covers only the claims listed above');
  });

  it('will not call an answer supported when part of it is merely unverified', () => {
    const card = open([
      observation({
        answer: 'Smile Clinic is a dental clinic in Kyiv. It also sells dental software.',
        evaluation: evaluation({
          overall: 'matches-evidence',
          claims: [
            {
              claim: 'The business is a dental clinic in Kyiv.',
              verdict: 'matched',
              answerQuote: 'a dental clinic in Kyiv',
              sourceId: 'page-1',
              sourceQuote: 'We place implants and see emergency patients in Kyiv.',
            },
            {
              claim: 'The business sells dental software.',
              verdict: 'unverified',
              answerQuote: 'sells dental software',
              sourceId: null,
              sourceQuote: null,
            },
          ],
        }),
      }),
    ]);

    // The API derives the aggregate; this asserts the label the reader gets for
    // the mixed case, which must not be the unqualified "supported" one.
    expect(card).toHaveTextContent('Partly supported');
    expect(card).not.toHaveTextContent('Checked claims supported by your site’s evidence');
  });

  it('says whether a cited quote is the owner’s own claim or text from a page', () => {
    const card = open([
      observation({
        answer: 'Smile Clinic is a dental clinic in Kyiv.',
        evaluation: evaluation({
          overall: 'partially-supported',
          claims: [
            {
              claim: 'The answer names the business the profile names.',
              verdict: 'matched',
              answerQuote: 'Smile Clinic',
              sourceId: 'profile-1',
              sourceQuote: 'Smile Clinic',
            },
            {
              claim: 'The business is a dental clinic in Kyiv.',
              verdict: 'matched',
              answerQuote: 'a dental clinic in Kyiv',
              sourceId: 'page-1',
              sourceQuote: 'We place implants and see emergency patients in Kyiv.',
            },
          ],
        }),
      }),
    ]);

    const claims = within(card).getAllByRole('listitem');
    expect(claims[0]).toHaveTextContent('Profile field you saved — your own claim, not verified');
    expect(claims[1]).toHaveTextContent('Text read from your public page');
    const link = within(claims[1] as HTMLElement).getByRole('link');
    expect(link).toHaveAttribute('href', 'https://smile.example/');
  });

  it('separates a contradiction from a claim the evidence simply does not cover', () => {
    const card = open([
      observation({
        answer: 'Smile Clinic is in Lviv and runs veterinary hospitals in Poland.',
        evaluation: evaluation({
          overall: 'contradicts-evidence',
          claims: [
            {
              claim: 'The clinic is in Lviv.',
              verdict: 'contradicted',
              answerQuote: 'is in Lviv',
              sourceId: 'page-1',
              sourceQuote: 'in Kyiv',
            },
            {
              claim: 'It runs veterinary hospitals in Poland.',
              verdict: 'unverified',
              answerQuote: 'veterinary hospitals in Poland',
              sourceId: null,
              sourceQuote: null,
            },
          ],
        }),
      }),
    ]);

    expect(card).toHaveTextContent('Contradicted by your site’s evidence');
    const claims = within(card).getAllByRole('listitem');
    expect(claims[0]).toHaveTextContent('Contradicted');
    expect(claims[1]).toHaveTextContent('Unverified');
    // An absent fact cites nothing rather than borrowing a source to look checked.
    expect(claims[1]).not.toHaveTextContent('Your site’s evidence');
  });

  it('keeps a genuine "I do not know" distinct from a failed check', () => {
    const card = open([
      observation({
        answer: 'I have no information about this business.',
        evaluation: evaluation({
          overall: 'no-description',
          answerDescribesSubject: false,
          claims: [],
        }),
      }),
    ]);

    expect(card).toHaveTextContent('No description given');
    expect(card).toHaveTextContent('carried no description of your business');
    expect(card).toHaveTextContent('I have no information about this business.');
  });

  it('keeps the answer visible and says it is unverified when the evaluator failed', () => {
    const card = open([
      observation({
        evaluation: evaluation({
          status: 'Unavailable',
          reason: 'ProviderUnavailable',
          overall: null,
          answerDescribesSubject: null,
          claims: [],
        }),
      }),
    ]);

    expect(card).toHaveTextContent('Smile Clinic is a dental clinic in Kyiv');
    expect(card).toHaveTextContent('could not run for this answer');
    expect(card).not.toHaveTextContent('supported by your site’s evidence');
  });

  it('says when the scan read too little of the site to check anything', () => {
    const card = open(
      [
        observation({
          evaluation: evaluation({
            status: 'Unavailable',
            reason: 'InsufficientEvidence',
            overall: null,
            answerDescribesSubject: null,
            claims: [],
          }),
        }),
      ],
      'en',
      null,
    );

    expect(card).toHaveTextContent('read too little of your site');
  });

  it('says an answer was not evaluated rather than showing nothing', () => {
    const card = open([observation({ evaluation: null })]);

    expect(card).toHaveTextContent('was not evaluated in this scan');
    // A missing evaluation is not evidence of when the scan ran: scans on the
    // current notice version reach this state too, so the copy must not blame
    // the scan's age for it.
    expect(card).not.toHaveTextContent('before that check existed');
  });
});

describe('older and neutral observations', () => {
  it('does not relabel a historical awareness question as closed-book', () => {
    const card = open([
      observation({
        purpose: 'awareness',
        question: 'What is Smile Clinic? What is its official website?',
        mentions: { brand: 'named-in-question', domain: 'named-in-question' },
        evaluation: null,
      }),
    ]);

    expect(card).toHaveTextContent('Direct awareness question');
    expect(card).not.toHaveTextContent('closed-book');
    // It keeps the badges it was written with, and gains no empty verdict slot.
    expect(within(card).getByLabelText('Mention signals')).toBeTruthy();
    expect(card).not.toHaveTextContent('was not evaluated');
    // The lead sits above every record, this one included. It must not tell the
    // reader that this question was asked closed-book or that its answer was
    // checked against the site: neither happened for an awareness record.
    expect(panel()).not.toHaveTextContent('closed-book');
    expect(panel()).not.toHaveTextContent('each answer is then checked');
  });

  it('keeps the section lead honest when only some answers were evaluated', () => {
    render(
      <ModuleChecksPanel
        module={GEO_MODULE}
        observations={[
          observation({ evaluation: evaluation() }),
          observation({ evaluation: null }),
          observation({ purpose: 'awareness', evaluation: null }),
        ]}
        evidence={EVIDENCE}
        language="en"
      />,
    );

    expect(panel()).not.toHaveTextContent('each answer is then checked');
    expect(panel()).toHaveTextContent('where an evaluation ran');
    // The lead says less; the card that does have a verdict still shows it.
    expect(panel()).toHaveTextContent('Checked claims supported by your site’s evidence');
    expect(panel()).toHaveTextContent('was not evaluated in this scan');
  });

  it('keeps a discovery question’s mention signals and adds its verdict', () => {
    const card = open([
      observation({
        purpose: 'discovery',
        question: 'Which dental clinics offer implants in Kyiv?',
        answer: 'Smile Clinic offers implants in Kyiv.',
        mentions: { brand: 'mentioned', domain: 'not-mentioned' },
        evaluation: evaluation({
          claims: [
            {
              claim: 'The clinic places implants in Kyiv.',
              verdict: 'matched',
              answerQuote: 'offers implants in Kyiv',
              sourceId: 'page-1',
              sourceQuote: 'We place implants',
            },
          ],
        }),
      }),
    ]);

    expect(card).toHaveTextContent('Domain discovery question');
    expect(within(card).getByLabelText('Mention signals')).toHaveTextContent('Brand mentioned');
    expect(card).toHaveTextContent('Checked claims supported by your site’s evidence');
  });

  it('does not turn a discovery answer about other providers into an admission', () => {
    const card = open([
      observation({
        purpose: 'discovery',
        question: 'Which dental clinics offer implants in Kyiv?',
        answer: 'Two well-known options are Dental Plus and Kyiv Implant Centre.',
        mentions: { brand: 'not-mentioned', domain: 'not-mentioned' },
        evaluation: evaluation({
          overall: 'no-description',
          answerDescribesSubject: false,
          claims: [],
        }),
      }),
    ]);

    expect(card).toHaveTextContent('Your business was not mentioned');
    expect(card).toHaveTextContent('did not mention your business');
    // The model said nothing about this business either way. Reporting that as
    // "it has no information about you" would invent a statement it never made.
    expect(card).not.toHaveTextContent('no description of your business');
    expect(card).not.toHaveTextContent('No description given');
  });
});

describe('the section summary', () => {
  it('counts only the answers that genuinely got a verdict', () => {
    render(
      <ModuleChecksPanel
        module={GEO_MODULE}
        observations={[
          observation({ evaluation: evaluation() }),
          observation({
            evaluation: evaluation({ status: 'Unavailable', reason: 'QuotaExceeded' }),
          }),
          observation({ evaluation: null }),
          observation({ status: 'unavailable', answer: null, evaluation: null }),
        ]}
        evidence={EVIDENCE}
        language="en"
      />,
    );

    expect(
      screen.getByText('Evaluated 1 of 3 answers against evidence from this scan.'),
    ).toBeTruthy();
  });
});

describe('in Ukrainian', () => {
  it('names every evaluation state', () => {
    const card = open([observation({ evaluation: evaluation() })], 'uk');

    expect(card).toHaveTextContent('Пряме питання «із закритою книгою»');
    expect(card).toHaveTextContent('Перевірені твердження підтверджено доказами вашого сайту');
    expect(card).toHaveTextContent('З відповіді');
    expect(card).toHaveTextContent('Доказ із вашого сайту');
    expect(card).toHaveTextContent('Текст, прочитаний з вашої публічної сторінки');
    expect(card).toHaveTextContent('стосується лише перелічених вище тверджень');
  });

  it('says in Ukrainian when the evaluator could not run', () => {
    const card = open(
      [
        observation({
          evaluation: evaluation({
            status: 'Unavailable',
            reason: 'ProviderUnavailable',
            overall: null,
            claims: [],
          }),
        }),
      ],
      'uk',
    );

    expect(card).toHaveTextContent('виконати не вдалося');
  });

  it('says in Ukrainian when the answer was never evaluated', () => {
    const card = open([observation({ evaluation: null })], 'uk');

    expect(card).toHaveTextContent('Цю відповідь не оцінювали');
  });

  it('keeps the Ukrainian section lead honest about a historical record', () => {
    open([observation({ purpose: 'awareness', evaluation: null })], 'uk');

    expect(panel()).not.toHaveTextContent('«із закритою книгою»');
    expect(panel()).toHaveTextContent('якщо оцінювання виконувалося');
  });
});
