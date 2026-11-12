import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { additionalSeoChecks, FREE_SEO_RULE_IDS, SEO_CHECK_CATALOG } from './free-seo-catalog';

const CONTRACTS = resolve(process.cwd(), '../../packages/contracts/src');
const source = (name: string) =>
  readFileSync(resolve(CONTRACTS, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

describe('locked SEO check catalog matches the real contract', () => {
  it('mirrors every SEO registry descriptor exactly once and no other module', () => {
    const ids = [
      ...source('ruleset-scanning.ts').matchAll(/ruleId: '([^']+)',\s*module: 'SEO'/g),
    ].map((match) => match[1]);
    expect(SEO_CHECK_CATALOG.map(([id]) => id).sort()).toEqual(ids.sort());
    expect(new Set(SEO_CHECK_CATALOG.map(([id]) => id)).size).toBe(ids.length);
  });

  it('mirrors the exact Free list and excludes it from paid extras', () => {
    const list = /FREE_CHECK_RULE_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source('tariffs.ts'));
    expect(list).not.toBeNull();
    expect(FREE_SEO_RULE_IDS).toEqual(
      [...(list?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]),
    );
    expect(additionalSeoChecks([], 'en')).toHaveLength(21);
    expect(
      additionalSeoChecks([], 'en').every(
        (check) => !(FREE_SEO_RULE_IDS as readonly string[]).includes(check.id),
      ),
    ).toBe(true);
  });

  it('excludes additional checks already present in a historical report', () => {
    expect(additionalSeoChecks(['SEO-TECH-004'], 'en')).toHaveLength(20);
    expect(
      additionalSeoChecks(['SEO-TECH-004'], 'en').some((check) => check.id === 'SEO-TECH-004'),
    ).toBe(false);
  });

  it('keeps rule catalog names Ukrainian in Russian chrome', () => {
    expect(additionalSeoChecks([], 'ru')).toEqual(additionalSeoChecks([], 'uk'));
    expect(additionalSeoChecks([], 'ru')).not.toEqual(additionalSeoChecks([], 'en'));
  });
});
