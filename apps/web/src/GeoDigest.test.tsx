// "What AI says about your business" at the top of the GEO section, and the
// tone and place lines on each answer card — in both languages, for a current
// scan and for one recorded before any of it existed.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GeoEvaluation, GeoObservation, ScanModule } from './api';
import type { Language } from './i18n';
import { ModuleChecksPanel } from './ModuleChecks';

const DIGEST = {
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
        unconfirmed: 1,
        notEvaluated: 0,
      },
    ],
    negativeQuotes: [
      { provider: 'openai', question: 'Which clinics in Kyiv?', quote: 'known for slow replies' },
    ],
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

function geoModule(metadata: Record<string, unknown>): ScanModule {
  return {
    module: 'AI SEO / GEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: null,
    applicableChecks: 4,
    completedApplicableChecks: 4,
    usableOutput: true,
    metadata,
  };
}

function evaluation(overrides: Partial<GeoEvaluation> = {}): GeoEvaluation {
  return {
    status: 'Completed',
    reason: null,
    overall: 'unverified',
    answerDescribesSubject: true,
    claims: [],
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    ...overrides,
  };
}

function observation(overrides: Partial<GeoObservation> = {}): GeoObservation {
  return {
    purpose: 'discovery',
    question: 'Which clinics in Kyiv?',
    status: 'answered',
    reason: null,
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    answer: '1. Rival Dental\n2. Smile Clinic is known for slow replies.',
    citations: [],
    mentions: { brand: 'mentioned', domain: 'not-mentioned' },
    ...overrides,
  };
}

function open(
  metadata: Record<string, unknown>,
  observations: readonly GeoObservation[],
  language: Language = 'en',
): HTMLElement {
  render(
    <ModuleChecksPanel
      module={geoModule(metadata)}
      observations={observations}
      evidence={null}
      language={language}
    />,
  );
  return document.querySelector('.geo-digest') as HTMLElement;
}

afterEach(cleanup);

