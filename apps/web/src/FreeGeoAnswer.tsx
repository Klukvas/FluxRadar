// The Free report's one GEO answer, verdict first (D-236, D-237).
//
// Read top to bottom in five seconds: one lead sentence saying what was done,
// one headline saying what came of it, a count row, and one line per statement
// with contradictions first. Quotes, evidence, provenance and the scope note
// sit behind one closed "Show details"; the model's own words behind another.
//
// The paid card (GeoObservationCard) leads with the question, the provider and
// model, and the answer in full. On a Free report the owner wants the reader to
// see what the check concluded — the verdict and the claims behind it — and to
// open the model's own words only if they want them. The question text and the
// provider/model line are not shown here at all, and neither are the mention
// badges: on a closed-book question they measure nothing.
//
// Built from the shared pieces rather than by forking the paid card, so the paid
// report renders exactly as before. Everything is plain React text: the answer
// and citations are provider output, and only validated HTTP(S) addresses
// become links.

import type { GeoEvaluation, GeoEvidence, GeoObservation } from './api';
import { aiTextLang, freeGeoHeadline } from './free-geo-claims';
import { FreeGeoClaims } from './FreeGeoClaims';
import { freePreviewCopy } from './free-preview-copy';
import { geoEvaluationNote, safeHttpUrl } from './GeoEvaluation';
import type { Language } from './i18n';

/** The evidence label the API gives the owner's saved brand (packages/ai geo-evidence). */
const BRAND_SOURCE_LABEL = 'Brand name';

/**
 * The brand the owner saved, from this scan's evidence — or null.
 *
 * The API leaves the brand out of the evidence when it is only the hostname,
 * so a brand found here is one a person actually typed.
 */
function savedBrand(evidence: GeoEvidence | null): string | null {
  const source = evidence?.sources.find(
    (entry) => entry.kind === 'profile' && entry.label === BRAND_SOURCE_LABEL,
  );
  const brand = source?.excerpt.trim() ?? '';
  return brand === '' ? null : brand;
}

/**
 * Whether the answer starts open: when there is no verdict and no claim to
 * show, the answer is the only content, and a closed disclosure would leave
 * the block saying nothing.
 */
function answerOpensByDefault(evaluation: GeoEvaluation | null): boolean {
  return (
    evaluation === null || evaluation.status === 'Unavailable' || evaluation.claims.length === 0
  );
}

function CitedSources(props: {
  citations: readonly string[];
  language: Language;
  answerLanguage: Language | null;
}) {
  const t = freePreviewCopy[props.language].preview;
  const citations = [
    ...new Map(
      props.citations.flatMap((citation) => {
        const href = safeHttpUrl(citation);
        return href === null ? [] : [[href, { label: citation, href }] as const];
      }),
    ).values(),
  ];
  if (citations.length === 0) return null;
  return (
    <div className="free-geo-answer__citations">
      <strong>{t.answerCitations}</strong>
      <ul {...aiTextLang(props.answerLanguage)}>
        {citations.map((citation) => (
          <li key={citation.href}>
            <a href={citation.href} target="_blank" rel="noreferrer">
              {citation.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The verdict body: the claims, or the sentence saying why there are none. */
function Verdict(props: {
  observation: GeoObservation;
  evidence: GeoEvidence | null;
  language: Language;
  answerLanguage: Language | null;
}) {
  const t = freePreviewCopy[props.language].preview;
  const evaluation = props.observation.evaluation ?? null;
  const note = geoEvaluationNote(
    evaluation,
    props.observation.purpose,
    props.language,
    t.evaluationUnavailable,
  );
  if (evaluation === null || note !== null) {
    return <p className="muted geo-evaluation__note free-geo-answer__note">{note}</p>;
  }
  return (
    <FreeGeoClaims
      claims={evaluation.claims}
      evidence={props.evidence}
      language={props.language}
      answerLanguage={props.answerLanguage}
    />
  );
}

export function FreeGeoAnswer(props: {
  /** An answered observation: the caller passes only one with an answer. */
  observation: GeoObservation;
  evidence: GeoEvidence | null;
  language: Language;
  /**
   * The language the question was asked in (GEO row metadata), or null when
   * the row does not say. Its model-written text is marked with it.
   */
  answerLanguage: Language | null;
}) {
  const t = freePreviewCopy[props.language].preview;
  const { observation, answerLanguage } = props;
  // Said only when it differs from the reader's language; never the question.
  const askedIn =
    answerLanguage === null || answerLanguage === props.language
      ? ''
      : ` ${t.askedIn(answerLanguage)}`;
  const evaluation = observation.evaluation ?? null;
  const opensByDefault = answerOpensByDefault(evaluation);
  return (
    <div className="free-geo-answer">
      <p className="muted free-geo-answer__lead">
        {t.answerLead(savedBrand(props.evidence))}
        {askedIn}
      </p>
      <p className="free-geo-answer__headline">{t.headline[freeGeoHeadline(evaluation)]}</p>
      <Verdict
        observation={observation}
        evidence={props.evidence}
        language={props.language}
        answerLanguage={answerLanguage}
      />
      <details className="free-geo-answer__details" open={opensByDefault}>
        <summary className="free-geo-answer__summary">
          {opensByDefault ? t.answerHeading : t.showAnswer}
        </summary>
        <div className="free-geo-answer__body">
          <p className="free-geo-answer__text" {...aiTextLang(answerLanguage)}>
            {observation.answer}
          </p>
          <CitedSources
            citations={observation.citations}
            language={props.language}
            answerLanguage={answerLanguage}
          />
        </div>
      </details>
    </div>
  );
}
