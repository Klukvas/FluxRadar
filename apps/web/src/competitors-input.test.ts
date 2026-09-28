// The profile form's competitors field (T7) — parsing and validation mirror
// the API's competitorsListProblem exactly, so this pins the same cases.

import { describe, expect, it } from 'vitest';

import { competitorsError, parseCompetitorsInput } from './competitors-input';

describe('parseCompetitorsInput', () => {
  it('splits, trims and drops empty entries', () => {
    expect(parseCompetitorsInput(' Acme ,  , Beta Co ,')).toEqual(['Acme', 'Beta Co']);
  });

  it('returns an empty list for a blank field', () => {
    expect(parseCompetitorsInput('   ')).toEqual([]);
    expect(parseCompetitorsInput('')).toEqual([]);
  });
});

describe('competitorsError', () => {
  const BRAND = 'Smile Clinic';
  const DOMAIN = 'https://smile.example';

  it('is null for a valid list', () => {
    expect(competitorsError(['Acme Dental', 'Bright Smile'], BRAND, DOMAIN)).toBeNull();
  });

  it('is null for an empty list', () => {
    expect(competitorsError([], BRAND, DOMAIN)).toBeNull();
  });

  it('flags more than 5 names', () => {
    const error = competitorsError(['A1', 'B1', 'C1', 'D1', 'E1', 'F1'], BRAND, DOMAIN);
    expect(error).toEqual({ kind: 'too-many' });
  });

  it('flags a name shorter than 2 characters', () => {
    expect(competitorsError(['A'], BRAND, DOMAIN)).toEqual({ kind: 'too-short', name: 'A' });
  });

  it('flags a name longer than 64 characters', () => {
    const long = 'x'.repeat(65);
    expect(competitorsError([long], BRAND, DOMAIN)).toEqual({ kind: 'too-long', name: long });
  });

  it('flags a case-insensitive duplicate', () => {
    expect(competitorsError(['Acme', 'acme'], BRAND, DOMAIN)).toEqual({
      kind: 'duplicate',
      name: 'acme',
    });
  });

  it('flags a competitor equal to the profile brand, case-insensitively', () => {
    expect(competitorsError(['smile clinic'], BRAND, DOMAIN)).toEqual({
      kind: 'own-brand',
      name: 'smile clinic',
    });
  });

  it('flags a competitor equal to the profile domain, case-insensitively', () => {
    expect(competitorsError(['HTTPS://SMILE.EXAMPLE'], BRAND, DOMAIN)).toEqual({
      kind: 'own-brand',
      name: 'HTTPS://SMILE.EXAMPLE',
    });
  });
});
