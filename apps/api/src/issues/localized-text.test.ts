import { describe, expect, it } from 'vitest';

import { localizedFindingTexts } from './localized-text.ts';

// The Issue Center shows a finding's evidence and recommendation in the reader's
// language when the finding stored message codes, and the stored text otherwise.
// Every way a row can fail to render has to land on "use the stored text" —
// never on an error, and never on a sentence with a value missing from it.

describe('localized finding text', () => {
  it('renders the evidence and recommendation in every report language', () => {
    const texts = localizedFindingTexts(
      JSON.stringify({
        evidence: {
          code: 'sec-passive-005.evidence',
          params: { cookie: 'session', attributes: 'Secure, HttpOnly' },
        },
        recommendation: { code: 'sec-passive-005.recommendation', params: {} },
      }),
    );

    expect(texts?.en.evidenceExcerpt).toBe(
      'Set-Cookie "session" is missing attributes: Secure, HttpOnly',
    );
    expect(texts?.uk.evidenceExcerpt).toBe(
      'Set-Cookie "session" не має атрибутів: Secure, HttpOnly',
    );
    expect(texts?.uk.recommendation).toMatch(/^Задавайте cookie атрибути Secure/);
  });

  it('leaves a field empty rather than render it with a value missing', () => {
    const texts = localizedFindingTexts(
      JSON.stringify({
        evidence: { code: 'sec-passive-005.evidence', params: { cookie: 'session' } },
        recommendation: { code: 'sec-passive-005.recommendation', params: {} },
      }),
    );

    expect(texts?.uk.evidenceExcerpt).toBeNull();
    expect(texts?.uk.recommendation).not.toBeNull();
  });

  it('is absent for a finding stored before message codes existed', () => {
    expect(localizedFindingTexts(null)).toBeNull();
  });

  it('is absent when the stored JSON cannot be read', () => {
    expect(localizedFindingTexts('{not json')).toBeNull();
    expect(localizedFindingTexts(JSON.stringify({ evidence: 'plain text' }))).toBeNull();
  });

  it('leaves each field empty for a code this build does not know', () => {
    const texts = localizedFindingTexts(
      JSON.stringify({
        evidence: { code: 'unknown.evidence', params: {} },
        recommendation: { code: 'unknown.recommendation', params: {} },
      }),
    );

    expect(texts).toEqual({
      en: { evidenceExcerpt: null, recommendation: null },
      uk: { evidenceExcerpt: null, recommendation: null },
    });
  });
});
