// Доступ к реестру rules-mvp-0.1: правило обязано существовать в contracts —
// severity и метаданные берутся только оттуда (T-02), не из кода правила.

import type { RuleDescriptor } from '@fluxradar/contracts';
import { ruleById } from '@fluxradar/contracts';

export function requireDescriptor(ruleId: string): RuleDescriptor {
  const descriptor = ruleById(ruleId);
  if (descriptor === undefined) {
    throw new Error(`rules: ${ruleId} отсутствует в реестре rules-mvp-0.1 (contracts)`);
  }
  return descriptor;
}
