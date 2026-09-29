// Defensive shape check on Dashboard.geoVisibilitySummary (T6) — the web has
// no zod, so this is the second, independent read that keeps a malformed or
// unexpected payload from throwing mid-render.

import { describe, expect, it } from 'vitest';

import { geoVisibilitySummaryOf } from './geo-visibility';

function validProvider(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'anthropic',
    label: 'Claude · Anthropic',
    questionsAsked: 3,
    questionsAnswered: 3,
    questionsUnavailable: 0,
    brandMeasuredCount: 3,
    brandMentionedCount: 2,
    brandMentionedShare: 2 / 3,
    domainMeasuredCount: 3,
    domainCitedCount: 1,
    domainCitedShare: 1 / 3,
    visibilityScore: 53,
    scoreUnavailableReason: null,
    scoreBasis: 'brand-and-domain',
    byPurpose: {
      'closed-book': {
        asked: 2,
        answered: 2,
        brandMeasured: 2,
        domainMeasured: 2,
        brandMentioned: 1,
        domainMentioned: 1,
      },
      awareness: {
        asked: 0,
        answered: 0,
        brandMeasured: 0,
        domainMeasured: 0,
        brandMentioned: 0,
        domainMentioned: 0,
      },
      discovery: {
        asked: 1,
        answered: 1,
        brandMeasured: 1,
        domainMeasured: 1,
        brandMentioned: 1,
        domainMentioned: 0,
      },
    },
    citedInstead: [{ hostname: 'rival.example', answerCount: 2 }],
    ...overrides,
  };
}

function validSummary(providers: readonly unknown[] = [validProvider()]) {
  return { minMeasuredForScore: 3, weightBrand: 0.6, weightDomain: 0.4, providers };
}

