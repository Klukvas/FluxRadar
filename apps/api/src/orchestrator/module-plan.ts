// Раскладка модулей по тарифу (§18 тарифная матрица + D-006).
// runnable — модули с реализованными правилами (движок rules);
// external — модули с подключаемым внешним runner-ом;
// geo — модуль «AI SEO / GEO» (T-10, mock-провайдер);
// stubs — модули тарифа, невозможные в v0.1: получают честный
// Unavailable / Not applicable со status_reason (D-006) и пишутся ПОСЛЕ
// resolveScanOutcome — они не «потерянная работа», а версионное отсутствие
// фичи, и не должны переводить успешный скан в Partial (см. D-192).

import type { ModuleName, ModuleRuntimeStatus, Plan } from '@fluxradar/contracts';

export interface StubModule {
  readonly module: ModuleName;
  readonly runtimeStatus: Extract<ModuleRuntimeStatus, 'Unavailable' | 'Not applicable'>;
  readonly statusReason: string;
  /**
   * Unavailable требует applicable > 0 при completed = 0 (§15 coverage
   * contract): единственная «проверка» — доступность источника данных.
   */
  readonly applicableChecks: number;
}

export interface ModulePlan {
  /** Порядок фиксирован реестром MODULE_NAMES — детерминированный прогон. */
  readonly runnable: readonly ModuleName[];
  readonly external: readonly ModuleName[];
  readonly geo: boolean;
  readonly stubs: readonly StubModule[];
}

/** Матрица IMPLEMENTATION_PLAN §2: Performance/Analytics — Unavailable, UX — N/A. */
const COMPLETE_STUBS: readonly StubModule[] = [
  {
    module: 'Analytics',
    runtimeStatus: 'Unavailable',
    statusReason: 'AnalyticsIntegrationNotConnected',
    applicableChecks: 1,
  },
  {
    module: 'UX/Conversion',
    runtimeStatus: 'Not applicable',
    statusReason: 'NoDeterministicOracle',
    applicableChecks: 0,
  },
];

const PLANS_TO_MODULES: Readonly<Record<Plan, ModulePlan>> = {
  // Free — фиксированная SEO-проверка homepage (§18), без GEO и score.
  Free: { runnable: ['SEO'], external: [], geo: false, stubs: [] },
  Basic: { runnable: ['SEO'], external: [], geo: true, stubs: [] },
  Complete: {
    runnable: ['SEO', 'Security', 'Accessibility', 'Reliability', 'Content Quality', 'Privacy'],
    external: ['Performance'],
    geo: true,
    stubs: COMPLETE_STUBS,
  },
};

export function modulePlanFor(plan: Plan): ModulePlan {
  return PLANS_TO_MODULES[plan];
}
