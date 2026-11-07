// The GEO preview a Free check runs (D-236).
//
// One real AI-visibility observation, and no more: the first closed-book direct
// question about the business, asked of Anthropic alone, plus the existing
// evaluation of that one answer against the homepage evidence. No discovery
// questions are generated (that would be a request carrying the profile's
// industry context for questions the preview never asks), no second provider is
// built a request, and no opt-in provider is reached whatever a stored record
// says. Everything else — the consent gate, the quota, the answer evaluation and
// the module row — is the paid pipeline unchanged.

import { noticeCoversGeoEvidence, runGeoModule } from '@fluxradar/ai';
import type {
  AiConsent,
  AiProvider,
  AiProviderName,
  AiQuotaTracker,
  AiRequest,
  GeoAnswerLanguage,
  GeoEvidenceSnapshot,
  GeoModuleResult,
} from '@fluxradar/ai';
import type { PrismaClient } from '@prisma/client';

import { isFreeCheckAllowedOrigin } from '../billing/free-check-allowlist.ts';
import { freeGeoQuestionRequest } from './free-geo-question.ts';
import type { GeoQuestionGenerationResult } from './geo.ts';

/** The one recipient of a Free check's AI data. */
export const FREE_GEO_PROVIDER: AiProviderName = 'anthropic';

/**
 * The Free preview's consent, narrowed to Anthropic.
 *
 * A Free record is written for Anthropic alone (scans/free-ai-consent.ts), so
 * this is a second wall rather than the first: a record that somehow names
 * more providers still authorises nothing beyond the one this preview asks.
 * No record, or one that does not name Anthropic, stays no consent — the
 * preview then reports ConsentMissing instead of sending anything.
 */
export function freeGeoConsent(consent: AiConsent | null): AiConsent | null {
  if (consent === null || !consent.providers.includes(FREE_GEO_PROVIDER)) return null;
  return { ...consent, providers: [FREE_GEO_PROVIDER] };
}

/**
 * The preview's single request: the first direct question the paid scan would
 * ask, to Anthropic, closed-book (no search, no tools), in the reader's
 * language (free-geo-question.ts).
 *
 * In English the prompt, system instructions, sequence and request key are
 * exactly the paid ones — a Free answer is the same observation a paid scan
 * would record for that question, not a cheaper variant of it.
 */
export function freeGeoRequests(
  scanId: string,
  brand: string,
  siteDomain: string,
  language: GeoAnswerLanguage = 'en',
): readonly AiRequest[] {
  return [
    freeGeoQuestionRequest({ scanId, brand, siteDomain, provider: FREE_GEO_PROVIDER, language }),
  ];
}

/**
 * The question-generation result of a run that generated nothing.
 *
 * Zero applicable checks, so the module row's coverage counts only the question
 * the preview actually asks and the evaluation of its answer.
 */
export function skippedQuestionGeneration(quota: AiQuotaTracker): GeoQuestionGenerationResult {
  return {
    status: 'NotApplicable',
    statusReason: 'FreePreview',
    applicableChecks: 0,
    completedApplicableChecks: 0,
    questions: [],
    outcome: null,
    quota,
  };
}

/**
 * Why a Free scan does not ask its preview question.
 *
 * - `ConsentMissing` — the owner did not opt in (or the record names no Anthropic).
 * - `FreePreviewAllowlistedOrigin` — an operator-allowlisted origin, exempt from
 *   both Free limits and so re-checkable without end; its preview would spend
 *   provider money on every run, so it is never asked there.
 * - `FreePreviewAlreadyRequested` — an earlier attempt of this scan already
 *   reached the provider stage. The aiRequestLimit tracker lives in memory per
 *   attempt; this is what makes "at most two Anthropic requests" hold per scan
 *   across a platform retry or the external retry as well.
 */
export type FreeGeoSkipReason =
  'ConsentMissing' | 'FreePreviewAllowlistedOrigin' | 'FreePreviewAlreadyRequested';

export type FreeGeoDecision =
  | { readonly kind: 'ask'; readonly consent: AiConsent }
  | { readonly kind: 'skip'; readonly reason: FreeGeoSkipReason };

export interface FreeGeoFacts {
  /** The stored record as loaded, before narrowing to Anthropic. */
  readonly consent: AiConsent | null;
  readonly allowlistedOrigin: boolean;
  readonly alreadyRequested: boolean;
}

/** Whether this attempt may ask the preview question, and with what consent. */
export function decideFreeGeo(facts: FreeGeoFacts): FreeGeoDecision {
  if (facts.allowlistedOrigin) return { kind: 'skip', reason: 'FreePreviewAllowlistedOrigin' };
  // Consent is fixed per scan, so it is the truer reason whenever it is missing:
  // a crash between the Running write and the skipped row must not turn "you
  // did not opt in" into "already requested" on the next attempt.
  const consent = freeGeoConsent(facts.consent);
  if (consent === null) return { kind: 'skip', reason: 'ConsentMissing' };
  if (facts.alreadyRequested) return { kind: 'skip', reason: 'FreePreviewAlreadyRequested' };
  return { kind: 'ask', consent };
}

/** The stored GEO row of an earlier attempt, as far as the guard reads it. */
export interface StoredGeoRow {
  readonly runtimeStatus: string;
  readonly metadataJson: string | null;
}

