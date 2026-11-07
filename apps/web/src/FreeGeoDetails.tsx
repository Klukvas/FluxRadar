// The Free AI block's "Show details" disclosure (D-237): for each statement,
// the words it came from in the answer and what it was compared with, then
// what the check does and does not cover. Closed by default — the block above
// it already says the verdict; this is for the reader who wants the proof.
//
// Plain React text only: quotes are provider output and site text.

import type { GeoClaimVerdict, GeoEvaluatedClaim, GeoEvidence, GeoEvidenceSource } from './api';
import { aiTextLang, evidenceLabel } from './free-geo-claims';
import { freePreviewCopy } from './free-preview-copy';
import { safeHttpUrl, sourceOriginLabel } from './GeoEvaluation';
import { copy, type Language } from './i18n';

/** The paid block's chip classes: same look, and the word inside carries the fact. */
export const STATUS_CHIP_CLASS: Readonly<Record<GeoClaimVerdict, string>> = {
  matched: 'geo-claim__verdict geo-claim__verdict--matched',
  contradicted: 'geo-claim__verdict geo-claim__verdict--contradicted',
  unverified: 'geo-claim__verdict geo-claim__verdict--unverified',
};

function Provenance(props: { source: GeoEvidenceSource | null; language: Language }) {
  const { source, language } = props;
  if (source === null) {
    // The cited snapshot is not stored with this report: say so, never guess.
    return (
      <span className="free-geo-detail__origin">{copy[language].report.geoSourceMissing}</span>
    );
  }
  const href = source.url === null ? null : safeHttpUrl(source.url);
  return (
    <span className="free-geo-detail__origin">
      {sourceOriginLabel(source.kind, language)} ·{' '}
      {evidenceLabel(source.kind, source.label, language)}
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

function ClaimDetail(props: {
  claim: GeoEvaluatedClaim;
  evidence: GeoEvidence | null;
  language: Language;
  answerLanguage: Language | null;
}) {
  const t = freePreviewCopy[props.language].preview;
  const { claim } = props;
  const source =
    claim.sourceId === null
      ? null
      : (props.evidence?.sources.find((entry) => entry.id === claim.sourceId) ?? null);
  return (
    <li className="free-geo-detail">
      <p className="free-geo-detail__claim">
        <span className={STATUS_CHIP_CLASS[claim.verdict]}>{t.claimStatus[claim.verdict]}</span>{' '}
        <span {...aiTextLang(props.answerLanguage)}>{claim.claim}</span>
      </p>
      <p className="free-geo-detail__line">
        <strong>{t.detailsAnswerQuote}:</strong>{' '}
        <span {...aiTextLang(props.answerLanguage)}>“{claim.answerQuote}”</span>
      </p>
      {claim.sourceQuote === null ? (
        claim.verdict === 'unverified' ? (
          <p className="free-geo-detail__line">{t.detailsNoEvidence}</p>
        ) : null
      ) : (
        <p className="free-geo-detail__line">
          {/* The site's or profile's own words, not the model's: their language
              is the site's, which the owner may not have asked in, so it is
              not marked with the answer's language. */}
          <strong>{t.detailsComparedWith}:</strong> “{claim.sourceQuote}”{' '}
          <Provenance source={source} language={props.language} />
        </p>
      )}
    </li>
  );
}

export function FreeGeoDetails(props: {
  claims: readonly GeoEvaluatedClaim[];
  evidence: GeoEvidence | null;
  language: Language;
  answerLanguage: Language | null;
}) {
  const t = freePreviewCopy[props.language].preview;
  return (
    <details className="free-geo-answer__details free-geo-answer__details--more">
      <summary className="free-geo-answer__summary">{t.showDetails}</summary>
      <div className="free-geo-answer__body">
        <ol className="free-geo-details">
          {props.claims.map((claim, index) => (
            <ClaimDetail
              key={`${claim.verdict}:${index}:${claim.answerQuote}`}
              claim={claim}
              evidence={props.evidence}
              language={props.language}
              answerLanguage={props.answerLanguage}
            />
          ))}
        </ol>
        <p className="free-geo-detail__scope">{t.detailsScope}</p>
      </div>
    </details>
  );
}
