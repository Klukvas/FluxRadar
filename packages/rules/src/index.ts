// @fluxradar/rules — rule engine + модули SEO (T-08) и passive-модули
// Security/Reliability/Accessibility/Content Quality/Privacy (T-09).
// Правила читают SiteContext (результат crawl T-07), движок собирает
// Issue-кандидаты с fingerprint-v1 (T-03) и coverage-счётчики для scoring
// (T-04); severity и метаданные правил живут в реестре contracts (T-02).

export type {
  ApiCheck,
  ApiCheckMethod,
  ApiCheckSnapshot,
  ApiRule,
  PageRule,
  Rule,
  RuleEvaluation,
  RuleFinding,
  RuleVariant,
  SiteContext,
  SiteRule,
  SiteRuleResult,
} from './engine/types.js';
export {
  API_CHECK_METHODS,
  RULE_VARIANT_V1,
  hasHttpResponse,
  isSuccessfulHtmlPage,
} from './engine/types.js';
export { truncateExcerpt } from './engine/evidence.js';
export { IMG_ALT_EVIDENCE_CATEGORY, evidenceGroupId } from './engine/evidence-group.js';
export { apiFinding, pageFinding, siteFinding } from './engine/finding.js';
export { requireDescriptor } from './engine/descriptor.js';
export { createSiteContext, normalizedOrigin } from './engine/site-context.js';
export type { SiteContextInput } from './engine/site-context.js';
export { runModuleRules } from './engine/run-module.js';
export type { IssueCandidate, ModuleRunResult } from './engine/run-module.js';
export { implementedModules, rulesForModule } from './registry.js';
export { SEO_RULES } from './seo/index.js';
export { SECURITY_RULES } from './security/index.js';
export { RELIABILITY_RULES } from './reliability/index.js';
export { ACCESSIBILITY_RULES } from './accessibility/index.js';
export { CONTENT_RULES } from './content/index.js';
export { PRIVACY_RULES } from './privacy/index.js';
