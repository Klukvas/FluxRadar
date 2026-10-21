// Versioned processing-notice gate for paid AI modules. The persisted model is
// still named AiConsent for database/API compatibility, but the product now
// presents AI processing as an included part of the paid audit with a prominent
// pre-purchase disclosure, not as an optional checkbox.

import { ConsentMissingError } from './errors.js';
import { isOptInProvider } from './types.js';
import type { AiProviderName } from './types.js';

// v5 added one data flow to AI SEO / GEO: each answer is checked against a
// bounded snapshot of the owner-entered profile and text from the public pages
// this scan crawled. A plan that ran GEO alone previously sent no page content
// at all, so a record written under an earlier notice — including v4, which
// disclosed the second provider and web search and nothing about evidence —
// cannot establish that the disclosure for *that* processing was shown before
// purchase.
//
// v6 (owner decision; D-234 in the local, untracked docs/DECISIONS.md, so it is
// restated here): the same evaluator request now also judges the tone in
// which the answer describes the business. No new request, no new recipient and
// no new data — but a new purpose of an existing request, which v5's "checks it
// against the evidence" does not name. So a v5 record keeps everything v5
// disclosed, evidence evaluation included, and its answers are judged without
// tone; only a v6 record lets the evaluator be asked about tone. v5 stays in the
// accepted list for the transition period, as v3/v4 did before it.
export const CURRENT_AI_PROCESSING_NOTICE_VERSION = 'core-ai-processing-notice-v6';

/**
 * Notices a stored record may carry and still authorise work.
 *
 * A version bump must not retroactively cancel processing a customer already
 * paid for and was properly told about. A scan bought under v3 keeps its 30-day
 * retry entitlement and exactly the flows v3 disclosed — question generation,
 * the direct and discovery questions, the UX review; v3 named only Anthropic,
 * so such a retry runs the Anthropic requests and records every other provider
 * as `ConsentMissing`. A v4 scan adds the second provider and web search, and
 * still no evidence evaluation. A v5 scan adds evidence evaluation and no tone
 * judgement. Anything outside this list (a retired notice, an unknown string, a
 * downgrade written by hand) is treated as no consent at all.
 *
 * Remove `…-v3` 30 days after the release that introduced v4 shipped, and
 * `…-v5` 30 days after the release that introduced v6.
 */
export const ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS: readonly string[] = [
  'core-ai-processing-notice-v3',
  'core-ai-processing-notice-v4',
  'core-ai-processing-notice-v5',
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
];

/**
 * The notices that named the opt-in visibility providers.
 *
 * The disclosure that lets a byte reach Google or Perplexity arrived in v4, so
 * the gate is "this notice named them", not "this notice is the newest one" —
 * otherwise every later bump would silently revoke an entitlement a v4 customer
 * paid for and was told about.
 */
const NOTICES_NAMING_OPT_IN_PROVIDERS: readonly string[] = [
  'core-ai-processing-notice-v4',
  'core-ai-processing-notice-v5',
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
];

/** The notices that disclosed the evidence evaluation (v5 introduced it). */
const NOTICES_COVERING_GEO_EVIDENCE: readonly string[] = [
  'core-ai-processing-notice-v5',
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
];

/**
 * The notices that disclosed the tone judgement (v6 introduced it).
 *
 * v6 is written out rather than read from the current version, so the next
 * notice bump cannot quietly stop judging tone on every v6 scan still inside
 * its retry window; the current notice is listed as well, as the evidence list
 * does — a later notice that drops the tone purpose must take it out here.
 */
const NOTICES_COVERING_GEO_TONE: readonly string[] = [
  'core-ai-processing-notice-v6',
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
];

export function isAcceptedNoticeVersion(version: string): boolean {
  return ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS.includes(version);
}

/**
 * Whether this scan's disclosure covered sending the site's own evidence.
 *
 * The v5 and v6 notices state that each answer is checked, in its own request,
 * against the saved profile fields and text from the crawled public pages.
 * Under an earlier notice that request is never built, so no profile field and
 * no page text leaves the machine for evaluation.
 */
export function noticeCoversGeoEvidence(noticeVersion: string): boolean {
  return NOTICES_COVERING_GEO_EVIDENCE.includes(noticeVersion);
}

/**
 * Whether this scan's disclosure covered asking the evaluator about tone.
 *
 * Only v6 says that the evaluator also judges the tone in which an answer
 * describes the business. Under v5 the same evaluator request runs without
 * that question, and the report says the tone was not judged in that scan.
 */
export function noticeCoversGeoTone(noticeVersion: string): boolean {
  return NOTICES_COVERING_GEO_TONE.includes(noticeVersion);
}

/**
 * The notice shown beside the Action Plan button, and the version the click
 * accepts (D-232).
 *
 * It is deliberately NOT the pre-purchase processing notice. That one covers the
 * AI work the price includes and is written months before the click; this one is
 * a fresh purpose the owner chooses per plan — a new provider request, written
 * in a language they picked, about issues they can still triage. Storing the
 * purchase notice beside a plan would misreport which disclosure the owner was
 * actually reading when they spent the generation.
 */
export const ACTION_PLAN_NOTICE_VERSION = 'action-plan-notice-v1';

/** Click notices the API still accepts; an unknown one is refused, never stored. */
export const ACCEPTED_ACTION_PLAN_NOTICE_VERSIONS: readonly string[] = [ACTION_PLAN_NOTICE_VERSION];

export function isAcceptedActionPlanNoticeVersion(version: string): boolean {
  return ACCEPTED_ACTION_PLAN_NOTICE_VERSIONS.includes(version);
}

export interface AiConsent {
  readonly scanId: string;
  readonly providers: readonly AiProviderName[];
  readonly noticeVersion: string;
}

/**
 * Throws when the persisted processing record is absent, was written under a
 * notice this release no longer honours, or does not cover the provider. The
 * caller verifies that the record belongs to this scan.
 *
 * The version check is not bookkeeping: a record is an authorisation to send
 * customer text to a named company, and what authorises it is the disclosure the
 * owner actually read. A version outside the accepted list is either a retired
 * notice or a record nobody wrote on purpose, and both fail closed.
 *
 * Google and Perplexity are opt-in recipients: naming them in the stored record
 * is the only thing that lets a single byte reach them, and a record written
 * under an older notice can never have named them.
 */
export function ensureConsent(consent: AiConsent | null, provider: AiProviderName): void {
  if (consent === null) {
    throw new ConsentMissingError(provider, 'no consent record for this scan');
  }
  if (!isAcceptedNoticeVersion(consent.noticeVersion)) {
    throw new ConsentMissingError(
      provider,
      `notice ${consent.noticeVersion} is not a processing notice this release honours`,
    );
  }
  if (!consent.providers.includes(provider)) {
    throw new ConsentMissingError(
      provider,
      `consent (notice ${consent.noticeVersion}) does not cover this provider`,
    );
  }
  if (
    isOptInProvider(provider) &&
    !NOTICES_NAMING_OPT_IN_PROVIDERS.includes(consent.noticeVersion)
  ) {
    throw new ConsentMissingError(
      provider,
      `notice ${consent.noticeVersion} predates the opt-in disclosure naming this provider`,
    );
  }
}
