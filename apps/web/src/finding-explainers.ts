// What a finding means, for an owner who does not run servers or write markup.
//
// The rules that fill a report are named for engineers — "Content-Security-Policy
// is missing or weak", "ARIA attributes are used incorrectly" — and a site that
// misses one server setting misses it on every page, so one fix arrives as
// hundreds of findings whose only text is the server's wording.
//
// So each entry answers, in the owner's words, what the problem is called, what
// was found, why it is worth a developer's time, the one thing the owner can do,
// and what one finding counts — the rules do not all count the same thing.
// Header names, attribute names and markup belong to the developer, so they stay
// out of here and live in the finding's technical details instead.
//
// Deliberately narrow about what the scanner knows: it reads the response a
// public page sent back. A finding is a safeguard that is not switched on, or a
// page that reads worse than it could — never a claim that the site has been
// exploited, and never a promise of what a fix will earn.
//
// Every scored rule has an entry. `finding-variants.test.ts` reads the rule
// registry and fails when a scored rule has none, so a new rule is a decision,
// not an accident. Scored rules only: informational ones (D-109) never become
// Issue rows. A rule with no entry keeps the title, evidence and
// recommendation it always had.

import { ACCESSIBILITY_EXPLAINERS } from './explainers/accessibility';
import { ANALYTICS_EXPLAINERS } from './explainers/analytics';
import { CONTENT_EXPLAINERS } from './explainers/content';
import { PRIVACY_EXPLAINERS } from './explainers/privacy';
import { RELIABILITY_EXPLAINERS } from './explainers/reliability';
import { SECURITY_EXPLAINERS } from './explainers/security';
import { SEO_EXPLAINERS } from './explainers/seo';
import type { ExplainedRule, FindingExplainer } from './explainers/types';
import { UX_EXPLAINERS } from './explainers/ux';
import type { Language } from './i18n';
import { ruleTitle } from './rule-titles';

export type { FindingExplainer } from './explainers/types';

/** One table, kept in one file per module (`./explainers/`). */
const EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  ...SECURITY_EXPLAINERS,
  ...ACCESSIBILITY_EXPLAINERS,
  ...SEO_EXPLAINERS,
  ...PRIVACY_EXPLAINERS,
  ...CONTENT_EXPLAINERS,
  ...UX_EXPLAINERS,
  ...RELIABILITY_EXPLAINERS,
  ...ANALYTICS_EXPLAINERS,
};

/** Every rule with a plain-language explanation, for the coverage test. */
export const EXPLAINED_RULE_IDS: readonly string[] = Object.keys(EXPLAINERS);

/** The plain-language explanation of a rule, or null for a rule that has none. */
export function findingExplainer(ruleId: string, language: Language): FindingExplainer | null {
  return EXPLAINERS[ruleId]?.[language] ?? null;
}

/**
 * Whether this rule is explained in plain language — the condition for folding
 * its raw evidence and recommendation away under the technical disclosure.
 */
export function hasFindingExplainer(ruleId: string): boolean {
  return EXPLAINERS[ruleId] !== undefined;
}

/**
 * Whether one finding of this rule is one page, so a count of its findings can
 * be said as a count of pages. Unknown rules say "findings": claiming pages for
 * a rule that reports per cookie or per link would overstate the reach.
 */
export function findingCountsPages(ruleId: string): boolean {
  return EXPLAINERS[ruleId]?.countsPages ?? false;
}

/** Whether this rule's findings are AI-review remarks (`ExplainedRule.isAiReview`). */
export function isAiReviewRule(ruleId: string): boolean {
  return EXPLAINERS[ruleId]?.isAiReview === true;
}

/** The problem's name in the owner's words, or the rule's own title when it has none. */
export function problemTitle(ruleId: string, language: Language): string {
  return findingExplainer(ruleId, language)?.title ?? ruleTitle(ruleId, language);
}

/**
 * The rule's technical title when the headline is the plain one — the name the
 * report's dashboard and the developer use — and the bare rule id otherwise,
 * as it always was. It belongs in a finding's technical details: beside the
 * plain name it restated the same problem in the developer's words, and the
 * row read as two problems.
 */
export function problemTechnicalName(ruleId: string, language: Language): string {
  return hasFindingExplainer(ruleId) ? ruleTitle(ruleId, language) : ruleId;
}

/**
 * The rule id for a list row to carry beside the section, or null when it adds
 * nothing there.
 *
 * It adds nothing twice over: under a plain-language name the id is a support
 * code that belongs with the rest of the developer's half, and for a rule with
 * no registered title at all `problemTitle` already falls back to the id, so
 * printing it again says the same word twice on one row.
 */
export function problemSupportCode(ruleId: string, language: Language): string | null {
  if (hasFindingExplainer(ruleId)) return null;
  return problemTitle(ruleId, language) === ruleId ? null : ruleId;
}
