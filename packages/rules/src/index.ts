// @fluxradar/rules — rule engine + SEO-модуль (T-08).
// Правила читают SiteContext (результат crawl T-07), движок собирает
// Issue-кандидаты с fingerprint-v1 (T-03) и coverage-счётчики для scoring
// (T-04); severity и метаданные правил живут в реестре contracts (T-02).

export type {
  PageRule,
  Rule,
  RuleEvaluation,
  RuleFinding,
  RuleVariant,
  SiteContext,
  SiteRule,
  SiteRuleResult,
} from './engine/types.js';
export { RULE_VARIANT_V1, hasHttpResponse, isSuccessfulHtmlPage } from './engine/types.js';
export { truncateExcerpt } from './engine/evidence.js';
export { pageFinding, siteFinding } from './engine/finding.js';
export { requireDescriptor } from './engine/descriptor.js';
export { createSiteContext, normalizedOrigin } from './engine/site-context.js';
export type { SiteContextInput } from './engine/site-context.js';
export { runModuleRules } from './engine/run-module.js';
export type { IssueCandidate, ModuleRunResult } from './engine/run-module.js';
export { implementedModules, rulesForModule } from './registry.js';
export { SEO_RULES } from './seo/index.js';
