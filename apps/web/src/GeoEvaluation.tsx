// What a separate evaluator made of one AI answer, against this scan's evidence.
//
// A closed-book question used to end in two badges that both said "not
// measured": the question named the brand and, for a profile called after its
// own hostname, the domain too, so neither signal could mean anything. What the
// reader actually wants to know is simpler and was not being answered — does
// the model know this business, and is what it said about it true? That is what
// this block shows: the verdict, the statements behind it, the quote from the
// answer, and the site evidence each supported statement rests on.
//
// Every state is distinct and named. "No description" is the model saying it
// has nothing; "unverified" is evidence that neither supports nor contradicts;
// "insufficient" is this scan having read too little of the site; "unavailable"
// is the evaluator not running. None of them is a pass, and none is a failure
// of the site.

import type {
  GeoClaimVerdict,
  GeoEvaluatedClaim,
  GeoEvaluation,
  GeoEvaluationVerdict,
  GeoEvidence,
  GeoEvidenceSource,
  GeoObservationPurpose,
} from './api';
import { copy, fillCopy, type Language } from './i18n';

/** Only a real web address becomes a link; anything else is shown as text. */
export function safeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The colour class for a verdict; the word beside it always carries the same fact. */
const CLAIM_CLASS: Readonly<Record<GeoClaimVerdict, string>> = {
  matched: 'geo-claim__verdict geo-claim__verdict--matched',
  contradicted: 'geo-claim__verdict geo-claim__verdict--contradicted',
  unverified: 'geo-claim__verdict geo-claim__verdict--unverified',
};

function claimVerdictLabel(verdict: GeoClaimVerdict, language: Language): string {
  const t = copy[language].report;
  if (verdict === 'matched') return t.geoClaimMatched;
  return verdict === 'contradicted' ? t.geoClaimContradicted : t.geoClaimUnverified;
}

/**
 * The verdict the claims on screen actually support.
 *
 * The API derives this too, and this is deliberately the same rule twice: the
 * badge is the loudest thing in the block, and it must never say more than the
 * list printed underneath it — not for a record written by an older release,
 * not during a deploy where the two sides disagree. With no claims there is
 * nothing to re-derive from, so the stored verdict stands.
 */
function shownVerdict(evaluation: GeoEvaluation): GeoEvaluationVerdict | null {
  const { claims } = evaluation;
  if (claims.length === 0) return evaluation.overall;
  if (claims.some((claim) => claim.verdict === 'contradicted')) return 'contradicts-evidence';
  const matched = claims.filter((claim) => claim.verdict === 'matched').length;
  if (matched === 0) return 'unverified';
  return matched === claims.length ? 'matches-evidence' : 'partially-supported';
}

function verdictLabel(
  overall: GeoEvaluationVerdict | null,
  purpose: GeoObservationPurpose,
  language: Language,
): string {
  const t = copy[language].report;
  switch (overall) {
    case 'no-description':
      return purpose === 'discovery' ? t.geoVerdictNotMentioned : t.geoVerdictNoDescription;
    case 'matches-evidence':
      return t.geoVerdictMatches;
    case 'partially-supported':
      return t.geoVerdictPartial;
    case 'contradicts-evidence':
      return t.geoVerdictContradicts;
    case 'unverified':
      return t.geoVerdictUnverified;
    default:
      // A completed evaluation always carries a verdict; a stored record that
      // somehow does not is reported as unverified, never as a match.
      return t.geoVerdictUnverified;
  }
}

function verdictClass(overall: GeoEvaluationVerdict | null): string {
  switch (overall) {
    case 'matches-evidence':
      return 'geo-evaluation__verdict geo-evaluation__verdict--matched';
    case 'contradicts-evidence':
      return 'geo-evaluation__verdict geo-evaluation__verdict--contradicted';
    case 'partially-supported':
      return 'geo-evaluation__verdict geo-evaluation__verdict--partial';
    default:
      return 'geo-evaluation__verdict geo-evaluation__verdict--neutral';
  }
}

/**
 * What an answer that described nothing means — which depends on what was asked.
 *
 * A discovery question asks for providers. An answer that names only other
 * companies has not "admitted it knows nothing about this business"; it simply
 * did not bring this one up, and saying more than that would invent a statement
 * the model never made. A direct question is the one place the answer is *about*
 * this business, and even there the honest reading is that the answer carried no
 * description to check — not that the model has no knowledge.
 */
function noClaimsNote(purpose: GeoObservationPurpose, language: Language): string {
  const t = copy[language].report;
  return purpose === 'discovery' ? t.geoEvaluationNotMentioned : t.geoEvaluationNoClaims;
}

/** Why there is no verdict — the site's evidence, or the evaluator itself. */
function unavailableNote(evaluation: GeoEvaluation, language: Language): string {
  const t = copy[language].report;
  if (evaluation.reason === 'InsufficientEvidence') return t.geoEvaluationInsufficient;
  if (evaluation.reason === 'EvidenceTruncated') return t.geoEvaluationTruncated;
  return t.geoEvaluationUnavailable;
}

