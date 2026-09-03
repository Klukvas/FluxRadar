// Реестр реализованных правил по модулям: SEO (T-08) + passive-модули
// Security/Reliability/Accessibility/Content Quality/Privacy (T-09).
// Имя не совпадает с contracts.rulesForModule (дескрипторы) намеренно —
// здесь исполняемые реализации.

import type { ModuleName } from '@fluxradar/contracts';

import { ACCESSIBILITY_RULES } from './accessibility/index.js';
import { CONTENT_RULES } from './content/index.js';
import type { Rule } from './engine/types.js';
import { PRIVACY_RULES } from './privacy/index.js';
import { RELIABILITY_RULES } from './reliability/index.js';
import { SECURITY_RULES } from './security/index.js';
import { SEO_RULES } from './seo/index.js';

const RULES_BY_MODULE: ReadonlyMap<ModuleName, readonly Rule[]> = new Map([
  ['SEO', SEO_RULES],
  ['Security', SECURITY_RULES],
  ['Reliability', RELIABILITY_RULES],
  ['Accessibility', ACCESSIBILITY_RULES],
  ['Content Quality', CONTENT_RULES],
  ['Privacy', PRIVACY_RULES],
]);

export function implementedModules(): readonly ModuleName[] {
  return [...RULES_BY_MODULE.keys()];
}

/** Модуль без реализаций — ошибка вызывающего: его статус решается до движка. */
export function rulesForModule(module: ModuleName): readonly Rule[] {
  const rules = RULES_BY_MODULE.get(module);
  if (rules === undefined) {
    throw new Error(
      `rules: модуль "${module}" не имеет реализованных правил ` +
        `(v0.1: ${implementedModules().join(', ')})`,
    );
  }
  return rules;
}
