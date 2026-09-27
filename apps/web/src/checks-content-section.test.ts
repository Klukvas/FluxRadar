// The public coverage page has to name the Content Quality module.
//
// A paid scan has always run it, and /checks had no section for it: a reader
// comparing what they bought against the page could not find out what Content
// Quality even looks at, and every link from a Content Quality finding in the
// report landed on the generic Evidence section instead
// (`moduleCoverageHref`). The cross-page duplicate check made that gap
// load-bearing — a finding no public page describes is a finding the owner
// cannot check us on — so the section exists, and these tests keep it honest in
// both languages.

import { describe, expect, it } from 'vitest';

import { checksCopyEn, checksCopyUk, type ChecksCopy } from './checks-copy';
import { moduleCoverageHref } from './rule-titles';

const LOCALES: readonly (readonly [string, ChecksCopy])[] = [
  ['en', checksCopyEn],
  ['uk', checksCopyUk],
];

function contentSection(copy: ChecksCopy) {
  const section = copy.sections.find((entry) => entry.id === 'content');
  if (section === undefined) {
    throw new Error('the coverage page has no Content Quality section');
  }
  return section;
}

describe('the Content Quality section of the coverage page', () => {
  it('is where a Content Quality finding links to', () => {
    expect(moduleCoverageHref('Content Quality')).toBe('/checks#checks-content');
    // The fallback stays for modules with no section of their own.
    expect(moduleCoverageHref('Performance')).toBe('/checks#checks-evidence');
  });

  it.each(LOCALES)('exists in %s with a nav label, a title and bullets', (_language, copy) => {
    const section = contentSection(copy);
    expect(section.nav.trim()).not.toBe('');
    expect(section.title.trim()).not.toBe('');
    expect(section.intro.length).toBeGreaterThan(0);
    // One bullet per rule the module runs: duplicate content, low-value pages,
    // broken media.
    expect(section.bullets).toHaveLength(3);
  });

  it.each(LOCALES)('names the duplicate-content check and its canonical rule in %s', (_l, copy) => {
    const [duplicate] = contentSection(copy).bullets;
    expect(duplicate?.term.trim()).not.toBe('');
    // The two things a reader has to be able to learn before buying: the match
    // is exact, and declaring a canonical is what makes the check pass.
    expect(duplicate?.body).toContain('rel="canonical"');
  });

  it('numbers the sections in reading order without a gap or a repeat', () => {
    for (const [, copy] of LOCALES) {
      const numbers = copy.sections.map((section) => section.label.slice(0, 2));
      expect(numbers).toEqual(
        copy.sections.map((_section, index) => String(index).padStart(2, '0')),
      );
    }
  });

  it('keeps the two locales on the same sections in the same order', () => {
    expect(checksCopyUk.sections.map((section) => section.id)).toEqual(
      checksCopyEn.sections.map((section) => section.id),
    );
  });
});