function metadataOf(metadataJson: string | null): Record<string, unknown> | null {
  if (metadataJson === null) return null;
  try {
    const metadata = JSON.parse(metadataJson) as unknown;
    return typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, unknown>)
      : null;
  } catch {
    // An unreadable row proves nothing either way; the ledger check still runs.
    return null;
  }
}

/**
 * Whether an earlier attempt of this scan reached the preview's provider step.
 *
 * Proof has to come from the GEO stage itself, not from any terminal row: a
 * site that could not be read gets an Unavailable GEO row from
 * markEveryModuleUnreadable without a request ever being built, and the
 * external retry granted for exactly that case must still ask the question.
 * What counts:
 *  - the sticky marker `previewRequested: true`, on a row of any status —
 *    written back by module-rows.ts `prepareModuleRows` (and kept by
 *    markEveryModuleUnreadable) whenever this guard was true, and carried by the
 *    FreePreviewAlreadyRequested row, so the proof survives any number of
 *    consecutive failed attempts that each clear and reset the row;
 *  - the row is Running — the stage sets it before the first request leaves;
 *  - the row carries `freePreview: true` and is not Not applicable — written
 *    only by geoModuleRow(scope 'free-preview') after the provider step ran
 *    (a skipped ConsentMissing / allowlisted row is Not applicable without the
 *    marker: nothing was sent, so a retry decides afresh);
 *  - an answer from this scan is in the ledger;
 *  - this is a module retry, which the preview never answers twice.
 */
export function geoStageReached(
  row: StoredGeoRow | null,
  storedAnswers: number,
  retryModule: string | undefined,
): boolean {
  if (retryModule !== undefined || storedAnswers > 0) return true;
  if (row === null) return false;
  if (row.runtimeStatus === 'Running') return true;
  const metadata = metadataOf(row.metadataJson);
  if (metadata?.previewRequested === true) return true;
  return row.runtimeStatus !== 'Not applicable' && metadata?.freePreview === true;
}

/**
 * Reads what geoStageReached needs. Must run before the attempt clears the
 * previous rows (run-attempt.ts), or the proof is gone.
 */
export async function freePreviewAlreadyRequested(
  prisma: PrismaClient,
  scanId: string,
  retryModule: string | undefined,
): Promise<boolean> {
  const [row, answers] = await Promise.all([
    prisma.scanModule.findFirst({
      where: { scanId, module: 'AI SEO / GEO' },
      select: { runtimeStatus: true, metadataJson: true },
    }),
    prisma.aiResponseRecord.count({ where: { scanId, module: 'AI SEO / GEO' } }),
  ]);
  return geoStageReached(row, answers, retryModule);
}

/**
 * The facts the decision reads, gathered in one place so the origin checked
 * against the allowlist is the profile's stored domain — the same value the
 * free-check route checked when it waived the Free limits.
 */
export function freePreviewFacts(input: {
  readonly consent: AiConsent | null;
  readonly profileDomain: string;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly alreadyRequested: boolean;
}): FreeGeoFacts {
  return {
    consent: input.consent,
    allowlistedOrigin: isFreeCheckAllowedOrigin(input.profileDomain, input.allowedOrigins),
    alreadyRequested: input.alreadyRequested,
  };
}

export interface FreeGeoPreviewInput {
  readonly scanId: string;
  readonly brand: string;
  readonly siteOrigin: string;
  readonly siteHostname: string;
  readonly facts: FreeGeoFacts;
  /**
   * The question's language, fixed for the scan at launch: the owner's choice,
   * else the site's language, else the UI language (D-237).
   */
  readonly language: GeoAnswerLanguage;
  /** Built only when the preview is asked and its notice covers evidence. */
  readonly buildEvidence: () => GeoEvidenceSnapshot;
  readonly provider: AiProvider;
  readonly quota: AiQuotaTracker;
  readonly signal?: AbortSignal;
}

export type FreeGeoPreviewResult =
  | { readonly kind: 'skipped'; readonly reason: FreeGeoSkipReason }
  | {
      readonly kind: 'asked';
      readonly geo: GeoModuleResult;
      readonly generation: GeoQuestionGenerationResult;
    };

/**
 * The whole Free preview stage short of persistence: decide, then ask the one
 * question (and evaluate its answer) through the paid pipeline. A skipped
 * preview builds no request and touches no provider.
 */
export async function runFreeGeoPreview(input: FreeGeoPreviewInput): Promise<FreeGeoPreviewResult> {
  const decision = decideFreeGeo(input.facts);
  if (decision.kind === 'skip') return { kind: 'skipped', reason: decision.reason };
  const generation = skippedQuestionGeneration(input.quota);
  const geo = await runGeoModule(
    {
      scanId: input.scanId,
      plan: 'Free',
      brand: input.brand,
      siteOrigin: input.siteOrigin,
      siteDomain: input.siteHostname,
      consent: decision.consent,
      requests: freeGeoRequests(input.scanId, input.brand, input.siteHostname, input.language),
      language: input.language,
      evidence: noticeCoversGeoEvidence(decision.consent.noticeVersion)
        ? input.buildEvidence()
        : null,
    },
    {
      provider: input.provider,
      quota: generation.quota,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    },
  );
  return { kind: 'asked', geo, generation };
}
