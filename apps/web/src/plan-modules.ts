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

/**
 * The plans, cheapest first.
 *
 * Deliberately no longer a ladder. Basic and Website Audit are siblings — one
 * answers how the site is found, the other what is wrong with it, and neither
 * contains the other — so "the next plan up adds this section" stopped being
 * true the moment the third package existed. The order is still what a price
 * list is sorted by; it is not what decides which plan unlocks a section.
 */
export const PLAN_ORDER: readonly Plan[] = ['Free', 'Basic', 'WebsiteAudit', 'Complete'];

/** The plans a buyer can actually pay for, in the order the pricing page shows. */
export const PAID_PLAN_ORDER: readonly Plan[] = ['Basic', 'WebsiteAudit', 'Complete'];

/** `TARIFFS[plan].modules`, in the tariff table's own order. */
export const PLAN_MODULES: Readonly<Record<Plan, readonly string[]>> = {
  Free: ['SEO'],
  Basic: ['SEO', 'AI SEO / GEO'],
  WebsiteAudit: [
    'Security',
    'Performance',
    'Accessibility',
    'Reliability',
    'Content Quality',
    'Privacy',
    'UX/Conversion',
    'Analytics',
  ],
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
  WebsiteAudit: 50_000,
  Complete: 50_000,
};

/**
 * Which plans include the report features a report screen can offer.
 *
 * Mirrors `TARIFFS[plan].capabilities`. The screens used to ask
 * `scan.plan === 'Complete'`, which silently answered "no" for every later plan
 * that sells the same thing — and the server, which decides, would have said
 * yes. The server still decides; this is the UI agreeing with it.
 */
export const PLAN_CAPABILITIES: Readonly<
  Record<Plan, { readonly export: boolean; readonly actionPlan: boolean }>
> = {
  Free: { export: false, actionPlan: false },
  Basic: { export: false, actionPlan: false },
  WebsiteAudit: { export: true, actionPlan: true },
  Complete: { export: true, actionPlan: true },
};

export function planIncludesExport(plan: Plan): boolean {
  return PLAN_CAPABILITIES[plan]?.export ?? false;
}

export function planIncludesActionPlan(plan: Plan): boolean {
  return PLAN_CAPABILITIES[plan]?.actionPlan ?? false;
}

/**
 * What each plan is called on screen.
 *
 * The identifier and the name are not the same string for every plan:
 * `WebsiteAudit` is what the database stores and the API speaks, `Website Audit`
 * is what a buyer reads. Rendering the identifier gave "Included in
 * WebsiteAudit" on the report. The plans whose identifier already reads as a
 * name map to themselves, so every surface can call this unconditionally.
 */
export const PLAN_DISPLAY_NAME: Readonly<Record<Plan, string>> = {
  Free: 'Free',
  Basic: 'Basic',
  WebsiteAudit: 'Website Audit',
  Complete: 'Complete',
};

/** The display name of a plan literal; unknown strings are shown as they are. */
export function planName(plan: string): string {
  return PLAN_DISPLAY_NAME[plan as Plan] ?? plan;
}

/** One section this plan does not run, and the cheapest plan that does. */
export interface LockedModule {
  readonly module: string;
  readonly plan: Plan;
}

/**
 * The audit sections a plan leaves out, each named with the cheapest paid plan
 * that runs it.
 *
 * Empty for Complete, which runs every section there is — a report on that plan
 * says so rather than showing an empty list that reads like missing data.
 *
 * The "cheapest plan that runs it" is now looked up across the paid plans rather
 * than taken from the next rung of a ladder: a Website Audit report is missing
 * SEO, and the plan that adds it is Basic — which is *cheaper*, not dearer. A
 * ladder walk would have offered Complete for it and asked the owner for $120
 * to get back something $55 sells.
 */
export function modulesBeyondPlan(plan: Plan): readonly LockedModule[] {
  const covered = new Set(PLAN_MODULES[plan]);
  const cheapestFirst = PAID_PLAN_ORDER.filter((candidate) => candidate !== plan);
  const locked: LockedModule[] = [];
  for (const module of PLAN_MODULES.Complete) {
    if (covered.has(module)) continue;
    const seller = cheapestFirst.find((candidate) => PLAN_MODULES[candidate].includes(module));
    if (seller === undefined) continue;
    covered.add(module);
    locked.push({ module, plan: seller });
  }
  return locked;
}
