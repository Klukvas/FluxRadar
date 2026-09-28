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
    brandMentionedCount: 2,
    brandMentionedShare: 2 / 3,
    domainCitedCount: 1,
    domainCitedShare: 1 / 3,
    visibilityScore: 53,
    byPurpose: {
      'closed-book': { asked: 2, answered: 2, brandMentioned: 1, domainMentioned: 1 },
      awareness: { asked: 0, answered: 0, brandMentioned: 0, domainMentioned: 0 },
      discovery: { asked: 1, answered: 1, brandMentioned: 1, domainMentioned: 0 },
    },
    citedInstead: [{ hostname: 'rival.example', answerCount: 2 }],
    ...overrides,
  };
}

function validSummary(providers: readonly unknown[] = [validProvider()]) {
  return { minAnsweredForScore: 3, weightBrand: 0.6, weightDomain: 0.4, providers };
}

describe('geoVisibilitySummaryOf', () => {
  it('accepts a well-formed summary', () => {
    const result = geoVisibilitySummaryOf(validSummary());
    expect(result).not.toBeNull();
    expect(result?.providers[0]?.provider).toBe('anthropic');
    expect(result?.providers[0]?.visibilityScore).toBe(53);
  });

  it('accepts a null visibilityScore (not enough answers)', () => {
    const result = geoVisibilitySummaryOf(validSummary([validProvider({ visibilityScore: null })]));
    expect(result?.providers[0]?.visibilityScore).toBeNull();
  });

  it('rejects undefined, null and non-object input', () => {
    expect(geoVisibilitySummaryOf(undefined)).toBeNull();
    expect(geoVisibilitySummaryOf(null)).toBeNull();
    expect(geoVisibilitySummaryOf('not an object')).toBeNull();
    expect(geoVisibilitySummaryOf(42)).toBeNull();
  });

  it('rejects a summary missing minAnsweredForScore/weightBrand/weightDomain', () => {
    const rest = validSummary() as Record<string, unknown>;
    delete rest.minAnsweredForScore;
    expect(geoVisibilitySummaryOf(rest)).toBeNull();
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
});
