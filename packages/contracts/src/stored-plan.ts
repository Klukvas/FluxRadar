// The plan a stored row carries, read without trusting it to be a current plan.
//
// `plan` is a plain string column on Purchase, CheckoutSession and Scan, and no
// migration rewrites old rows. Website Audit was sold for a while and then
// removed (2026-10-19); internal and test rows of it remain. A report, a list,
// an admin count or a comparison must still render such a row, so every read
// path maps the stored string through `readStoredPlan` — the one tolerant
// boundary — instead of narrowing it to `Plan`.
//
// A legacy value is read-only by construction: it is not in `PLANS`, so no
// request schema, tariff lookup, checkout or scan launch accepts it, and
// `planSupports` grants it no capability.

import type { ModuleName, Plan } from './enums.js';
import { isPlan } from './enums.js';
import {
  COMPLETE_SCORE_WEIGHTS,
  TARIFFS,
  normalizeScoreWeights,
  type TariffDefinition,
} from './tariffs.js';

/**
 * Plans that exist only on stored rows.
 *
 * `WebsiteAudit` is the retired package. `Legacy` is the catch-all for any
 * other string this deployment does not know — a row from a newer deployment,
 * or a typo in a hand-written fixture — so an unknown value is still one of a
 * closed set on the wire.
 */
export const LEGACY_PLANS = ['WebsiteAudit', 'Legacy'] as const;
export type LegacyPlan = (typeof LEGACY_PLANS)[number];

/** Every value a read model may carry for a stored row's plan. */
export const STORED_PLANS = [
  'Free',
  'Basic',
  'Complete',
  ...LEGACY_PLANS,
] as const satisfies readonly (Plan | LegacyPlan)[];
export type StoredPlan = (typeof STORED_PLANS)[number];

/** English display names of legacy plans (PDF, export, admin). */
export const LEGACY_PLAN_LABELS: Readonly<Record<LegacyPlan, string>> = {
  WebsiteAudit: 'Website Audit (archived)',
  Legacy: 'Archived plan',
};

export function isLegacyPlan(plan: string): plan is LegacyPlan {
  return (LEGACY_PLANS as readonly string[]).includes(plan);
}

/** Maps a stored plan string to the read model; never throws. */
export function readStoredPlan(value: string): StoredPlan {
  if (isPlan(value)) return value;
  if (value === 'WebsiteAudit') return 'WebsiteAudit';
  return 'Legacy';
}

/** The plan's display label: the tariff label, or the archived name of a legacy plan. */
export function storedPlanLabel(plan: StoredPlan): string {
  return isLegacyPlan(plan) ? LEGACY_PLAN_LABELS[plan] : TARIFFS[plan].label;
}

/**
 * The overall-score weights of a stored scan.
 *
 * A current plan uses its tariff. A legacy plan has no tariff, so it uses the
 * modules the scan actually stored, with the relative importance Complete gives
 * them — the same weights Website Audit had when it was sold.
 */
export function storedPlanScoreWeights(
  plan: StoredPlan,
  storedModules: readonly ModuleName[],
): TariffDefinition['scoreWeights'] {
  if (!isLegacyPlan(plan)) return TARIFFS[plan].scoreWeights;
  return normalizeScoreWeights(COMPLETE_SCORE_WEIGHTS, storedModules);
}

/**
 * How long a stored scan's report is kept.
 *
 * A legacy plan has no tariff row, so it is kept as long as the longest-kept
 * current report (Complete's 365 days, which is also what Website Audit
 * promised): never purged earlier than it was sold with, and never kept forever
 * just because its plan string is no longer known.
 */
export function storedPlanRetentionDays(plan: StoredPlan): number {
  if (!isLegacyPlan(plan)) return TARIFFS[plan].retentionDays;
  return Math.max(...Object.values(TARIFFS).map((tariff) => tariff.retentionDays));
}