/**
 * Where a cited excerpt came from, in the reader's language.
 *
 * "Brand name" beside a quote reads like a fact about the website. It is not:
 * it is a field the owner typed, and an evaluator confirming an answer from it
 * has confirmed the owner's own claim. A page excerpt and author-declared
 * JSON-LD are two further grades of the same thing, and the reader is told
 * which one a verdict rests on.
 */
function sourceOriginLabel(kind: string, language: Language): string {
  const t = copy[language].report;
  if (kind === 'profile') return t.geoSourceProfile;
  if (kind === 'structured-data') return t.geoSourceStructuredData;
  if (kind === 'page') return t.geoSourcePage;
  return t.geoSourceUnknown;
}

function SourceOrigin(props: { source: GeoEvidenceSource; language: Language }) {
  const { source } = props;
  const href = source.url === null ? null : safeHttpUrl(source.url);
  return (
    <span className="geo-claim__origin technical">
      {sourceOriginLabel(source.kind, props.language)} · {source.label}
      {href === null ? null : (
        <>
          {' · '}
          <a href={href} target="_blank" rel="noreferrer">
            {href}
          </a>
        </>
      )}
    </span>
  );
}

function ClaimRow(props: {
  claim: GeoEvaluatedClaim;
  evidence: GeoEvidence | null;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { claim } = props;
  const source =
    claim.sourceId === null
      ? null
      : (props.evidence?.sources.find((entry) => entry.id === claim.sourceId) ?? null);
  return (
    <li className="geo-claim">
      <div className="geo-claim__head">
        <span className={CLAIM_CLASS[claim.verdict]}>
          {claimVerdictLabel(claim.verdict, props.language)}
        </span>
        <span className="geo-claim__text">{claim.claim}</span>
      </div>
      <p className="geo-claim__quote">
        <strong>{t.geoClaimAnswerQuote}:</strong> “{claim.answerQuote}”
      </p>
      {claim.sourceQuote === null ? null : (
        <p className="geo-claim__source">
          <strong>{t.geoClaimSource}:</strong> “{claim.sourceQuote}”
          {source === null ? (
            // The snapshot this claim cites is not in the report — an older
            // record, or one stored without its evidence. The quote stays, the
            // provenance cannot be shown, and the reader is told so.
            <span className="geo-claim__origin technical"> · {t.geoSourceMissing}</span>
          ) : (
            <>
              {' '}
              <SourceOrigin source={source} language={props.language} />
            </>
          )}
        </p>
      )}
    </li>
  );
}

export function GeoEvaluationBlock(props: {
  evaluation: GeoEvaluation | null;
  evidence: GeoEvidence | null;
  purpose: GeoObservationPurpose;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { evaluation } = props;
  if (evaluation === null) {
    // No verdict was recorded for this answer: the scan may predate evaluations,
    // or no judge may have run for it in this one. Nothing here can tell those
    // apart, so the note asserts neither cause — and an absent check must never
    // be drawn as one that passed.
    return <p className="muted geo-evaluation__note">{t.geoEvaluationNotRun}</p>;
  }
  if (evaluation.status === 'Unavailable') {
    return (
      <p className="muted geo-evaluation__note">{unavailableNote(evaluation, props.language)}</p>
    );
  }
  const overall = shownVerdict(evaluation);
  return (
    <div className="geo-evaluation" aria-label={t.geoEvaluationHeading}>
      <div className="geo-evaluation__head">
        <strong>{t.geoEvaluationHeading}</strong>
        <span className={verdictClass(overall)}>
          {verdictLabel(overall, props.purpose, props.language)}
        </span>
      </div>
      {evaluation.claims.length === 0 ? (
        <p className="muted geo-evaluation__note">
          {evaluation.answerDescribesSubject === false
            ? noClaimsNote(props.purpose, props.language)
            : t.geoEvaluationNothingCheckable}
        </p>
      ) : (
        <>
          <ul className="geo-evaluation__claims">
            {evaluation.claims.map((claim, index) => (
              <ClaimRow
                key={`${claim.verdict}:${index}:${claim.answerQuote}`}
                claim={claim}
                evidence={props.evidence}
                language={props.language}
              />
            ))}
          </ul>
          {/* The verdict above is about these claims and this scan's evidence.
              Without this line, "supported" reads as a certificate for the
              whole answer — including everything the evaluator did not list. */}
          <p className="muted geo-evaluation__scope">{t.geoEvaluationScope}</p>
        </>
      )}
    </div>
  );
}

/** How many answers actually got a verdict — completed ones only, never assumed. */
export function geoEvaluationSummary(
  evaluations: readonly (GeoEvaluation | null)[],
  language: Language,
): string | null {
  if (evaluations.length === 0) return null;
  const completed = evaluations.filter(
    (evaluation) => evaluation !== null && evaluation.status === 'Completed',
  ).length;
  return fillCopy(copy[language].report.geoEvaluationSummary, {
    count: completed,
    total: evaluations.length,
  });
}
