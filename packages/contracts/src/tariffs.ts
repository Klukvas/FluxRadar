import type { ModuleName, Plan } from './enums.js';

// Entitlement lifetime per §18 refund policy: 30 days from payment; after expiry
// no new scans/retries are queued, a Running scan may finish.
export const ENTITLEMENT_DAYS = 30;

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
  readonly aiRequestLimit: number;
  readonly retentionDays: number;
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
    scoreWeights: {
      SEO: 0.2,
      'AI SEO / GEO': 0.15,
      Security: 0.2,
      Performance: 0.15,
      Accessibility: 0.1,
      Reliability: 0.1,
      'Content Quality': 0.05,
      Privacy: 0.05,
    },
    urlLimit: 50_000,
    aiRequestLimit: 500,
    retentionDays: 365,
  },
};
