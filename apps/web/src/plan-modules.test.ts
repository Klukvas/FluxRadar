// The report tells a Free owner which sections a paid plan would add. That claim
// is a sales promise, so it is pinned to the tariff table that defines the
// product rather than to a list somebody kept in their head while writing the
// screen.
//
// `apps/web` has no dependency on `@fluxradar/contracts`, so the table is read
// as text — the same seam `control-layout.test.tsx` uses for `base.css`. A
// module added to a tariff and not to the mirror fails here, in the repository
// that owns both, instead of quietly disappearing from the report.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLAN_MODULES, PLAN_ORDER, PLAN_URL_LIMIT, modulesBeyondPlan } from './plan-modules';

// Vitest runs with `apps/web` as its working directory (see blog-page.test.ts).
const TARIFFS = readFileSync(
  resolve(process.cwd(), '..', '..', 'packages', 'contracts', 'src', 'tariffs.ts'),
  'utf8',
);

/** `TARIFFS.<plan>.modules` as the contracts package actually declares it. */
function tariffModules(plan: string): readonly string[] {
  const block = new RegExp(`\\n  ${plan}: \\{([\\s\\S]*?)\\n  \\},`).exec(TARIFFS)?.[1];
  if (block === undefined) throw new Error(`tariffs.ts declares no ${plan} tariff`);
  const list = /modules: \[([\s\S]*?)\]/.exec(block)?.[1];
  if (list === undefined) throw new Error(`tariffs.ts gives ${plan} no module list`);
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

/** `TARIFFS.<plan>.urlLimit` as the contracts package actually declares it. */
function tariffUrlLimit(plan: string): number {
  const block = new RegExp(`\\n  ${plan}: \\{([\\s\\S]*?)\\n  \\},`).exec(TARIFFS)?.[1];
  if (block === undefined) throw new Error(`tariffs.ts declares no ${plan} tariff`);
  const limit = /urlLimit: ([\d_]+)/.exec(block)?.[1];
  if (limit === undefined) throw new Error(`tariffs.ts gives ${plan} no URL limit`);
  return Number(limit.replaceAll('_', ''));
}

describe('the plan/module mirror', () => {
  it.each(['Free', 'Basic', 'Complete'])('matches the %s tariff module by module', (plan) => {
    const declared = tariffModules(plan);
    expect(declared.length).toBeGreaterThan(0);
    expect(PLAN_MODULES[plan as keyof typeof PLAN_MODULES]).toEqual(declared);
  });

  it('reads the tariff table it is checked against', () => {
    // Guards the parser itself: a rename that made both regexes miss would leave
    // every assertion above comparing nothing to nothing.
    expect(tariffModules('Free')).toEqual(['SEO']);
    expect(tariffModules('Complete')).toContain('Accessibility');
  });
});

describe('what a plan leaves out', () => {
  it('names the cheapest plan that adds each missing section', () => {
    expect(modulesBeyondPlan('Free')).toEqual([
      { module: 'AI SEO / GEO', plan: 'Basic' },
      { module: 'Security', plan: 'Complete' },
      { module: 'Performance', plan: 'Complete' },
      { module: 'Accessibility', plan: 'Complete' },
      { module: 'Reliability', plan: 'Complete' },
      { module: 'Content Quality', plan: 'Complete' },
      { module: 'Privacy', plan: 'Complete' },
      { module: 'UX/Conversion', plan: 'Complete' },
      { module: 'Analytics', plan: 'Complete' },
    ]);
  });

  it('leaves out nothing a Basic report already ran', () => {
    const locked = modulesBeyondPlan('Basic').map((entry) => entry.module);
    expect(locked).not.toContain('SEO');
    expect(locked).not.toContain('AI SEO / GEO');
    expect(locked).toContain('Security');
  });

  it('has nothing to offer the top plan', () => {
    expect(modulesBeyondPlan('Complete')).toEqual([]);
  });

  it('never promises a section no tariff sells', () => {
    for (const plan of PLAN_ORDER) {
      for (const locked of modulesBeyondPlan(plan)) {
        expect(PLAN_MODULES[locked.plan]).toContain(locked.module);
      }
    }
  });
});

// The page ceiling the new-scan form clamps to. A tariff that sells more pages
// than the form will ask for is a product the owner cannot buy what they paid
// for; one that sells fewer is a 400 in front of a buyer.
describe('the plan/URL-limit mirror', () => {
  it.each(['Free', 'Basic', 'Complete'])('matches the %s tariff URL limit', (plan) => {
    const declared = tariffUrlLimit(plan);
    expect(declared).toBeGreaterThan(0);
    expect(PLAN_URL_LIMIT[plan as keyof typeof PLAN_URL_LIMIT]).toBe(declared);
  });

  it('never lets a cheaper plan crawl more than a dearer one', () => {
    const limits = PLAN_ORDER.map((plan) => PLAN_URL_LIMIT[plan]);
    expect(limits).toEqual([...limits].sort((left, right) => left - right));
  });
});
