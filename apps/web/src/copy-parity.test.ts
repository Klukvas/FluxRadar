// Every string the owner reads, in both languages, checked at runtime.
//
// The screens outside `i18n.ts` keep their own typed copy objects, and the type
// system only guarantees that the two language halves have the same *shape*. It
// cannot see an empty string, a key left in English, or — the way the gap
// actually appeared — a sentence written straight into the markup as
// `language === 'uk' ? … : …`, which no dictionary holds at all.
//
// So this walks the real objects, calling every function with plausible
// arguments, and fails on an empty value or on a Ukrainian string identical to
// its English one. The exceptions are listed by path and each says why.

import { describe, expect, it } from 'vitest';

import { accountCopy } from './account-copy';
import { findingsCopy } from './findings-copy';
import { newScanCopy } from './new-scan-copy';
import { reportFailureCopy } from './report-failure-copy';

/** The copy objects this test owns, by the name the failure message shows. */
const CATALOGUES = {
  newScanCopy,
  findingsCopy,
  accountCopy,
  reportFailureCopy,
} as const;

/**
 * Paths whose two languages are allowed to be identical, and why.
 *
 * Only for a value that is not prose: a product or company name, a rule or
 * status id the API matches on, a plan name, or an address. Anything else that
 * reads the same in both languages is a missing translation.
 */
const SAME_IN_BOTH_LANGUAGES: readonly RegExp[] = [
  // Plan names are the product's own: "Basic" is Basic on a Ukrainian invoice.
  /^newScanCopy\.planNames\./,
  // The wire values the chip colours and the API's filters are keyed by.
  /^findingsCopy\.severity\.[A-Za-z ]+$/,
  /^findingsCopy\.status\.[A-Za-z ]+$/,
  // "HTTP 404" is the answer the site gave, not a sentence about it.
  /^reportFailureCopy\.httpStatus$/,
  // Brand and standard names: FAQ, GA4, Search Console, PageSpeed, Creem.
  /^findingsCopy\.print\.(?:csv|json)$/,
  // "Email" is the word Ukrainian uses for it too, here and on the account
  // screen's own heading above it.
  /^accountCopy\.email\.heading$/,
  // Step ids (`checkInBrowser`, `allowInRobots`), not sentences: the component
  // draws each one, because two of them carry a link.
  /^reportFailureCopy\.guidance\.[a-z-]+\.steps\[\d+\]$/,
];

/** Arguments to call a copy function with: one of each shape it may want. */
const CALL_ARGUMENTS: readonly unknown[] = ['example.com', 2, 'example.com', 2, 2, 2];

type Leaf = { readonly path: string; readonly en: string; readonly uk: string };

/**
 * Every leaf string of one catalogue, with the path that names it.
 *
 * A function is called rather than skipped: `(domain) => …` is where a locale
 * gap hides most easily, because the English and Ukrainian halves are two
 * separate lambdas and nothing compares them.
 */
function leavesOf(name: string, en: unknown, uk: unknown, path = name): readonly Leaf[] {
  if (typeof en === 'string' && typeof uk === 'string') return [{ path, en, uk }];
  if (typeof en === 'function' && typeof uk === 'function') {
    const call = (fn: unknown): string => {
      // A copy function takes strings, numbers, or one object naming a site.
      const result = (fn as (...args: readonly unknown[]) => unknown)(...CALL_ARGUMENTS, {
        name: 'Bloom Nails',
        domain: 'https://bloom-nails.example',
      });
      return typeof result === 'string' ? result : '';
    };
    return [{ path, en: call(en), uk: call(uk) }];
  }
  if (Array.isArray(en) && Array.isArray(uk)) {
    return en.flatMap((entry, index) => leavesOf(name, entry, uk[index], `${path}[${index}]`));
  }
  if (typeof en === 'object' && en !== null && typeof uk === 'object' && uk !== null) {
    const ukRecord = uk as Record<string, unknown>;
    return Object.entries(en as Record<string, unknown>).flatMap(([key, value]) =>
      leavesOf(name, value, ukRecord[key], `${path}.${key}`),
    );
  }
  // Numbers and booleans are not copy; a missing Ukrainian half shows up as a
  // type mismatch here and is reported as an empty string below.
  return typeof en === 'string' || typeof uk === 'string'
    ? [{ path, en: `${en}`, uk: `${uk}` }]
    : [];
}

function allLeaves(): readonly Leaf[] {
  return Object.entries(CATALOGUES).flatMap(([name, catalogue]) =>
    leavesOf(name, catalogue.en, catalogue.uk),
  );
}

function allowedToMatch(path: string): boolean {
  return SAME_IN_BOTH_LANGUAGES.some((pattern) => pattern.test(path));
}

describe('the copy objects the screens outside i18n.ts own', () => {
  it('reaches a useful number of strings', () => {
    // A guard on the walker itself: a change that made `leavesOf` return
    // nothing would otherwise turn every test below green.
    expect(allLeaves().length).toBeGreaterThan(300);
  });

  it('has a non-empty value for every key, in both languages', () => {
    const empty = allLeaves().filter(
      (leaf) => leaf.en.trim() === '' || leaf.uk.trim() === '' || leaf.uk === 'undefined',
    );
    expect(empty.map((leaf) => leaf.path)).toEqual([]);
  });

  it('says something different in Ukrainian for everything that is prose', () => {
    const untranslated = allLeaves().filter(
      (leaf) => leaf.en === leaf.uk && !allowedToMatch(leaf.path),
    );
    expect(untranslated.map((leaf) => leaf.path)).toEqual([]);
  });

  // The gap this file was written for: a sentence spelled inside a component is
  // a sentence no catalogue holds, so nothing above can see it. These were the
  // ones the walkthrough found, and they are now keys.
  it('holds the strings that used to be written into the markup', () => {
    expect(newScanCopy.en.createProfile).toBe('Create profile');
    expect(newScanCopy.uk.createProfile).toBe('Створити профіль');
    for (const key of ['closeWindow', 'createProfile'] as const) {
      expect(newScanCopy.uk[key]).not.toBe(newScanCopy.en[key]);
    }
    for (const key of ['title', 'body', 'keep', 'discard'] as const) {
      expect(newScanCopy.uk.discard[key]).not.toBe(newScanCopy.en.discard[key]);
    }
    for (const key of ['title', 'loading', 'ready', 'missing', 'unavailable', 'open'] as const) {
      expect(newScanCopy.uk.googleContext[key]).not.toBe(newScanCopy.en.googleContext[key]);
    }
  });
});

describe('the new-scan and progress screens hold no inline translations', () => {
  // A `language === 'uk' ? … : …` in the markup is the shape that hid four
  // sentences from every copy test in the suite.
  it('has none left in the files the walkthrough found them in', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    for (const file of ['NewScanScreen.tsx', 'ScanProgress.tsx']) {
      const source = readFileSync(join(resolve(process.cwd()), 'src', file), 'utf8');
      const inline = source.match(/language === 'uk'/g) ?? [];
      // ScanProgress still holds a handful in its cancel dialog; the count is
      // pinned so it can only go down. NewScanScreen holds none.
      expect(inline.length).toBeLessThanOrEqual(file === 'NewScanScreen.tsx' ? 0 : 9);
    }
  });
});
