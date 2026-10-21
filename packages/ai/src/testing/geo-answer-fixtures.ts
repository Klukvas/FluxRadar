// Hand-built evaluator verdicts for the digest and rule tests: what a completed
// evaluation of one answer looks like after validation, without running one.

import type {
  GeoAnswerEvaluation,
  GeoEvaluatedClaim,
  GeoEvaluationVerdict,
} from '../geo-evaluation.js';
import { buildGeoEvidenceSnapshot } from '../geo-evidence.js';
import type { GeoEvidencePage, GeoEvidenceSnapshot } from '../geo-evidence.js';
import type { GeoToneLabel, GeoToneVerdict } from '../geo-tone.js';
import type { AiRequestOutcome } from '../run-request.js';
import type { AiProviderName } from '../types.js';
import { DOMAIN, makeRequest, makeResponse, makeResponseOutcome } from './harness.js';

export const PRICING_PAGE: GeoEvidencePage = {
  url: `https://${DOMAIN}/pricing/`,
  title: 'Pricing',
  visibleText: 'A Basic audit costs $39 and a Complete audit costs $87.',
};

export const ABOUT_PAGE: GeoEvidencePage = {
  url: `https://${DOMAIN}/about#team`,
  title: 'About',
  visibleText: 'FluxRadar is run from Kyiv and audits public websites.',
};

export function evidenceWith(pages: readonly GeoEvidencePage[]): GeoEvidenceSnapshot {
  return buildGeoEvidenceSnapshot({
    siteDomain: DOMAIN,
    brandIsHostname: false,
    profile: { brand: 'FluxRadar', businessDescription: 'Pay-per-scan website audits' },
    pages,
  });
}

export function answerOutcome(
  key: string,
  provider: AiProviderName,
  question = 'Which website audit tools do teams recommend?',
): AiRequestOutcome {
  return makeResponseOutcome({
    aiRequestKey: key,
    request: makeRequest({ provider, promptVersion: 'geo-questions-v5-discovery', question }),
    response: makeResponse({ provider, rawText: `answer ${key}`, citations: [] }),
  });
}

export function contradicted(
  claim: string,
  sourceId: string,
  sourceQuote: string,
  answerQuote = claim,
): GeoEvaluatedClaim {
  return { claim, verdict: 'contradicted', answerQuote, sourceId, sourceQuote };
}

export function unverified(claim: string): GeoEvaluatedClaim {
  return { claim, verdict: 'unverified', answerQuote: claim, sourceId: null, sourceQuote: null };
}

export function judgedTone(label: GeoToneLabel | null, quote = 'a quote'): GeoToneVerdict {
  return { judged: true, tone: label === null ? null : { label, quote }, adjusted: false };
}

export function completedEvaluation(
  parentAiRequestKey: string,
  claims: readonly GeoEvaluatedClaim[],
  tone: GeoToneVerdict = { judged: false },
): GeoAnswerEvaluation {
  const overall: GeoEvaluationVerdict = claims.some((claim) => claim.verdict === 'contradicted')
    ? 'contradicts-evidence'
    : 'unverified';
  return {
    parentAiRequestKey,
    purpose: 'discovery',
    status: 'Completed',
    reason: null,
    detail: null,
    payload: { answerDescribesSubject: true, claims, overall, overallAdjusted: false, tone },
    aiRequestKey: `judge:${parentAiRequestKey}`,
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    promptVersion: 'geo-answer-evaluation-v2',
    usage: null,
  };
}

export function unavailableEvaluation(parentAiRequestKey: string): GeoAnswerEvaluation {
  return {
    parentAiRequestKey,
    purpose: 'discovery',
    status: 'Unavailable',
    reason: 'ProviderUnavailable',
    detail: 'down',
    payload: null,
    aiRequestKey: null,
    provider: null,
    modelId: null,
    promptVersion: 'geo-answer-evaluation-v2',
    usage: null,
  };
}
