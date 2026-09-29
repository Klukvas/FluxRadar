// The two census lists are derived from the registry, so what these tests guard
// is the derivation itself: a rule that starts naming its target by the
// document's address must appear in the canonical list without anyone editing a
// list, and a rule that is not a page rule must never appear in either.

import { describe, expect, it } from 'vitest';

import { CANONICAL_PAGE_RULE_IDS, PAGE_RULE_IDS } from './page-census.js';
import { implementedModules, rulesForModule } from './registry.js';

const ALL_RULES = implementedModules().flatMap((module) => rulesForModule(module));

describe('the page census rule lists', () => {
  it('names every implemented page rule, and nothing else', () => {
    const expected = ALL_RULES.filter((rule) => rule.kind === 'page').map(
      (rule) => rule.descriptor.ruleId,
    );
    expect([...PAGE_RULE_IDS].toSorted()).toEqual([...new Set(expected)].toSorted());
  });

  it('names exactly the page rules that judge a document address', () => {
    const expected = ALL_RULES.filter(
      (rule) => rule.kind === 'page' && rule.judgedAddress !== undefined,
    ).map((rule) => rule.descriptor.ruleId);
    expect([...CANONICAL_PAGE_RULE_IDS].toSorted()).toEqual([...new Set(expected)].toSorted());
  });

  it('keeps the canonical list inside the page list', () => {
    for (const ruleId of CANONICAL_PAGE_RULE_IDS) {
      expect(PAGE_RULE_IDS).toContain(ruleId);
    }
  });

  it('has a census to offer at all', () => {
    // A release that left either list empty would silently turn every page diff
    // into "no page evidence", which reads as a data problem on the customer's
    // site rather than as a missing derivation here.
    expect(PAGE_RULE_IDS.length).toBeGreaterThan(0);
    expect(CANONICAL_PAGE_RULE_IDS.length).toBeGreaterThan(0);
  });

  it('offers a document-address census to both plans that compare scans', () => {
    // Complete runs SEO and Content Quality; Website Audit runs Content Quality
    // without SEO. A canonical census that existed only in SEO would leave every
    // Website Audit page diff on the weaker address identity.
    const canonical = new Set(CANONICAL_PAGE_RULE_IDS);
    for (const module of ['SEO', 'Content Quality'] as const) {
      const ids = rulesForModule(module).map((rule) => rule.descriptor.ruleId);
      expect(ids.some((ruleId) => canonical.has(ruleId))).toBe(true);
    }
  });
});
