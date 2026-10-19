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

import type { CurrentPlan, LegacyPlan } from './api';
import type { Language } from './i18n';

/** A plan that exists today. A stored scan may also carry a `LegacyPlan`. */
export type Plan = CurrentPlan;

/** A plan a buyer pays for: the one a report's upgrade button preselects. */
export type PaidPlan = Exclude<Plan, 'Free'>;

/** The plans, cheapest first: the order a price list is sorted by. */
export const PLAN_ORDER: readonly Plan[] = ['Free', 'Basic', 'Complete'];

/** The plans a buyer pays for, in the order the pricing page shows. */
export const PAID_PLAN_ORDER: readonly PaidPlan[] = ['Basic', 'Complete'];

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
 * The sections whose 0–100 score is shown on its own and left out of the
 * overall score (§15).
 *
 * Mirrors `SIDE_SCORE_MODULES` in `packages/contracts/src/tariffs.ts`, which
 * `overall-score.ts` skips outright when it builds the overall number. A mirror
 * for the same reason the module lists above are one — `apps/web` has no
 * dependency on the contracts package — and `plan-modules.test.ts` reads the
 * tariff table and fails if the two ever disagree.
 */
export const SIDE_SCORE_MODULES: readonly string[] = ['UX/Conversion', 'Analytics'];

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

/**
 * Which plans include the report features a report screen can offer.
 *
 * Mirrors `TARIFFS[plan].capabilities`. The screens used to ask
 * `scan.plan === 'Complete'`, which silently answered "no" for every later plan
 * that sells the same thing — and the server, which decides, would have said
 * yes. The server still decides; this is the UI agreeing with it.
 */
export const PLAN_CAPABILITIES: Readonly<
  Record<
    Plan,
    { readonly export: boolean; readonly actionPlan: boolean; readonly issueHistory: boolean }
  >
> = {
  Free: { export: false, actionPlan: false, issueHistory: false },
  Basic: { export: false, actionPlan: false, issueHistory: false },
  Complete: { export: true, actionPlan: true, issueHistory: true },
};

/**
 * A stored scan's plan may be a retired one (`LegacyPlan`): it has no tariff
 * row here, and so no capability — the server refuses all three for it too.
 */
export function planIncludesExport(plan: Plan | LegacyPlan): boolean {
  return PLAN_CAPABILITIES[plan as Plan]?.export ?? false;
}

/**
 * Whether this plan compares a report with the previous scan of the site.
 *
 * The same entitlement the Resolved/Reopened lifecycle is sold under
 * (`issueHistory`), so the two can never disagree: a plan whose findings do not
 * carry across scans has no previous scan to be compared with either. The server
 * still decides — `GET /scans/:id/comparison` answers 403 without it — and this
 * is what keeps the report from offering the panel to a plan that would be
 * refused.
 */
export function planIncludesIssueHistory(plan: Plan | LegacyPlan): boolean {
  return PLAN_CAPABILITIES[plan as Plan]?.issueHistory ?? false;
}

export function planIncludesActionPlan(plan: Plan | LegacyPlan): boolean {
  return PLAN_CAPABILITIES[plan as Plan]?.actionPlan ?? false;
}

export function isLegacyPlan(plan: string): plan is LegacyPlan {
  return plan === 'WebsiteAudit' || plan === 'Legacy';
}

/** What each plan is called on screen; the identifier already reads as a name. */
export const PLAN_DISPLAY_NAME: Readonly<Record<Plan, string>> = {
  Free: 'Free',
  Basic: 'Basic',
  Complete: 'Complete',
};

/**
 * What a retired plan is called on an old report, per language.
 *
 * Mirrors `LEGACY_PLAN_LABELS` in `packages/contracts/src/stored-plan.ts`
 * (pinned by `plan-modules.test.ts`): the API reads a stored row's plan into
 * one of these, and a report must name it rather than show the identifier.
 */
export const LEGACY_PLAN_NAME: Readonly<Record<Language, Readonly<Record<LegacyPlan, string>>>> = {
  en: { WebsiteAudit: 'Website Audit (archived)', Legacy: 'Archived plan' },
  uk: { WebsiteAudit: 'Website Audit (архів)', Legacy: 'Архівний тариф' },
};

/** The display name of a plan literal; unknown strings are shown as they are. */
export function planName(plan: string, language: Language): string {
  if (isLegacyPlan(plan)) return LEGACY_PLAN_NAME[language][plan];
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
 * The "cheapest plan that runs it" is looked up across the paid plans rather
 * than taken from the next rung of a ladder, so a plan added between two others
 * cannot quietly change what an upgrade prompt names.
 *
 * Empty for a retired plan too: its report shows the sections it stored, and
 * nothing is sold against it.
 */
export function modulesBeyondPlan(plan: Plan | LegacyPlan): readonly LockedModule[] {
  if (isLegacyPlan(plan)) return [];
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
