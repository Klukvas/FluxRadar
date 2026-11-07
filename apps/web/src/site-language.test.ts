import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveSiteLanguage } from './site-language';

interface SiteLanguageCase {
  readonly targetLanguages: string | null;
  readonly language: string | null;
  readonly expected: 'uk' | 'en' | null;
}

// The API resolves the same rule for a request without a language
// (apps/api/src/scans/site-language.ts). Both are held to one table, kept with
// the API copy, so neither can change what a profile means on its own (D-237).
// Resolved from the vitest root (apps/web), as in free-score-copy.test.ts.
const TABLE = resolve(process.cwd(), '../api/src/scans/site-language.cases.json');
const { cases } = JSON.parse(readFileSync(TABLE, 'utf8')) as {
  readonly cases: readonly SiteLanguageCase[];
};

describe('resolveSiteLanguage (web) against the shared table', () => {
  it('runs the shared table', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases)('targets $targetLanguages, language $language -> $expected', (row) => {
    expect(
      resolveSiteLanguage({ targetLanguages: row.targetLanguages, language: row.language }),
    ).toBe(row.expected);
  });
});
