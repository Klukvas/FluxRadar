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

import {
  LEGACY_PLAN_NAME,
  PAID_PLAN_ORDER,
  PLAN_CAPABILITIES,
  PLAN_MODULES,
  PLAN_ORDER,
  PLAN_URL_LIMIT,
  SIDE_SCORE_MODULES,
  modulesBeyondPlan,
  planIncludesActionPlan,
  planIncludesExport,
  planIncludesIssueHistory,
  planName,
} from './plan-modules';

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

/**
 * `TARIFFS.<plan>.capabilities` as the contracts package declares them.
 *
 * The tariff table names a shared constant — `NO_CAPABILITIES` or
 * `FULL_REPORT_CAPABILITIES` — so the plan's line is followed to that constant's
 * own declaration and the flags are read from there.
 */
function tariffCapabilities(plan: string): Readonly<Record<string, boolean>> {
  const block = new RegExp(`\\n  ${plan}: \\{([\\s\\S]*?)\\n  \\},`).exec(TARIFFS)?.[1];
  if (block === undefined) throw new Error(`tariffs.ts declares no ${plan} tariff`);
  const named = /capabilities: ([A-Z_]+),/.exec(block)?.[1];
  if (named === undefined) throw new Error(`tariffs.ts gives ${plan} no capabilities`);
  const declaration = new RegExp(
    `const ${named}: TariffCapabilities = \\{([\\s\\S]*?)\\n\\};`,
  ).exec(TARIFFS)?.[1];
  if (declaration === undefined) throw new Error(`tariffs.ts declares no ${named}`);
  return Object.fromEntries(
    [...declaration.matchAll(/(\w+): (true|false)/g)].map((match) => [
      match[1],
      match[2] === 'true',
    ]),
  );
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

  // §15 keeps these two sections out of the overall score, and the mirror is
  // what the report screens and the example fixture ask. A section added to the
  // contract's list and not to the mirror would be averaged into an overall
  // number the product does not produce.
  it('matches the tariff table’s side-score sections', () => {
    const declared = /SIDE_SCORE_MODULES: readonly ModuleName\[\] = \[([^\]]*)\]/.exec(TARIFFS);
    if (declared === null) throw new Error('tariffs.ts declares no SIDE_SCORE_MODULES');
    const modules = [...(declared[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(modules.length).toBeGreaterThan(0);
    expect(SIDE_SCORE_MODULES).toEqual(modules);
    // And each of them is a real section of the fullest plan, so the mirror
    // cannot drift onto a name no report carries.
    for (const module of SIDE_SCORE_MODULES) {
      expect(PLAN_MODULES.Complete).toContain(module);
    }
  });

  it('reads the tariff table it is checked against', () => {
    // Guards the parser itself: a rename that made both regexes miss would leave
    // every assertion above comparing nothing to nothing.
    expect(tariffModules('Free')).toEqual(['SEO']);
    expect(tariffModules('Complete')).toContain('Accessibility');
    expect(tariffModules('Basic')).toEqual(['SEO', 'AI SEO / GEO']);
  });
});

describe('the paid plans', () => {
  it('lists every paid tariff the table declares, and nothing it does not', () => {
    const declared = [...TARIFFS.matchAll(/\n {2}(\w+): \{\n {4}plan: '(\w+)'/g)].map(
      (match) => match[2],
    );
    expect(declared).toEqual(['Free', 'Basic', 'Complete']);
    expect(PAID_PLAN_ORDER).toEqual(declared.filter((plan) => plan !== 'Free'));
    expect(PLAN_ORDER).toEqual(declared);
  });
});

/**
 * A stored scan may carry a retired plan (stored-plan.ts). The report names it
 * as archived, sells nothing against it, and offers it nothing.
 */
describe('a retired plan on an old report', () => {
  const STORED_PLAN = readFileSync(
    resolve(process.cwd(), '..', '..', 'packages', 'contracts', 'src', 'stored-plan.ts'),
    'utf8',
  );

  it('mirrors the archived names the contracts package gives the API', () => {
    const english = /LEGACY_PLAN_LABELS[^=]*= \{([^}]*)\}/.exec(STORED_PLAN)?.[1] ?? '';
    const labels = Object.fromEntries(
      [...english.matchAll(/(\w+): '([^']+)'/g)].map((match) => [match[1], match[2]]),
    );
    expect(labels).toEqual(LEGACY_PLAN_NAME.en);
  });

  it.each([
    ['WebsiteAudit', 'en', 'Website Audit (archived)'],
    ['WebsiteAudit', 'uk', 'Website Audit (архів)'],
    ['Legacy', 'en', 'Archived plan'],
    ['Legacy', 'uk', 'Архівний тариф'],
  ] as const)('names %s in %s as %s', (plan, language, name) => {
    expect(planName(plan, language)).toBe(name);
  });

  it('includes no report feature and offers no upgrade', () => {
    for (const plan of ['WebsiteAudit', 'Legacy'] as const) {
      expect(planIncludesExport(plan)).toBe(false);
      expect(planIncludesIssueHistory(plan)).toBe(false);
      expect(planIncludesActionPlan(plan)).toBe(false);
      expect(modulesBeyondPlan(plan)).toEqual([]);
    }
  });
});

describe('what a plan leaves out', () => {
  it('names the cheapest plan on sale that adds each missing section', () => {
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

  it('only ever offers a paid plan', () => {
    for (const plan of PLAN_ORDER) {
      for (const entry of modulesBeyondPlan(plan)) {
        expect(PAID_PLAN_ORDER).toContain(entry.plan);
      }
    }
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

/**
 * The report features the screens offer, against the tariff that sells them.
 *
 * `issueHistory` is the one the comparison panel asks for: a plan whose findings
 * do not carry across scans has no previous scan to be compared with, and the
 * endpoint answers 403 without it. Offering the panel anyway would put a block on
 * the report that can only ever say "unavailable".
 */
describe('the plan/capability mirror', () => {
  it.each(['Free', 'Basic', 'Complete'])(
    'matches the %s tariff capability by capability',
    (plan) => {
      const declared = tariffCapabilities(plan);
      expect(Object.keys(declared).length).toBeGreaterThan(0);
      const mirrored = PLAN_CAPABILITIES[plan as keyof typeof PLAN_CAPABILITIES];
      expect(mirrored.export).toBe(declared.export);
      expect(mirrored.actionPlan).toBe(declared.actionPlan);
      expect(mirrored.issueHistory).toBe(declared.issueHistory);
    },
  );

  it('reads the capability table it is checked against', () => {
    // Guards the parser: a rename that made the regexes miss would leave the
    // assertions above comparing undefined to undefined.
    expect(tariffCapabilities('Free').issueHistory).toBe(false);
    expect(tariffCapabilities('Complete').issueHistory).toBe(true);
  });

  it('answers the three questions the screens ask', () => {
    expect(planIncludesIssueHistory('Complete')).toBe(true);
    expect(planIncludesIssueHistory('Basic')).toBe(false);
    expect(planIncludesIssueHistory('Free')).toBe(false);
    // The comparison is sold with the same entitlement as export, and a plan
    // that gains one without the other is a product decision this test should be
    // updated for deliberately. The Action Plan is the exception that decision
    // already made: Basic has it without history or export (2026-10-19).
    for (const plan of PLAN_ORDER) {
      expect(planIncludesIssueHistory(plan)).toBe(planIncludesExport(plan));
    }
    expect(planIncludesActionPlan('Free')).toBe(false);
    expect(planIncludesActionPlan('Basic')).toBe(true);
    expect(planIncludesActionPlan('Complete')).toBe(true);
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

  it('offers every paid plan a scan form can open on', () => {
    for (const plan of PAID_PLAN_ORDER) {
      expect(PLAN_URL_LIMIT[plan]).toBeGreaterThan(1);
      expect(PLAN_MODULES[plan].length).toBeGreaterThan(0);
    }
  });
});
