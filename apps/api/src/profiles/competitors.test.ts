import { describe, expect, it } from 'vitest';

import { competitorsFromJson } from './competitors.ts';

describe('competitorsFromJson (T7)', () => {
  it('returns null for a null column', () => {
    expect(competitorsFromJson(null)).toBeNull();
  });

  it('parses a stored JSON array', () => {
    expect(competitorsFromJson('["Acme Dental","Bright Smile"]')).toEqual([
      'Acme Dental',
      'Bright Smile',
    ]);
  });

  it('returns null for a stored empty array', () => {
    expect(competitorsFromJson('[]')).toBeNull();
  });

  it('returns null for invalid JSON rather than throwing', () => {
    expect(competitorsFromJson('not json')).toBeNull();
  });

  it('returns null for a JSON value that is not a string array', () => {
    expect(competitorsFromJson('{"a":1}')).toBeNull();
    expect(competitorsFromJson('[1,2,3]')).toBeNull();
    expect(competitorsFromJson('"just a string"')).toBeNull();
  });
});
