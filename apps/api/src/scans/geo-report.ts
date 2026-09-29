import {
  GEO_CLAIM_VERDICTS,
  GEO_EVALUATION_VERDICTS,
  MENTION_SIGNALS,
  deriveGeoVerdict,
  quoteOccursIn,
  type GeoClaimVerdict,
  type GeoEvaluationVerdict,
  type MentionSignal,
} from '@fluxradar/ai';

export interface GeoAiResponse {
  readonly aiRequestKey: string;
  readonly provider: string;
  readonly modelId: string;
  readonly rawText: string;
  readonly citationsJson: string;
}

/**
 * What one answer showed about brand and domain visibility.
 *
 * Not booleans: a question that already named the brand or spelled out the
 * domain cannot be evidence that the model knows either, and reporting that as
 * a pass is how both badges came to be green on every scan.
 */
interface GeoMentions {
  readonly brand: MentionSignal;
  readonly domain: MentionSignal;
}

/**
 * How the question was put.
 *
 * `awareness` exists only on scans that ran before the direct questions became
 * closed-book: those questions named the brand and the domain, and the report
 * must keep saying so rather than relabelling them.
 */
type GeoObservationPurpose = 'closed-book' | 'awareness' | 'discovery';

const GEO_OBSERVATION_PURPOSES: readonly GeoObservationPurpose[] = [
  'closed-book',
  'awareness',
  'discovery',
];

/** One statement the answer made, and what the scan's evidence says about it. */
interface GeoEvaluatedClaimDto {
  readonly claim: string;
  readonly verdict: GeoClaimVerdict;
  readonly answerQuote: string;
  readonly sourceId: string | null;
  readonly sourceQuote: string | null;
}

/**
 * The verdict on one answer, or the reason there is none.
 *
 * Absent entirely on a scan that ran before this release: the report then says
 * the answer was not evaluated, which is true, instead of showing a pass.
 */
interface GeoEvaluationDto {
  readonly status: 'Completed' | 'Unavailable';
  readonly reason: string | null;
  readonly overall: GeoEvaluationVerdict | null;
  readonly answerDescribesSubject: boolean | null;
  readonly claims: readonly GeoEvaluatedClaimDto[];
  readonly provider: string | null;
  readonly modelId: string | null;
}

interface GeoObservation {
  readonly purpose: GeoObservationPurpose;
  readonly question: string;
  readonly status: 'answered' | 'unavailable';
  readonly reason: string | null;
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly answer: string | null;
  readonly citations: readonly string[];
  readonly mentions: GeoMentions | null;
  readonly evaluation: GeoEvaluationDto | null;
}

/** One piece of what the scan observed about the site, as the report cites it. */
interface GeoEvidenceSourceDto {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly url: string | null;
  readonly excerpt: string;
  readonly provenance: string;
}

interface GeoEvidenceDto {
  readonly sufficiency: string;
  readonly limits: readonly string[];
  readonly sources: readonly GeoEvidenceSourceDto[];
}