describe('the summary of what AI says about the business', () => {
  it('shows the differences, the tone and the place, in English', () => {
    const digest = open({ providerVisibility: { answerDigest: DIGEST } }, [observation()]);

    expect(digest).toHaveTextContent('What AI says about your business');
    expect(digest).toHaveTextContent(
      'AI answers differ from your site in 1 place, across 6 answers checked.',
    );
    expect(digest).toHaveTextContent('Implants cost $2,000.');
    expect(digest).toHaveTextContent('The answer says: “implants from $2,000”');
    expect(digest).toHaveTextContent('Your site says: “Implants from $500.”');
    expect(digest).toHaveTextContent('In answers from: ChatGPT · OpenAI; Claude · Anthropic');
    expect(digest).toHaveTextContent('Make the correct fact explicit on this page');
    expect(digest).toHaveTextContent('Positive: 1 · Neutral: 1 · Negative: 1 · Not confirmed: 1');
    expect(digest).toHaveTextContent('“known for slow replies”');
    expect(digest).toHaveTextContent('Named first in 1 of 2 answers that mention you');
    expect(digest).toHaveTextContent('median place in a list: 1.5');
    expect(digest).toHaveTextContent('named after a competitor from your profile in 1 of 2');
    // The site is the evidence, not the judge of truth.
    expect(digest.textContent).not.toMatch(/\bwrong\b/i);
  });

  it('shows the same summary in Ukrainian', () => {
    const digest = open({ providerVisibility: { answerDigest: DIGEST } }, [observation()], 'uk');

    expect(digest).toHaveTextContent('Що ШІ каже про ваш бізнес');
    expect(digest).toHaveTextContent(
      'Відповіді ШІ розходяться з вашим сайтом у 1 місці; звірено 6 відповідей.',
    );
    expect(digest).toHaveTextContent('На вашому сайті: “Implants from $500.”');
    expect(digest).toHaveTextContent(
      'Позитивний: 1 · Нейтральний: 1 · Негативний: 1 · Не підтверджено: 1',
    );
    expect(digest).toHaveTextContent('Названо першим у 1 з 2 відповідей, що вас згадують');
    expect(digest).toHaveTextContent('медіанне місце у списку: 1,5');
    expect(digest.textContent).not.toMatch(/помиля/i);
  });

  it('names a profile field the way the profile form does, in the reader’s language', () => {
    const withProfile = {
      ...DIGEST,
      facts: {
        ...DIGEST.facts,
        groups: [
          {
            source: {
              key: 'profile:region',
              kind: 'profile',
              label: 'Operating region',
              url: null,
            },
            differences: DIGEST.facts.groups[0]?.differences ?? [],
          },
        ],
      },
    };
    const digest = open(
      { providerVisibility: { answerDigest: withProfile } },
      [observation()],
      'uk',
    );

    expect(digest).toHaveTextContent('Профіль вашого сайту: Де працює сайт?');
    expect(digest).not.toHaveTextContent('Operating region');
    expect(digest).toHaveTextContent('Це звірено з полем профілю вашого сайту.');
  });

  it('says "not evaluated in this scan" for a report recorded before the summary existed', () => {
    const digest = open({ providerVisibility: { requests: [] } }, [observation()]);

    expect(digest).toHaveTextContent('Not evaluated in this scan.');
    expect(digest).not.toHaveTextContent('differ from your site in');
  });

  it('says so per part when only some of it was evaluated', () => {
    const digest = open(
      {
        providerVisibility: {
          answerDigest: {
            facts: { answersChecked: 4, differenceCount: 0, groups: [] },
            tone: { judged: false, providers: [], negativeQuotes: [] },
            position: { competitorsConfigured: false, providers: [] },
          },
        },
      },
      [observation()],
      'uk',
    );

    expect(digest).toHaveTextContent('У 4 відповідях, звірених із вашим сайтом, немає нічого');
    expect(digest).toHaveTextContent('Тон у цій перевірці не оцінювався.');
    expect(digest).toHaveTextContent('У цій перевірці не було відповідей на нейтральні запитання.');
  });

  // Every tone was judged and refused: the part says "not confirmed", never
  // that tone was not evaluated in this scan.
  it('shows tones that were judged but not confirmed as such', () => {
    const allRefused = {
      ...DIGEST,
      tone: {
        judged: true,
        providers: [
          {
            provider: 'anthropic',
            answers: 2,
            counts: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
            noDescription: 0,
            unconfirmed: 2,
            notEvaluated: 0,
          },
        ],
        negativeQuotes: [],
      },
    };
    const digest = open({ providerVisibility: { answerDigest: allRefused } }, [observation()]);

    expect(digest).toHaveTextContent('Claude · Anthropic: Not confirmed: 2');
    expect(digest).not.toHaveTextContent('Tone was not evaluated in this scan.');
  });

  it('is not drawn for a section that has no answers and no summary', () => {
    expect(open({}, [])).toBeNull();
  });
});

describe('the tone and the place on an answer card', () => {
  function card(): HTMLElement {
    return document.querySelector('.geo-observation') as HTMLElement;
  }

  it('shows the tone badge with its quote, and the place in the list', () => {
    open({}, [
      observation({
        evaluation: evaluation({
          toneEvaluated: true,
          tone: { label: 'negative', quote: 'known for slow replies' },
        }),
        position: { kind: 'list', rank: 2, listSize: 2, competitorsBefore: 1 },
      }),
    ]);

    expect(card()).toHaveTextContent('Tone: Negative “known for slow replies”');
    expect(card()).toHaveTextContent(
      'Your place in this answer: 2 of 2 in a list; 1 competitor named before you',
    );
  });

  it('says "not evaluated" for a verdict written without the tone question, never neutral', () => {
    open({}, [observation({ evaluation: evaluation() })], 'uk');

    expect(card()).toHaveTextContent('Тон у цій перевірці не оцінювався');
    expect(card()).not.toHaveTextContent('Нейтральний');
    expect(screen.queryByText(/Ваше місце в цій відповіді/)).toBeNull();
  });

  it('tells an answer that described nothing apart from a tone it could not confirm', () => {
    open({}, [
      observation({
        evaluation: evaluation({
          answerDescribesSubject: false,
          toneEvaluated: true,
          tone: null,
          toneAdjusted: false,
        }),
      }),
      observation({
        question: 'Second question?',
        evaluation: evaluation({ toneEvaluated: true, tone: null, toneAdjusted: true }),
      }),
    ]);
    const [first, second] = [...document.querySelectorAll('.geo-observation')];

    expect(first).toHaveTextContent('No tone: the answer did not describe your business');
    expect(second).toHaveTextContent('Tone not shown: it could not be confirmed');
  });
});
