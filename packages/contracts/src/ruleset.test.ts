import { describe, expect, it } from 'vitest';

import { MODULE_NAMES, SEVERITIES } from './enums.js';
import {
  PLATFORM_CONTRACTS,
  RULES_MVP_01,
  RULESET_ALL,
  RULESET_VERSION,
  ruleById,
  rulesForModule,
} from './ruleset.js';
import { FREE_CHECK_RULE_IDS } from './tariffs.js';

const countByPrefix = (prefix: string): number =>
  RULESET_ALL.filter((rule) => rule.ruleId.startsWith(prefix)).length;

describe('rules-mvp-0.1 registry', () => {
  it('pins the ruleset version', () => {
    expect(RULESET_VERSION).toBe('rules-mvp-0.1');
  });

  it('contains every enumerated group of IMPLEMENTATION_PLAN §3 in full', () => {
    expect(countByPrefix('SEO-TECH-')).toBe(9);
    expect(countByPrefix('SEO-ONPAGE-')).toBe(4);
    expect(countByPrefix('GEO-')).toBe(5);
    expect(countByPrefix('SEC-PASSIVE-')).toBe(3);
    expect(countByPrefix('REL-')).toBe(5);
    expect(countByPrefix('A11Y-')).toBe(2);
    expect(countByPrefix('CONTENT-')).toBe(2);
    expect(countByPrefix('PRIVACY-')).toBe(2);
    expect(countByPrefix('BILLING-')).toBe(6);
    expect(countByPrefix('EXPORT-')).toBe(3);
    expect(countByPrefix('ECON-')).toBe(1);
  });

  // D-107: the enumerated §3 groups sum to 42, not the headline "37" — that figure
  // omits the GEO group (13 SEO + 14 passive + 10 platform). The registry keeps
  // every enumerated rule because T-08/T-09/T-10 depend on each of them.
  it('splits into 32 scanning+GEO rules and 10 platform contracts, 42 in total', () => {
    expect(RULES_MVP_01).toHaveLength(32);
    expect(PLATFORM_CONTRACTS).toHaveLength(10);
    expect(RULESET_ALL).toHaveLength(42);
  });

  it('has a unique ruleId for every descriptor', () => {
    const ids = RULESET_ALL.map((rule) => rule.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every scored rule a valid severity and every informational rule none', () => {
    for (const rule of RULESET_ALL) {
      if (rule.scoring === 'scored') {
        expect(SEVERITIES).toContain(rule.severity);
      } else {
        expect(rule.severity).toBeNull();
      }
    }
  });

  it('keeps scanning rules on release modules and platform contracts apart', () => {
    for (const rule of RULES_MVP_01) {
      expect(MODULE_NAMES).toContain(rule.module);
    }
    for (const contract of PLATFORM_CONTRACTS) {
      expect(contract.module).toBe('platform');
      expect(contract.targetKind).toBe('environment');
      expect(contract.scoring).toBe('informational');
    }
  });

  it('marks all five GEO rules informational (no score penalty in v0.1)', () => {
    const geoRules = rulesForModule('AI SEO / GEO');
    expect(geoRules).toHaveLength(5);
    for (const rule of geoRules) {
      expect(rule.scoring).toBe('informational');
      expect(rule.severity).toBeNull();
    }
  });

  it('looks rules up by id', () => {
    expect(ruleById('SEO-TECH-004')?.severity).toBe('High');
    expect(ruleById('SEO-TECH-004')?.targetKind).toBe('page');
    expect(ruleById('SEO-TECH-001')?.targetKind).toBe('site');
    expect(ruleById('UNKNOWN-001')).toBeUndefined();
  });

  it('filters rules by module', () => {
    expect(rulesForModule('SEO')).toHaveLength(13);
    expect(rulesForModule('platform')).toHaveLength(10);
    expect(rulesForModule('Performance')).toHaveLength(0);
  });

  it('resolves every Free-check rule id against the registry', () => {
    for (const ruleId of FREE_CHECK_RULE_IDS) {
      expect(ruleById(ruleId)?.module).toBe('SEO');
    }
  });
});
