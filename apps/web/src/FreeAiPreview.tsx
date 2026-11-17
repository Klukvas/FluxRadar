// The Free AI block shows saved answers or the actual reason no answer is available.

import type { GeoEvidence, GeoObservation, ScanModule } from './api';
import { FreeAiAddAnswer } from './FreeAiAddAnswer';
import { freePreviewCopy } from './free-preview-copy';
import { aiAnswerLanguage, hasFreeAiAnswer } from './free-geo-claims';
import { FreeGeoAnswer } from './FreeGeoAnswer';
import type { Language } from './i18n';
import {
  lateAttemptOf,
  leftOutAtLaunch,
  useLateFreeAnswer,
  type LateFreeAnswer,
} from './use-late-free-answer';

import './styles/free-ai-preview.css';

export { ADD_ANSWER_MAX_POLLS, ADD_ANSWER_POLL_MS } from './use-late-free-answer';

const GEO_MODULE = 'AI SEO / GEO';

/** The one answer the preview produced, or null when it asked nothing usable. */
function previewAnswer(observations: readonly GeoObservation[]): GeoObservation | null {
  return observations.find(hasFreeAiAnswer) ?? null;
}

function NotRunNote(props: { module: ScanModule; language: Language }) {
  const t = freePreviewCopy[props.language].preview;
  const text =
    props.module.statusReason === 'ConsentMissing'
      ? t.notRunConsent
      : props.module.statusReason === 'FreePreviewAllowlistedOrigin'
        ? t.notRunAllowlisted
        : props.module.statusReason === 'FreePreviewAlreadyRequested'
          ? t.notRunAlreadyRequested
          : ['Pending', 'Queued', 'Running'].includes(props.module.status)
            ? t.pending
            : t.notRunOther;
  return (
    <p className="muted free-ai-preview__not-run" role="note">
      {text}
    </p>
  );
}

/** The block's body when no answer is stored yet. */
function NoAnswer(props: {
  module: ScanModule;
  language: Language;
  late: LateFreeAnswer;
  /** Present only where the report can add the answer (its scan is known). */
  scanId?: string;
  onRefresh?: () => Promise<unknown>;
}) {
  const c = freePreviewCopy[props.language].addAnswer;
  if (props.late.adding) {
    return (
      <p className="muted free-ai-preview__not-run" role="status">
        {props.late.timedOut ? c.slow : c.running}
      </p>
    );
  }
  if (lateAttemptOf(props.module)?.final === true) {
    return (
      <p className="muted free-ai-preview__not-run" role="note">
        {c.attemptsExhausted}
      </p>
    );
  }
  return (
    <>
      <NotRunNote module={props.module} language={props.language} />
      {props.scanId !== undefined && leftOutAtLaunch(props.module) ? (
        <FreeAiAddAnswer
          scanId={props.scanId}
          module={props.module}
          language={props.language}
          onRequested={props.late.onRequested}
          {...(props.onRefresh !== undefined ? { onRefresh: props.onRefresh } : {})}
        />
      ) : null}
    </>
  );
}

export function FreeAiPreview(props: {
  modules: readonly ScanModule[];
  observations: readonly GeoObservation[];
  evidence: GeoEvidence | null;
  language: Language;
  /** The scan, when this report may add an answer its owner left out at launch. */
  scanId?: string;
  /** Re-reads the report in place, for the running state to see the answer land. */
  onRefresh?: () => Promise<unknown>;
}) {
  const geoModule = props.modules.find((module) => module.module === GEO_MODULE);
  const answer = previewAnswer(props.observations);
  const late = useLateFreeAnswer(geoModule, answer !== null, props.onRefresh);
  // A Free report from before the preview existed has no GEO row; it gets no
  // AI block rather than one promising an answer that was never asked.
  if (geoModule === undefined) return null;
  return (
    <section className="report-block free-ai-preview" aria-labelledby="free-ai-preview-heading">
      <h3 id="free-ai-preview-heading">{freePreviewCopy[props.language].preview.heading}</h3>
      {answer === null ? (
        <NoAnswer
          module={geoModule}
          language={props.language}
          late={late}
          {...(props.scanId !== undefined ? { scanId: props.scanId } : {})}
          {...(props.onRefresh !== undefined ? { onRefresh: props.onRefresh } : {})}
        />
      ) : (
        <FreeGeoAnswer
          observation={answer}
          evidence={props.evidence}
          language={props.language}
          answerLanguage={aiAnswerLanguage(geoModule)}
        />
      )}
    </section>
  );
}
