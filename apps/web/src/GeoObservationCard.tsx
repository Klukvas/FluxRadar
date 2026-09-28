// The GEO answer card: one model's answer to one of this scan's prompts, with
// the badges it earned, the evaluation that judged it and the sources it cited.
//
// Split out of `ModuleChecks.tsx` — which renders every module's checks and had
// grown past the size one file should reach — as a pure move. Nothing here is
// specific to the checks panel: the card reads one `GeoObservation` and the
// report copy, and nothing else.

import type { GeoEvidence, GeoObservation, MentionSignal } from './api';
import { GeoEvaluationBlock, safeHttpUrl } from './GeoEvaluation';
import { copy, type Language } from './i18n';

/**
 * Prompt-level GEO evidence, not a claim about a model's memory or training.
 *
 * The answer and citation strings are provider output. React escapes their
 * text, and only validated HTTP(S) citations become navigable links.
 */
/**
 * Whether a visibility badge reads as a measurement or as "not measured".
 *
 * Both used to be a plain yes, and both were yes on every scan: the question
 * named the brand and spelled out the domain, so the answer repeating them
 * proved nothing. A signal we could not measure now says so rather than
 * borrowing the colour of one we could.
 */
function signalClass(signal: MentionSignal): string {
  return signal === 'mentioned' || signal === 'not-mentioned'
    ? 'geo-observation__signal'
    : 'geo-observation__signal geo-observation__signal--unmeasured';
}

function brandSignalLabel(signal: MentionSignal, language: Language): string {
  const t = copy[language].report;
  switch (signal) {
    case 'mentioned':
      return t.geoBrandMentioned;
    case 'not-mentioned':
      return t.geoBrandNotMentioned;
    case 'brand-is-hostname':
      return t.geoBrandIsHostname;
    default:
      return t.geoBrandNamedInQuestion;
  }
}

function domainSignalLabel(signal: MentionSignal, language: Language): string {
  const t = copy[language].report;
  switch (signal) {
    case 'mentioned':
      return t.geoDomainMentioned;
    case 'not-mentioned':
      return t.geoDomainNotMentioned;
    default:
      return t.geoDomainNamedInQuestion;
  }
}

/**
 * How the question was put, in the reader's words.
 *
 * `awareness` belongs to scans that ran before the direct questions became
 * closed-book. Those questions named the brand and spelled out the domain, and
 * calling them closed-book now would claim a check that never ran.
 */
function purposeLabel(observation: GeoObservation, language: Language): string {
  const t = copy[language].report;
  switch (observation.purpose) {
    case 'discovery':
      return t.geoDiscoveryQuestion;
    case 'closed-book':
      return t.geoClosedBookQuestion;
    default:
      return t.geoAwarenessQuestion;
  }
}

export function GeoObservationCard(props: {
  observation: GeoObservation;
  evidence: GeoEvidence | null;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { observation } = props;
  const citations = [
    ...new Map(
      observation.citations.flatMap((citation) => {
        const href = safeHttpUrl(citation);
        return href === null ? [] : [[href, { label: citation, href }] as const];
      }),
    ).values(),
  ];
  return (
    <article className="geo-observation">
      <div className="split geo-observation__header">
        <strong>{purposeLabel(observation, props.language)}</strong>
        {observation.provider === null || observation.modelId === null ? null : (
          <small className="technical">
            {t.geoProvider}: {observation.provider} · {observation.modelId}
          </small>
        )}
      </div>
      <p className="geo-observation__question">{observation.question}</p>
      {observation.status === 'answered' && observation.answer !== null ? (
        <>
          <div className="geo-observation__answer">
            <strong>{t.geoAnswerLabel}</strong>
            <p>{observation.answer}</p>
          </div>
          {/* A closed-book question names the business in the prompt itself, so
              a brand mention in the answer measures nothing. Per the UI plan the
              badge pair is replaced there by the claim evaluation, which says
              what the answer actually asserted about the business. A discovery
              question keeps its signals: there, a mention is a real
              measurement. */}
          {observation.mentions === null || observation.purpose === 'closed-book' ? null : (
            <div className="geo-observation__mentions" aria-label={t.geoMentionSignals}>
              <span className={signalClass(observation.mentions.brand)}>
                {brandSignalLabel(observation.mentions.brand, props.language)}
              </span>
              <span className={signalClass(observation.mentions.domain)}>
                {domainSignalLabel(observation.mentions.domain, props.language)}
              </span>
            </div>
          )}
          {/* A historical awareness row never had an evaluation and is not
              given an empty slot for one; it keeps the badges it was written
              with. */}
          {observation.purpose === 'awareness' && !observation.evaluation ? null : (
            <GeoEvaluationBlock
              evaluation={observation.evaluation ?? null}
              evidence={props.evidence}
              purpose={observation.purpose}
              language={props.language}
            />
          )}
          {!observation.mentionContext ? null : (
            <p className="geo-observation__mention-context">
              <strong>{t.geoMentionContextLabel}:</strong> “{observation.mentionContext}”
            </p>
          )}
          {citations.length === 0 ? null : (
            <div className="geo-observation__citations">
              <strong>{t.geoCitations}</strong>
              <ul>
                {citations.map((citation) => (
                  <li key={citation.href}>
                    <a href={citation.href} target="_blank" rel="noreferrer">
                      {citation.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="muted geo-observation__unavailable">{t.geoUnavailable}</p>
      )}
    </article>
  );
}
