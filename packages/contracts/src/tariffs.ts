import type { ModuleName, Plan } from './enums.js';

// Entitlement lifetime per §18 refund policy: 30 days from payment; after expiry
// no new scans/retries are queued, a Running scan may finish.
export const ENTITLEMENT_DAYS = 30;

/**
 * What a plan entitles its owner to beyond the modules it runs.
 *
 * These used to be read off the plan literal — `scan.plan === 'Complete'` in the
 * export route, the Action Plan route, the history gate and the issue lifecycle.
 * That reading is wrong as soon as a second plan sells the same thing, so each
 * entitlement is now a fact of the tariff and every gate asks for the
 * entitlement it actually needs.
 */
export interface TariffCapabilities {
  /** The full historical list of the account's scans, not just the current one. */
  readonly scanHistory: boolean;
  /**
   * Issue status carries across scans of this plan: Resolved/Reopened and the
   * owner's own Acknowledged/Ignored/False Positive. Always compared within one
   * plan — two plans read different modules, so one's absence is not the other's
   * fix (§14, D-110).
   */
  readonly issueHistory: boolean;
  /** JSON and CSV export of the canonical §16 records. */
  readonly export: boolean;
  /** The optional AI Action Plan, under its own quota and window. */
  readonly actionPlan: boolean;
}

export type TariffCapability = keyof TariffCapabilities;

const NO_CAPABILITIES: TariffCapabilities = {
  scanHistory: false,
  issueHistory: false,
  export: false,
  actionPlan: false,
};

const FULL_REPORT_CAPABILITIES: TariffCapabilities = {
  scanHistory: true,
  issueHistory: true,
  export: true,
  actionPlan: true,
};

export interface TariffDefinition {
  readonly plan: Plan;
  /** Display / export literal (§16 export records use 'Complete Scan'). */
  readonly label: string;
  readonly priceUsd: number;
  readonly modules: readonly ModuleName[];
  /**
   * Fixed tariff weights over scored modules; sums to 1.0. UX/Conversion and
   * Analytics stay outside the overall score (§15) and never appear here.
   */
  readonly scoreWeights: Readonly<Partial<Record<ModuleName, number>>>;
  readonly urlLimit: number;
  /**
   * The most AI requests one scan of this plan may spend — a ceiling that stops
   * a runaway run, not a number of requests the report promises to contain.
   */
  readonly aiRequestLimit: number;
  readonly retentionDays: number;
  readonly capabilities: TariffCapabilities;
}

// §15: side scores 0-100 shown separately, excluded from the overall score.
export const SIDE_SCORE_MODULES: readonly ModuleName[] = ['UX/Conversion', 'Analytics'];

// §18: the fixed Free check runs these rules against the homepage only, in this order.
export const FREE_CHECK_RULE_IDS = [
  'SEO-ONPAGE-001',
  'SEO-ONPAGE-003',
  'SEO-ONPAGE-002',
  'SEO-TECH-008',
] as const;

/** The two search-facing modules. Website Audit is defined by running neither. */
export const SEARCH_MODULES: readonly ModuleName[] = ['SEO', 'AI SEO / GEO'];

const COMPLETE_SCORE_WEIGHTS: Readonly<Partial<Record<ModuleName, number>>> = {
  SEO: 0.2,
  'AI SEO / GEO': 0.15,
  Security: 0.2,
  Performance: 0.15,
  Accessibility: 0.1,
  Reliability: 0.1,
  'Content Quality': 0.05,
  Privacy: 0.05,
};

/**
 * Complete without the two search modules: the eight Website Audit runs.
 *
 * Written out rather than derived, because the tariff table is the readable
 * statement of what each package is — and `apps/web/src/plan-modules.test.ts`
 * reads this file as text to keep the UI's mirror honest. `tariffs.test.ts`
 * pins it against Complete so the two lists cannot drift.
 */
