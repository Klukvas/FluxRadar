// Реестр реализованных правил по модулям. v0.1 (T-08): только SEO;
// passive-модули добавит T-09. Имя не совпадает с contracts.rulesForModule
// (дескрипторы) намеренно — здесь исполняемые реализации.

import type { ModuleName } from '@fluxradar/contracts';

import type { Rule } from './engine/types.js';
import { SEO_RULES } from './seo/index.js';

const RULES_BY_MODULE: ReadonlyMap<ModuleName, readonly Rule[]> = new Map([['SEO', SEO_RULES]]);

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
