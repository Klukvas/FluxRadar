// The Free AI block shows saved answers or the actual reason no answer is available.

import type { GeoEvidence, GeoObservation, ScanModule } from './api';
import { freePreviewCopy } from './free-preview-copy';
import { aiAnswerLanguage, hasFreeAiAnswer } from './free-geo-claims';
import { FreeGeoAnswer } from './FreeGeoAnswer';
import type { Language } from './i18n';

import './styles/free-ai-preview.css';

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

export function FreeAiPreview(props: {
  modules: readonly ScanModule[];
  observations: readonly GeoObservation[];
  evidence: GeoEvidence | null;
  language: Language;
}) {
  const t = freePreviewCopy[props.language].preview;
  const geoModule = props.modules.find((module) => module.module === GEO_MODULE);
  // A Free report from before the preview existed has no GEO row; it gets no
  // AI block rather than one promising an answer that was never asked.
  if (geoModule === undefined) return null;
  const answer = previewAnswer(props.observations);
  return (
    <section className="report-block free-ai-preview" aria-labelledby="free-ai-preview-heading">
      <h3 id="free-ai-preview-heading">{t.heading}</h3>
      {answer === null ? (
        <NotRunNote module={geoModule} language={props.language} />
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
