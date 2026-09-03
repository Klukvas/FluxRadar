// Coverage/status contract v1 (§15): coverage = completed_applicable_checks /
// applicable_checks. Расчёт — по точному значению; округление (round2) — только
// при отображении. Граница Partial — строго 0 < coverage < 1 (D-022 побеждает
// формулировку «1%–99%»).

import type { ModuleExportStatus } from '@fluxradar/contracts';

export interface CoverageInput {
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
  /** Обязателен для всех статусов, кроме обычного `Completed` (§15). */
  readonly statusReason?: string;
}

export interface ModuleCoverage {
  readonly status: ModuleExportStatus;
  /** Точное значение 0..1; для отображения округлять через round2. */
  readonly coverage: number;
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
  readonly statusReason: string | null;
}

/**
 * Выводит терминальный статус модуля и coverage из счётчиков проверок:
 * `Completed` → 1 (при applicable > 0), `Partial` → 0 < c < 1,
 * `Unavailable` → 0 + reason, `Not applicable` → applicable = 0, coverage 0 + reason.
 */
export function computeCoverage(input: CoverageInput): ModuleCoverage {
  const { applicableChecks, completedApplicableChecks } = input;
  validateCheckCounts(applicableChecks, completedApplicableChecks);
  if (applicableChecks === 0) {
    return withRequiredReason(input, 'Not applicable', 0);
  }
  if (completedApplicableChecks === 0) {
    return withRequiredReason(input, 'Unavailable', 0);
  }
  if (completedApplicableChecks === applicableChecks) {
    return {
      status: 'Completed',
      coverage: 1,
      applicableChecks,
      completedApplicableChecks,
      statusReason: input.statusReason ?? null,
    };
  }
  return withRequiredReason(input, 'Partial', completedApplicableChecks / applicableChecks);
}

function withRequiredReason(
  input: CoverageInput,
  status: ModuleExportStatus,
  coverage: number,
): ModuleCoverage {
  if (input.statusReason === undefined || input.statusReason.trim() === '') {
    throw new Error(`Статус ${status} требует непустой statusReason (§15 coverage contract)`);
  }
  return {
    status,
    coverage,
    applicableChecks: input.applicableChecks,
    completedApplicableChecks: input.completedApplicableChecks,
    statusReason: input.statusReason,
  };
}

function validateCheckCounts(applicableChecks: number, completedApplicableChecks: number): void {
  for (const [name, value] of [
    ['applicableChecks', applicableChecks],
    ['completedApplicableChecks', completedApplicableChecks],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`computeCoverage: ${name} должен быть целым >= 0, получено ${value}`);
    }
  }
  if (completedApplicableChecks > applicableChecks) {
    throw new Error(
      `computeCoverage: completed (${completedApplicableChecks}) не может превышать applicable (${applicableChecks})`,
    );
  }
}