function parseMetadata(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * Turns the GEO execution ledger into the evidence the report can display.
 *
 * The request list is authoritative: the generator response uses the same
 * module but is an implementation detail, so it never appears as a visibility
 * observation. A response row without a matching recorded request is ignored;
 * a recorded response whose evidence row is missing is shown as unavailable
 * instead of manufacturing an answer.
 */
export function geoObservationsFrom(
  metadataJson: string | undefined,
  responses: readonly GeoAiResponse[],
  evidence: GeoEvidenceDto | null,
): readonly GeoObservation[] {
  if (metadataJson === undefined) return [];
  const metadata = recordValue(parseMetadata(metadataJson));
  const visibility = recordValue(metadata?.providerVisibility);
  const requests = visibility?.requests;
  if (!Array.isArray(requests)) return [];
  const responsesByKey = new Map(responses.map((response) => [response.aiRequestKey, response]));

  return requests.flatMap((entry): GeoObservation[] => {
    const request = recordValue(entry);
    const question = request?.question;
    const purpose = request?.purpose;
    if (
      request === null ||
      typeof purpose !== 'string' ||
      !GEO_OBSERVATION_PURPOSES.includes(purpose as GeoObservationPurpose) ||
      typeof question !== 'string' ||
      question.trim() === ''
    ) {
      return [];
    }
    const observationPurpose = purpose as GeoObservationPurpose;
    const reason = typeof request.reason === 'string' ? request.reason : null;
    // Reports written before two providers answered have no provider on the
    // request entry; they read as an answer from nobody in particular, which is
    // what they were.
    const provider =
      typeof request.provider === 'string' && request.provider !== '' ? request.provider : null;
    if (request.status !== 'response' || typeof request.aiRequestKey !== 'string') {
      return [unavailableGeoObservation(observationPurpose, question, reason, provider)];
    }
    const response = responsesByKey.get(request.aiRequestKey);
    if (response === undefined) {
      return [
        unavailableGeoObservation(observationPurpose, question, 'EvidenceUnavailable', provider),
      ];
    }
    return [
      {
        purpose: observationPurpose,
        question,
        status: 'answered',
        reason: null,
        provider: response.provider,
        modelId: response.modelId,
        answer: response.rawText,
        citations: stringArrayFromJson(response.citationsJson),
        mentions: mentionsFrom(request.mentions),
        evaluation: evaluationFrom(request.evaluation, response.rawText, evidence),
      },
    ];
  });
}

function unavailableGeoObservation(
  purpose: GeoObservationPurpose,
  question: string,
  reason: string | null,
  provider: string | null,
): GeoObservation {
  return {
    purpose,
    question,
    status: 'unavailable',
    reason,
    provider,
    modelId: null,
    answer: null,
    citations: [],
    mentions: null,
    evaluation: null,
  };
}

/** A stored record we will not read as a verdict, and why. */
function unreadableEvaluation(reason: string): GeoEvaluationDto {
  return {
    status: 'Unavailable',
    reason,
    overall: null,
    answerDescribesSubject: null,
    claims: [],
    provider: null,
    modelId: null,
  };
}

/**
 * The stored verdict, re-checked before it is shown.
 *
 * A record written before evaluations existed has no `evaluation` key and
 * yields null — "not evaluated in this scan". Anything present is read
 * fail-closed: a `Completed` record whose claims do not parse, or whose quotes
 * no longer sit in the answer and the evidence stored beside them, becomes
 * `Unavailable`. Dropping the bad claims and keeping the label would turn a
 * corrupt row into a green "supported by your site's evidence" with nothing
 * under it, and the stored verdict is the one thing a historical report cannot
 * re-derive.
 *
 * The verdict itself is derived here from the claims that survived, by the same
 * rule the evaluator used, so the stored `overall` cannot outrank them either.
 */
function evaluationFrom(
  value: unknown,
  answer: string,
  evidence: GeoEvidenceDto | null,
): GeoEvaluationDto | null {
  const record = recordValue(value);
  if (record === null) return null;
  const status = record.status;
  if (status !== 'Completed' && status !== 'Unavailable') {
    return unreadableEvaluation('StoredEvaluationInvalid');
  }
  const provider = typeof record.provider === 'string' ? record.provider : null;
  const modelId = typeof record.modelId === 'string' ? record.modelId : null;
  if (status === 'Unavailable') {
    return {
      status,
      reason: typeof record.reason === 'string' ? record.reason : null,
      overall: null,
      answerDescribesSubject: null,
      claims: [],
      provider,
      modelId,
    };
  }
  if (
    typeof record.answerDescribesSubject !== 'boolean' ||
    typeof record.overall !== 'string' ||
    !(GEO_EVALUATION_VERDICTS as readonly string[]).includes(record.overall) ||
    !Array.isArray(record.claims)
  ) {
    return unreadableEvaluation('StoredEvaluationInvalid');
  }
  const claims: GeoEvaluatedClaimDto[] = [];
  for (const entry of record.claims) {
    const claim = claimFrom(entry, answer, evidence);
    if (claim === null) return unreadableEvaluation('StoredEvaluationInvalid');
    claims.push(claim);
  }
  if (!record.answerDescribesSubject && claims.length > 0) {
    return unreadableEvaluation('StoredEvaluationInvalid');
  }
  return {
    status,
    reason: null,
    overall: deriveGeoVerdict(record.answerDescribesSubject, claims),
    answerDescribesSubject: record.answerDescribesSubject,
    claims,
    provider,
    modelId,
  };
}

/**
 * One stored claim, or null when it cannot be trusted.
 *
 * The quote checks are re-run against the answer and the evidence this report
 * actually shows: a claim whose quote is nowhere in the answer beside it is not
 * something a reader can verify, whatever produced it.
 */
function claimFrom(
  value: unknown,
  answer: string,
  evidence: GeoEvidenceDto | null,
): GeoEvaluatedClaimDto | null {
  const record = recordValue(value);
  const verdict = record?.verdict;
  if (
    record === null ||
    typeof record.claim !== 'string' ||
    record.claim.trim() === '' ||
    typeof record.answerQuote !== 'string' ||
    typeof verdict !== 'string' ||
    !(GEO_CLAIM_VERDICTS as readonly string[]).includes(verdict) ||
    !quoteOccursIn(answer, record.answerQuote)
  ) {
    return null;
  }
  const claimVerdict = verdict as GeoClaimVerdict;
  const sourceId = typeof record.sourceId === 'string' ? record.sourceId : null;
  const sourceQuote = typeof record.sourceQuote === 'string' ? record.sourceQuote : null;
  if (claimVerdict === 'unverified') {
    return sourceId === null && sourceQuote === null
      ? {
          claim: record.claim,
          verdict: claimVerdict,
          answerQuote: record.answerQuote,
          sourceId,
          sourceQuote,
        }
      : null;
  }
  if (sourceId === null || sourceQuote === null) return null;
  // A matched or contradicted claim rests entirely on the source it cites, so
  // the citation is re-checked against the evidence this report actually shows.
  // A record whose evidence snapshot is gone fails the same way a wrong quote
  // does: the cited source cannot be produced, so the claim is not something a
  // reader can verify, and "we no longer have the evidence" must not be shown
  // as "supported by your site's evidence". A scan written before evaluations
  // existed has no `evaluation` key at all and never reaches this function.
  const source = evidence?.sources.find((entry) => entry.id === sourceId) ?? null;
  if (source === null || !quoteOccursIn(source.excerpt, sourceQuote)) return null;
  return {
    claim: record.claim,
    verdict: claimVerdict,
    answerQuote: record.answerQuote,
    sourceId,
    sourceQuote,
  };
}

/** What the answers were judged against; null for a scan that recorded none. */
export function geoEvidenceFrom(metadataJson: string | undefined): GeoEvidenceDto | null {
  if (metadataJson === undefined) return null;
  const visibility = recordValue(recordValue(parseMetadata(metadataJson))?.providerVisibility);
  const evidence = recordValue(visibility?.evidence);
  if (evidence === null || typeof evidence.sufficiency !== 'string') return null;
  const sources = evidence.sources;
  return {
    sufficiency: evidence.sufficiency,
    limits: Array.isArray(evidence.limits)
      ? evidence.limits.filter((limit): limit is string => typeof limit === 'string')
      : [],
    sources: Array.isArray(sources) ? sources.flatMap(evidenceSourceFrom) : [],
  };
}

function evidenceSourceFrom(value: unknown): GeoEvidenceSourceDto[] {
  const record = recordValue(value);
  if (
    record === null ||
    typeof record.id !== 'string' ||
    typeof record.kind !== 'string' ||
    typeof record.excerpt !== 'string'
  ) {
    return [];
  }
  return [
    {
      id: record.id,
      kind: record.kind,
      label: typeof record.label === 'string' ? record.label : record.id,
      url: typeof record.url === 'string' ? record.url : null,
      excerpt: record.excerpt,
      provenance: typeof record.provenance === 'string' ? record.provenance : '',
    },
  ];
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mentionsFrom(value: unknown): GeoMentions | null {
  const mentions = recordValue(value);
  const brand = mentionSignal(mentions?.brand);
  const domain = mentionSignal(mentions?.domain);
  return brand === null || domain === null ? null : { brand, domain };
}

/**
 * A stored signal, or null when the record predates the field.
 *
 * Reports written before this release stored `true`/`false`, which meant
 * "no finding for this answer" and not "the model knew this". They are read as
 * unmeasurable rather than rewritten into a verdict they never carried.
 */
function mentionSignal(value: unknown): MentionSignal | null {
  if (typeof value === 'string' && (MENTION_SIGNALS as readonly string[]).includes(value)) {
    return value as MentionSignal;
  }
  return typeof value === 'boolean' ? 'named-in-question' : null;
}

function stringArrayFromJson(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}
