import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveSiteLanguage } from './site-language.ts';

interface SiteLanguageCase {
  readonly targetLanguages: string | null;
  readonly language: string | null;
  readonly expected: 'uk' | 'en' | null;
}

// The same table the web resolver is held to (apps/web/src/site-language.test.ts),
// so the two copies of the rule cannot drift apart silently (D-237).
const { cases } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'site-language.cases.json'), 'utf8'),
) as { readonly cases: readonly SiteLanguageCase[] };

describe('resolveSiteLanguage (API fallback, D-237)', () => {
  it('runs the shared table', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases)('targets $targetLanguages, language $language -> $expected', (row) => {
    expect(
      resolveSiteLanguage({ targetLanguages: row.targetLanguages, language: row.language }),
    ).toBe(row.expected);
  });
});