describe('geoVisibilitySummaryOf', () => {
  it('accepts a well-formed summary', () => {
    const result = geoVisibilitySummaryOf(validSummary());
    expect(result).not.toBeNull();
    expect(result?.providers[0]?.provider).toBe('anthropic');
    expect(result?.providers[0]?.visibilityScore).toBe(53);
  });

  it('accepts a null visibilityScore (not enough answers)', () => {
    const result = geoVisibilitySummaryOf(
      validSummary([
        validProvider({
          visibilityScore: null,
          scoreUnavailableReason: 'not-enough-measured',
          scoreBasis: null,
        }),
      ]),
    );
    expect(result?.providers[0]?.visibilityScore).toBeNull();
  });

  it('rejects undefined, null and non-object input', () => {
    expect(geoVisibilitySummaryOf(undefined)).toBeNull();
    expect(geoVisibilitySummaryOf(null)).toBeNull();
    expect(geoVisibilitySummaryOf('not an object')).toBeNull();
    expect(geoVisibilitySummaryOf(42)).toBeNull();
  });

  it('rejects a summary missing minMeasuredForScore/weightBrand/weightDomain', () => {
    const rest = validSummary() as Record<string, unknown>;
    delete rest.minMeasuredForScore;
    expect(geoVisibilitySummaryOf(rest)).toBeNull();
  });

  // A signal measurable in no answer has no share at all; null is data, not a
  // failed check, and must survive the read as null rather than reject the row.
  it('accepts a null share and the reason that goes with it', () => {
    const result = geoVisibilitySummaryOf(
      validSummary([
        validProvider({
          brandMeasuredCount: 0,
          domainMeasuredCount: 0,
          brandMentionedShare: null,
          domainCitedShare: null,
          visibilityScore: null,
          scoreUnavailableReason: 'not-measurable',
          scoreBasis: null,
        }),
      ]),
    );
    expect(result?.providers[0]?.brandMentionedShare).toBeNull();
    expect(result?.providers[0]?.scoreUnavailableReason).toBe('not-measurable');
  });

  it('rejects a provider with an unknown scoreUnavailableReason', () => {
    const bad = validSummary([validProvider({ scoreUnavailableReason: 'because' })]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a provider with an unknown scoreBasis', () => {
    const bad = validSummary([validProvider({ scoreBasis: 'because' })]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  // The comment on GeoProviderVisibility says visibilityScore is null exactly
  // when scoreUnavailableReason is set, and non-null exactly when scoreBasis
  // is set — a record that disagrees with itself is malformed, not a valid
  // "score but also no score" state to render.
  it('rejects a provider whose score and its reason are both present', () => {
    const bad = validSummary([
      validProvider({ visibilityScore: 53, scoreUnavailableReason: 'not-measurable' }),
    ]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a provider with a score but no basis', () => {
    const bad = validSummary([validProvider({ visibilityScore: 53, scoreBasis: null })]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a provider with a basis but no score', () => {
    const bad = validSummary([
      validProvider({
        visibilityScore: null,
        scoreUnavailableReason: 'not-enough-measured',
        scoreBasis: 'brand-and-domain',
      }),
    ]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a provider missing the measured counts', () => {
    const rest = validProvider() as Record<string, unknown>;
    delete rest.brandMeasuredCount;
    expect(geoVisibilitySummaryOf(validSummary([rest]))).toBeNull();
  });

  it('rejects byPurpose counts missing the measured fields', () => {
    const counts = validProvider().byPurpose as Record<string, Record<string, unknown>>;
    delete counts.discovery?.brandMeasured;
    expect(geoVisibilitySummaryOf(validSummary([validProvider({ byPurpose: counts })]))).toBeNull();
  });

  it('rejects a summary whose providers is not an array', () => {
    expect(geoVisibilitySummaryOf({ ...validSummary(), providers: 'nope' })).toBeNull();
  });

  it('rejects a provider with an out-of-range share', () => {
    const bad = validSummary([validProvider({ brandMentionedShare: 1.5 })]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a provider with an out-of-range score', () => {
    const bad = validSummary([validProvider({ visibilityScore: 101 })]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a provider whose byPurpose is missing a required purpose', () => {
    const incomplete = validProvider().byPurpose as Record<string, unknown>;
    delete incomplete.discovery;
    const bad = validSummary([validProvider({ byPurpose: incomplete })]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a citedInstead entry missing a field', () => {
    const bad = validSummary([validProvider({ citedInstead: [{ hostname: 'rival.example' }] })]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects the whole summary when just one provider entry is malformed', () => {
    const bad = validSummary([validProvider(), { provider: 'openai' }]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  // T7: shareOfVoice is absent on every stored record before this field
  // existed — old-metadata compatibility means "absent" reads the same as
  // "no competitors configured", never a rejected provider.
  it('accepts a provider with no shareOfVoice field at all (pre-T7 record)', () => {
    const provider = validProvider() as Record<string, unknown>;
    delete provider.shareOfVoice;
    const result = geoVisibilitySummaryOf(validSummary([provider]));
    expect(result?.providers[0]?.shareOfVoice).toBeNull();
  });

  it('accepts an explicit null shareOfVoice (no competitors configured)', () => {
    const result = geoVisibilitySummaryOf(validSummary([validProvider({ shareOfVoice: null })]));
    expect(result?.providers[0]?.shareOfVoice).toBeNull();
  });

  it('accepts a well-formed shareOfVoice, ordered as stored', () => {
    const shareOfVoice = {
      denominator: 4,
      brandMentionsInScope: 2,
      brandShare: 0.5,
      competitors: [
        { name: 'Acme Audit', mentionedCount: 1, share: 0.25 },
        { name: 'Beta Tools', mentionedCount: 1, share: 0.25 },
      ],
    };
    const result = geoVisibilitySummaryOf(validSummary([validProvider({ shareOfVoice })]));
    expect(result?.providers[0]?.shareOfVoice).toEqual(shareOfVoice);
  });

  it('accepts a shareOfVoice with a null brandShare and null competitor shares', () => {
    const shareOfVoice = {
      denominator: 0,
      brandMentionsInScope: 0,
      brandShare: null,
      competitors: [{ name: 'Acme Audit', mentionedCount: 0, share: null }],
    };
    const result = geoVisibilitySummaryOf(validSummary([validProvider({ shareOfVoice })]));
    expect(result?.providers[0]?.shareOfVoice).toEqual(shareOfVoice);
  });

  it('rejects the whole provider when shareOfVoice is present but malformed', () => {
    const bad = validSummary([
      validProvider({ shareOfVoice: { denominator: 4, brandMentionsInScope: 2 } }),
    ]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });

  it('rejects a shareOfVoice with an out-of-range competitor share', () => {
    const bad = validSummary([
      validProvider({
        shareOfVoice: {
          denominator: 4,
          brandMentionsInScope: 2,
          brandShare: 0.5,
          competitors: [{ name: 'Acme Audit', mentionedCount: 1, share: 1.5 }],
        },
      }),
    ]);
    expect(geoVisibilitySummaryOf(bad)).toBeNull();
  });
});
