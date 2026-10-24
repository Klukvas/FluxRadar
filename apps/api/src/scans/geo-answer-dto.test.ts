// The tone and the place of a stored answer, as the dashboard reads them back:
// a current record shows both, an older one shows "not evaluated", and a record
// that does not hold up shows neither.

import { describe, expect, it } from 'vitest';

import { storedPositionFrom, storedToneFrom } from './geo-answer-dto.ts';
import { geoObservationsFrom } from './geo-report.ts';

const ANSWER = 'Acme Clinic is known for slow replies but places implants.';

describe('a stored tone', () => {
  it('reads a tone whose quote is in the answer', () => {
    expect(
      storedToneFrom(
        { tone: { label: 'negative', quote: 'known for slow replies' }, toneAdjusted: false },
        ANSWER,
        true,
      ),
    ).toEqual({
      toneEvaluated: true,
      tone: { label: 'negative', quote: 'known for slow replies' },
      toneAdjusted: false,
    });
  });

  it('reads a verdict written without the tone question as not evaluated', () => {
    expect(storedToneFrom({ overall: 'unverified' }, ANSWER, true)).toEqual({
      toneEvaluated: false,
      tone: null,
      toneAdjusted: false,
    });
  });

  it('shows no tone, and refuses none, for an answer that describes nothing', () => {
    expect(
      storedToneFrom({ tone: { label: 'neutral', quote: 'places implants' } }, ANSWER, false),
    ).toEqual({ toneEvaluated: true, tone: null, toneAdjusted: false });
  });

  it('keeps a judged null tone apart from a missing one', () => {
    expect(storedToneFrom({ tone: null, toneAdjusted: false }, ANSWER, false)).toEqual({
      toneEvaluated: true,
      tone: null,
      toneAdjusted: false,
    });
  });

  it('drops a tone whose quote is not in the answer shown beside it', () => {
    expect(
      storedToneFrom({ tone: { label: 'positive', quote: 'the very best' } }, ANSWER, true),
    ).toEqual({ toneEvaluated: true, tone: null, toneAdjusted: true });
    expect(
      storedToneFrom({ tone: { label: 'cheerful', quote: 'places implants' } }, ANSWER, true),
    ).toEqual({ toneEvaluated: true, tone: null, toneAdjusted: true });
  });
});

describe('a stored position', () => {
  it('reads both kinds', () => {
    expect(
      storedPositionFrom({ kind: 'list', rank: 2, listSize: 5, competitorsBefore: 1 }),
    ).toEqual({ kind: 'list', rank: 2, listSize: 5, competitorsBefore: 1 });
    expect(storedPositionFrom({ kind: 'prose', bucket: 'late', competitorsBefore: 0 })).toEqual({
      kind: 'prose',
      bucket: 'late',
      competitorsBefore: 0,
    });
  });

  it('refuses a position that does not hold together', () => {
    expect(storedPositionFrom(undefined)).toBeNull();
    expect(
      storedPositionFrom({ kind: 'list', rank: 6, listSize: 5, competitorsBefore: 0 }),
    ).toBeNull();
    expect(
      storedPositionFrom({ kind: 'prose', bucket: 'middle', competitorsBefore: 0 }),
    ).toBeNull();
    expect(
      storedPositionFrom({ kind: 'list', rank: 1, listSize: 2, competitorsBefore: -1 }),
    ).toBeNull();
  });
});

function metadataWith(evaluation: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    providerVisibility: {
      requests: [
        {
          purpose: 'discovery',
          provider: 'openai',
          status: 'response',
          question: 'Which clinics are good?',
          aiRequestKey: 'key-1',
          evaluation,
          ...extra,
        },
      ],
    },
  });
}

const RESPONSE = {
  aiRequestKey: 'key-1',
  provider: 'openai',
  modelId: 'gpt-5.6-luna',
  rawText: ANSWER,
  citationsJson: '[]',
};

const COMPLETED = {
  status: 'Completed',
  overall: 'unverified',
  answerDescribesSubject: true,
  claims: [],
};

describe('the dashboard observation', () => {
  it('carries the tone and the place of a current record', () => {
    const [observation] = geoObservationsFrom(
      metadataWith(
        { ...COMPLETED, tone: { label: 'mixed', quote: 'places implants' }, toneAdjusted: false },
        { position: { kind: 'prose', bucket: 'first-sentence', competitorsBefore: 0 } },
      ),
      [RESPONSE],
      null,
    );

    expect(observation?.evaluation).toMatchObject({
      toneEvaluated: true,
      tone: { label: 'mixed', quote: 'places implants' },
    });
    expect(observation?.position).toEqual({
      kind: 'prose',
      bucket: 'first-sentence',
      competitorsBefore: 0,
    });
  });

  it('reads a v1 record without either field and without an error', () => {
    const [observation] = geoObservationsFrom(metadataWith(COMPLETED), [RESPONSE], null);

    expect(observation?.evaluation).toMatchObject({
      status: 'Completed',
      toneEvaluated: false,
      tone: null,
    });
    expect(observation?.position).toBeNull();
  });
});
