// Every rule that can put a finding in a report has a title an owner can read,
// in every report language. The registry lives in `packages/contracts`, which
// `apps/web` does not depend on, so it is read as text — the same seam
// `plan-modules.test.ts` uses for the tariff table.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RULE_TITLES, moduleCoverageHref, moduleLabel, ruleTitle } from './rule-titles';

const REGISTRY = readFileSync(
  resolve(process.cwd(), '..', '..', 'packages', 'contracts', 'src', 'ruleset-scanning.ts'),
  'utf8',
);

/** Rules whose findings become Issue Center rows. GEO rules are informational (D-109). */
const FINDING_RULE = /ruleId: '((?:SEO|SEC|REL|A11Y|CONTENT|PRIVACY|UX)-[A-Z0-9-]+)'/g;

const findingRules = [...REGISTRY.matchAll(FINDING_RULE)].map((match) => match[1] as string);

describe('rule titles', () => {
  it('reads a non-trivial registry', () => {
    expect(findingRules.length).toBeGreaterThanOrEqual(50);
  });

  it.each(findingRules)('%s has a title in English and Ukrainian', (ruleId) => {
    const title = RULE_TITLES[ruleId];
    expect(title, `${ruleId} has no title in rule-titles.ts`).toBeDefined();
    expect(title?.en.trim()).not.toBe('');
    expect(title?.uk.trim()).not.toBe('');
    expect(title?.en).not.toBe(title?.uk);
  });

  it('titles no rule the registry does not have', () => {
    expect(Object.keys(RULE_TITLES).filter((ruleId) => !findingRules.includes(ruleId))).toEqual([]);
  });

  it('falls back to the id for a rule it does not know', () => {
    expect(ruleTitle('SEO-ONPAGE-002', 'en')).toBe(
      'Meta description is missing or the wrong length',
    );
    expect(ruleTitle('NEW-RULE-001', 'uk')).toBe('NEW-RULE-001');
  });

  it('names sections in the report language and links them to the coverage page', () => {
    expect(moduleLabel('Security', 'uk')).toBe('Безпека');
    expect(moduleLabel('Unknown', 'uk')).toBe('Unknown');
    expect(moduleCoverageHref('Security')).toBe('/checks#checks-security');
    expect(moduleCoverageHref('Performance')).toBe('/checks#checks-evidence');
  });
});
