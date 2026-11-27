import { describe, expect, it } from 'vitest';

import type { GeoEvidence } from './api';
import { marketQuestionExample } from './free-market-question';

function evidenceWith(fields: Readonly<Record<string, string>>): GeoEvidence {
  return {
    sufficiency: 'sufficient',
    limits: [],
    sources: Object.entries(fields).map(([label, excerpt], index) => ({
      id: `src-${index}`,
      kind: 'profile',
      label,
      url: null,
      excerpt,
      provenance: 'owner-entered profile field',
    })),
  } as GeoEvidence;
}

describe('marketQuestionExample', () => {
  it('takes the first service and the first place, as a customer would type them', () => {
    expect(
      marketQuestionExample(
        evidenceWith({
          'Services or products': 'Dental implants; cleanings',
          'Operating region': 'Kyiv, Ukraine',
        }),
      ),
    ).toBe('Dental implants, Kyiv');
  });

  it('falls back to the industry, and leaves the place out when none was saved', () => {
    expect(marketQuestionExample(evidenceWith({ 'Industry or site type': 'Dental clinic' }))).toBe(
      'Dental clinic',
    );
  });

  it('names no example when neither a service nor an industry was saved', () => {
    expect(marketQuestionExample(evidenceWith({ 'Operating region': 'Kyiv' }))).toBeNull();
    expect(marketQuestionExample(null)).toBeNull();
  });

  it('does not turn a sentence into a search phrase', () => {
    const sentence =
      'We are a family-run clinic offering every kind of dental care to the whole city';
    expect(marketQuestionExample(evidenceWith({ 'Services or products': sentence }))).toBeNull();
  });
});
