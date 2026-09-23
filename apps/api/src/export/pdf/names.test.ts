// The mirrored catalogues, against the two files they are a copy of.
//
// `names.ts` duplicates `apps/web/src/rule-titles.ts` because the API has no
// workspace dependency on apps/web — the seam `billing/checkout-metadata.test.ts`
// already reads across. A copy is only worth having while it is provably a copy,
// so this file reads the browser's source as text and fails on the first entry
// that drifts, in either direction and in either language.
//
// It then asks what the browser's own suite asks: every rule the registry can
// produce a finding for has a title. A new rule cannot reach the downloadable
// report as a bare id any more than it can reach the Issue Center as one.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MODULE_LABELS, RULE_TITLES, moduleLabel, ruleTitle } from './names.ts';

const BROWSER_CATALOGUE = readFileSync(
  resolve(process.cwd(), '..', 'web', 'src', 'rule-titles.ts'),
  'utf8',
);

const REGISTRY = readFileSync(
  resolve(process.cwd(), '..', '..', 'packages', 'contracts', 'src', 'ruleset-scanning.ts'),
  'utf8',
);

/** `'SEO-TECH-001': {\n en: '…',\n uk: '…',\n },` — how the browser writes a title. */
const BROWSER_RULE = /^ {2}'([A-Z0-9-]+)': \{\n {4}en: '(.*)',\n {4}uk: '(.*)',\n {2}\},$/gm;

/** `Security: { en: 'Security', uk: 'Безпека' },` — quoted when the name has a space. */
const BROWSER_MODULE = /^ {2}('?)([^:']+)\1: \{ en: '(.*)', uk: '(.*)' \},$/gm;

/** Rules whose findings become report problems. GEO rules are informational (D-109). */
const FINDING_RULE = /ruleId: '((?:SEO|SEC|REL|A11Y|CONTENT|PRIVACY|UX)-[A-Z0-9-]+)'/g;

type Catalogue = Readonly<Record<string, { readonly en: string; readonly uk: string }>>;

function browserEntries(pattern: RegExp, keyGroup: number, enGroup: number): Catalogue {
  return Object.fromEntries(
    [...BROWSER_CATALOGUE.matchAll(pattern)].map((match) => [
      match[keyGroup] as string,
      { en: match[enGroup] as string, uk: match[enGroup + 1] as string },
    ]),
  );
}

const browserRules = browserEntries(BROWSER_RULE, 1, 2);
const browserModules = browserEntries(BROWSER_MODULE, 2, 3);
const findingRules = [...REGISTRY.matchAll(FINDING_RULE)].map((match) => match[1] as string);

describe('the names the document prints', () => {
  // Read first, so a catalogue the patterns stopped matching fails here rather
  // than passing every comparison below against an empty object.
  it('reads both catalogues out of the browser’s file', () => {
    expect(Object.keys(browserRules).length).toBeGreaterThanOrEqual(50);
    expect(Object.keys(browserModules).length).toBeGreaterThanOrEqual(10);
    expect(findingRules.length).toBeGreaterThanOrEqual(50);
  });

  it('calls every problem what the browser calls it, in both languages', () => {
    expect(RULE_TITLES).toEqual(browserRules);
  });

  it('calls every section what the browser calls it, in both languages', () => {
    expect(MODULE_LABELS).toEqual(browserModules);
  });

  it.each(findingRules)('%s has a title in English and Ukrainian', (ruleId) => {
    const title = RULE_TITLES[ruleId];
    expect(title, `${ruleId} has no title in pdf/names.ts`).toBeDefined();
    expect(title?.en.trim()).not.toBe('');
    expect(title?.uk.trim()).not.toBe('');
  });

  it('titles no rule the registry does not have', () => {
    expect(Object.keys(RULE_TITLES).filter((ruleId) => !findingRules.includes(ruleId))).toEqual([]);
  });

  it('prints the id of a rule it does not know, not nothing', () => {
    expect(ruleTitle('SEC-PASSIVE-002', 'uk')).toBe('Відсутні заголовки безпеки');
    // A Performance finding is written by the audit rather than by the rules
    // engine, and the registry has no title for one: it keeps its id.
    expect(ruleTitle('PERF-LCP-001', 'uk')).toBe('PERF-LCP-001');
    expect(ruleTitle('NEW-RULE-001', 'en')).toBe('NEW-RULE-001');
  });

  it('prints the module’s own name for a section it does not know', () => {
    expect(moduleLabel('Content Quality', 'uk')).toBe('Якість контенту');
    expect(moduleLabel('Content Quality', 'en')).toBe('Content quality');
    expect(moduleLabel('Crawler', 'uk')).toBe('Crawler');
  });
});
