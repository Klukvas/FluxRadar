// The Free AI block's verdict body (D-237): a count row, then one line per
// statement — status chip and the statement, nothing else — contradictions
// first, then the closed "Show details" disclosure with everything secondary.

import { useState } from 'react';

import type { GeoEvaluatedClaim, GeoEvidence } from './api';
import { CLAIM_ORDER, aiTextLang, claimCounts, orderedClaims } from './free-geo-claims';
import { FreeGeoDetails, STATUS_CHIP_CLASS } from './FreeGeoDetails';
import { freePreviewCopy } from './free-preview-copy';
import type { Language } from './i18n';
import type { AiLanguage } from './site-language';

/** Up to this many statements are listed in full; a longer list shows the first few. */
const FULL_LIST_LIMIT = 6;
const SHORT_LIST_LENGTH = 5;

function CountRow(props: { claims: readonly GeoEvaluatedClaim[]; language: Language }) {
  const t = freePreviewCopy[props.language].preview;
  const counts = claimCounts(props.claims);
  // Only states that occur: "Contradicts 0" is a chip to read past, not a fact.
  const shown = CLAIM_ORDER.filter((verdict) => counts[verdict] > 0);
  return (
    <ul className="free-geo-counts" aria-label={t.countsLabel}>
      {shown.map((verdict) => (
        <li key={verdict} className={STATUS_CHIP_CLASS[verdict]}>
          {t.claimStatus[verdict]} <strong className="free-geo-counts__n">{counts[verdict]}</strong>
        </li>
      ))}
    </ul>
  );
}

function ClaimList(props: {
  claims: readonly GeoEvaluatedClaim[];
  language: Language;
  answerLanguage: AiLanguage | null;
}) {
  const t = freePreviewCopy[props.language].preview;
  const [isExpanded, setIsExpanded] = useState(false);
  const isCapped = props.claims.length > FULL_LIST_LIMIT;
  const visible = isCapped && !isExpanded ? props.claims.slice(0, SHORT_LIST_LENGTH) : props.claims;
  return (
    <>
      <ul className="free-geo-claims" aria-label={t.claimsLabel}>
        {visible.map((claim, index) => (
          <li className="free-geo-claims__item" key={`${claim.verdict}:${index}:${claim.claim}`}>
            <span className={STATUS_CHIP_CLASS[claim.verdict]}>{t.claimStatus[claim.verdict]}</span>
            <span className="free-geo-claims__text" {...aiTextLang(props.answerLanguage)}>
              {claim.claim}
            </span>
          </li>
        ))}
      </ul>
      {isCapped ? (
        <button
          type="button"
          className="free-geo-claims__toggle"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded
            ? t.showFewerClaims
            : t.showMoreClaims(props.claims.length - SHORT_LIST_LENGTH)}
        </button>
      ) : null}
    </>
  );
}

export function FreeGeoClaims(props: {
  /** A completed evaluation's claims; the caller passes at least one. */
  claims: readonly GeoEvaluatedClaim[];
  evidence: GeoEvidence | null;
  language: Language;
  /** The language the model wrote in (GEO row metadata), or null when unknown. */
  answerLanguage: AiLanguage | null;
}) {
  const claims = orderedClaims(props.claims);
  return (
    <>
      <CountRow claims={claims} language={props.language} />
      <ClaimList claims={claims} language={props.language} answerLanguage={props.answerLanguage} />
      <FreeGeoDetails
        claims={claims}
        evidence={props.evidence}
        language={props.language}
        answerLanguage={props.answerLanguage}
      />
    </>
  );
}
