// Usable output по §18 + D-026: у модуля есть хотя бы одна завершённая
// applicable check И сохранён хотя бы один валидный metric/score/finding
// с evidence. Findings, единственное содержание которых — недоступность самой
// цели (DNS/timeout/5xx на все запросы), usable output НЕ создают: это
// закрывает дыру «сайт лежит → Partial без refund» и соответствует интенту
// NoUsableOutput из §18.

export type OutputSignalKind = 'metric' | 'score' | 'finding';

/** Один сохранённый результат модуля, претендующий на usable output. */
export interface ModuleOutputSignal {
  readonly kind: OutputSignalKind;
  /** Валидный результат с сохранённым evidence; голый error/status record — false. */
  readonly hasEvidence: boolean;
  /**
   * true, если единственное содержание finding — недоступность самой цели.
   * Такой finding не считается usable для целей refund (D-026).
   */
  readonly targetUnreachable?: boolean;
}

export interface UsableOutputInput {
  readonly completedApplicableChecks: number;
  readonly signals: readonly ModuleOutputSignal[];
}

export function hasUsableOutput(input: UsableOutputInput): boolean {
  const { completedApplicableChecks, signals } = input;
  if (!Number.isInteger(completedApplicableChecks) || completedApplicableChecks < 0) {
    throw new Error(
      `hasUsableOutput: completedApplicableChecks должен быть целым >= 0, получено ${completedApplicableChecks}`,
    );
  }
  if (completedApplicableChecks === 0) {
    return false;
  }
  return signals.some((signal) => signal.hasEvidence && signal.targetUnreachable !== true);
}
