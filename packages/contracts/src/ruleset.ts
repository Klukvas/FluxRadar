import { PLATFORM_CONTRACTS } from './ruleset-platform.js';
import { RULES_MVP_01 } from './ruleset-scanning.js';
import type { RuleDescriptor, RuleModule } from './ruleset-types.js';

export { RULESET_VERSION } from './ruleset-types.js';
export type { RuleDescriptor, RuleModule, RuleScoring } from './ruleset-types.js';
export { RULES_MVP_01 } from './ruleset-scanning.js';
export { PLATFORM_CONTRACTS } from './ruleset-platform.js';

/** Full rules-mvp-0.1 registry: scanner + GEO rules plus platform contracts. */
export const RULESET_ALL: readonly RuleDescriptor[] = [...RULES_MVP_01, ...PLATFORM_CONTRACTS];

const RULES_BY_ID: ReadonlyMap<string, RuleDescriptor> = new Map(
  RULESET_ALL.map((rule) => [rule.ruleId, rule]),
);

export const ruleById = (ruleId: string): RuleDescriptor | undefined => RULES_BY_ID.get(ruleId);

export const rulesForModule = (module: RuleModule): readonly RuleDescriptor[] =>
  RULESET_ALL.filter((rule) => rule.module === module);
