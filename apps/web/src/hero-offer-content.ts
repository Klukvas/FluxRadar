// The facts the home page slider states, read off the lists they describe.
//
// Each slide says how much a report checks and which plan has it, beside a
// form whose button starts the Free check — so a paid slide that named no plan
// would read as part of what Free gives. Every number and plan name here comes
// from the source the product itself reads: the SEO and Security check
// catalogues, the assistants the AI processing notice names, the tariff's
// module table and its capability table. A tariff change moves the slide with
// it instead of leaving it promising the old offer.

import { AI_PROCESSING_OPT_IN_PROVIDERS, AI_PROCESSING_PROVIDERS } from './ai-processing-notice';
import { COMPLETE_RULE_CATALOG } from './complete-check-catalog';
import { SEO_CHECK_CATALOG } from './free-seo-catalog';
import { geoProviderLabel } from './geo-provider-label';
import { heroOfferCopy } from './hero-offer-copy';
import type { Language } from './i18n';
import {
  PAID_PLAN_ORDER,
  PLAN_CAPABILITIES,
  PLAN_MODULES,
  planName,
  type PaidPlan,
} from './plan-modules';

/** The checks behind "for Google search": the whole SEO catalogue. */
export const SEO_CHECK_COUNT = SEO_CHECK_CATALOG.length;

/** The Security section's checks, as Complete's catalogue lists them. */
export const SECURITY_CHECK_COUNT = (COMPLETE_RULE_CATALOG.Security ?? []).length;

/** The assistants every paid scan asks, and the ones a buyer may add. */
export const AI_ASKED_COUNT = AI_PROCESSING_PROVIDERS.length;
export const AI_OPTIONAL_COUNT = AI_PROCESSING_OPT_IN_PROVIDERS.length;

/** The paid plans that run a section in full. Free's one-answer AI preview is not one. */
export function paidPlansWithModule(module: string): readonly PaidPlan[] {
  return PAID_PLAN_ORDER.filter((plan) => PLAN_MODULES[plan].includes(module));
}

/** The paid plans that include the AI action plan. */
export function paidPlansWithActionPlan(): readonly PaidPlan[] {
  return PAID_PLAN_ORDER.filter((plan) => PLAN_CAPABILITIES[plan].actionPlan);
}

/** "A", "A and B", "A, B and C": a list as a phrase, in the page's language. */
export function joinList(names: readonly string[], language: Language): string {
  const last = names.at(-1);
  if (last === undefined) return '';
  if (names.length === 1) return last;
  return heroOfferCopy[language].joinNames(names.slice(0, -1).join(', '), last);
}

/** "In Basic and Complete.", in the page's language. */
export function plansCaption(plans: readonly PaidPlan[], language: Language): string {
  return heroOfferCopy[language].inPlans(
    joinList(
      plans.map((plan) => planName(plan, language)),
      language,
    ),
  );
}

/**
 * Slide 1's caption, "Basic and Complete include 27 checks for Google search…":
 * phrased as what the plans include, not as what ran on the salon, whose own
 * SEO section in the full example counts only the checks that applied to it.
 */
export function seoChecksCaption(language: Language): string {
  const plans = paidPlansWithModule('SEO');
  return heroOfferCopy[language].report.includes(
    SEO_CHECK_COUNT,
    joinList(
      plans.map((plan) => planName(plan, language)),
      language,
    ),
    plans.length,
  );
}

/** The opt-in assistants by the names the report gives them, joined. */
export function optionalAssistantsLabel(language: Language): string {
  return joinList(
    AI_PROCESSING_OPT_IN_PROVIDERS.map((provider) => geoProviderLabel(provider, language)),
    language,
  );
}