const WEBSITE_AUDIT_MODULES: readonly ModuleName[] = [
  'Security',
  'Performance',
  'Accessibility',
  'Reliability',
  'Content Quality',
  'Privacy',
  'UX/Conversion',
  'Analytics',
];

/**
 * The same relative importance the modules carry on Complete, rescaled to sum
 * to 1.0 over the ones the plan keeps.
 *
 * Derived rather than written out: Website Audit drops SEO (.20) and
 * AI SEO / GEO (.15), leaving .65 of Complete's weight, and hand-copied
 * quotients of .65 would be both unreadable and free to drift from the table
 * they came from.
 */
export function normalizeScoreWeights(
  weights: Readonly<Partial<Record<ModuleName, number>>>,
  modules: readonly ModuleName[],
): Readonly<Partial<Record<ModuleName, number>>> {
  const kept = Object.entries(weights).filter(([module]) =>
    modules.includes(module as ModuleName),
  );
  const total = kept.reduce((sum, [, weight]) => sum + (weight ?? 0), 0);
  if (total <= 0) {
    return {};
  }
  return Object.fromEntries(kept.map(([module, weight]) => [module, (weight ?? 0) / total]));
}

export const TARIFFS: Readonly<Record<Plan, TariffDefinition>> = {
  Free: {
    plan: 'Free',
    label: 'Free',
    priceUsd: 0,
    modules: ['SEO'],
    scoreWeights: {},
    urlLimit: 1,
    aiRequestLimit: 0,
    retentionDays: 30,
    capabilities: NO_CAPABILITIES,
  },
  Basic: {
    plan: 'Basic',
    label: 'Basic Scan',
    priceUsd: 55,
    modules: ['SEO', 'AI SEO / GEO'],
    scoreWeights: { SEO: 0.6, 'AI SEO / GEO': 0.4 },
    urlLimit: 5000,
    aiRequestLimit: 50,
    retentionDays: 30,
    capabilities: NO_CAPABILITIES,
  },
  // The eight non-search modules at $79: everything Complete reads about a site
  // except how search engines and AI systems read it. A sibling of Basic, not a
  // step between it and Complete — neither package contains the other.
  WebsiteAudit: {
    plan: 'WebsiteAudit',
    label: 'Website Audit Scan',
    priceUsd: 79,
    modules: [
      'Security',
      'Performance',
      'Accessibility',
      'Reliability',
      'Content Quality',
      'Privacy',
      'UX/Conversion',
      'Analytics',
    ],
    scoreWeights: normalizeScoreWeights(COMPLETE_SCORE_WEIGHTS, WEBSITE_AUDIT_MODULES),
    urlLimit: 50_000,
    // Complete's ceiling, kept deliberately: GEO — which spends most of it on
    // Complete — never runs here, so the plan spends far less than it may.
    aiRequestLimit: 500,
    retentionDays: 365,
    capabilities: FULL_REPORT_CAPABILITIES,
  },
  Complete: {
    plan: 'Complete',
    label: 'Complete Scan',
    priceUsd: 120,
    modules: [
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
    scoreWeights: COMPLETE_SCORE_WEIGHTS,
    urlLimit: 50_000,
    aiRequestLimit: 500,
    retentionDays: 365,
    capabilities: FULL_REPORT_CAPABILITIES,
  },
};

/**
 * Whether a plan entitles its owner to one capability.
 *
 * The one place a gate should ask. An unknown plan string — a row written by an
 * older or newer deployment — is refused rather than assumed to be entitled.
 */
export function planSupports(plan: string, capability: TariffCapability): boolean {
  const tariff = TARIFFS[plan as Plan] as TariffDefinition | undefined;
  return tariff?.capabilities[capability] ?? false;
}

/** Whether the plan runs this module at all; false for an unknown plan string. */
export function planRunsModule(plan: string, module: ModuleName): boolean {
  const tariff = TARIFFS[plan as Plan] as TariffDefinition | undefined;
  return tariff?.modules.includes(module) ?? false;
}
