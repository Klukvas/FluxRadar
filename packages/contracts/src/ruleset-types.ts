import type { ModuleName, Severity, TargetKind } from './enums.js';

export const RULESET_VERSION = 'rules-mvp-0.1';

/** Platform contracts (BILLING/EXPORT/ECON) are test invariants, not scanner rules. */
export type RuleModule = ModuleName | 'platform';

export type RuleScoring = 'scored' | 'informational';

export interface RuleDescriptor {
  readonly ruleId: string;
  readonly module: RuleModule;
  readonly title: string;
  readonly category: string;
  readonly targetKind: TargetKind;
  /** null for informational rules: they never penalize the score (score_delta = 0). */
  readonly severity: Severity | null;
  readonly scoring: RuleScoring;
  /** Short description of the deterministic oracle behind the check. */
  readonly oracle: string;
}
