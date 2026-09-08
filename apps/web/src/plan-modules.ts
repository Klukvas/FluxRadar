// Which audit sections each tariff runs, and which ones a plan does not reach.
//
// The report has to be able to say what a Free check covered *and* what it did
// not, and the second half cannot be read off the scan: a section the plan never
// runs sends no module row. The answer lives in the tariff matrix
// (`packages/contracts/src/tariffs.ts`, §18), which the web app does not import —
// it has no dependency on the contracts package, the same reason
// `scan-status.ts` matches the free-check scoring reason as a literal.
//
// So this is a mirror, not a second opinion: `plan-modules.test.ts` reads
// `tariffs.ts` and fails if the two ever disagree, which is what stops the
// report from advertising a capability the product does not sell.

import type { Scan } from './api';

export type Plan = Scan['plan'];

/** Cheapest plan first; a module is "unlocked by" the first plan that lists it. */
export const PLAN_ORDER: readonly Plan[] = ['Free', 'Basic', 'Complete'];

/** `TARIFFS[plan].modules`, in the tariff table's own order. */
export const PLAN_MODULES: Readonly<Record<Plan, readonly string[]>> = {
  Free: ['SEO'],
  Basic: ['SEO', 'AI SEO / GEO'],
  Complete: [
    'SEO',
    'AI SEO / GEO',
    'Security',
    'Performance',
    'Accessibility',
    'Reliability',
    'Content Quality',
    'Privacy',
    'UX/Conversion',
    'Analytics',
  ],
};

/**
 * `TARIFFS[plan].urlLimit` — the most pages a scan on that plan may ask for.
 *
 * A mirror for the same reason the module lists are (see above), and read for
 * the same kind of claim: a form that offers a page count the plan does not sell
 * is asking for a request the API answers with a 400 nobody can act on.
 */
export const PLAN_URL_LIMIT: Readonly<Record<Plan, number>> = {
  Free: 1,
  Basic: 5000,
  Complete: 50_000,
};

/** One section this plan does not run, and the cheapest plan that does. */
export interface LockedModule {
  readonly module: string;
  readonly plan: Plan;
}

/**
 * The audit sections a plan leaves out, each named with the plan that adds it.
 *
 * Empty for Complete, which runs every section there is — a report on that plan
 * says so rather than showing an empty list that reads like missing data.
 */
export function modulesBeyondPlan(plan: Plan): readonly LockedModule[] {
  const covered = new Set(PLAN_MODULES[plan]);
  const locked: LockedModule[] = [];
  for (const candidate of PLAN_ORDER.slice(PLAN_ORDER.indexOf(plan) + 1)) {
    for (const module of PLAN_MODULES[candidate]) {
      if (covered.has(module)) continue;
      covered.add(module);
      locked.push({ module, plan: candidate });
    }
  }
  return locked;
}
