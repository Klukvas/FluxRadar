// The Free report's AI block (D-236): the one real GEO answer the free check
// asked for, then what the complete verification adds, drawn as locked cards.
//
// The locked cards are DECOYS. They are built here, from static labels and
// grey bars, and they never receive a byte of scan data: the API sends a Free
// client nothing beyond its own one answer, and a blur over real paid results
// would hand them to anyone who opens the developer tools. They are hidden from
// assistive technology and hold nothing focusable; what they stand for is said
// in words above them, and the one control is a real button with real text.

import type { GeoEvidence, GeoObservation, ScanModule } from './api';
import { Button } from './components';
import { freePreviewCopy } from './free-preview-copy';
import { aiAnswerLanguage } from './free-geo-claims';
import { FreeGeoAnswer } from './FreeGeoAnswer';
import { trackUpgradeClicked } from './funnel-analytics';
import type { Language } from './i18n';
import type { PaidPlan } from './plan-modules';

import './styles/free-ai-preview.css';

/** The plan the unlock button opens: the one that runs every locked section. */
export const FREE_UNLOCK_PLAN: PaidPlan = 'Complete';

const GEO_MODULE = 'AI SEO / GEO';

/** The one answer the preview produced, or null when it asked nothing usable. */
function previewAnswer(observations: readonly GeoObservation[]): GeoObservation | null {
  return (
    observations.find(
      (observation) => observation.status === 'answered' && observation.answer !== null,
    ) ?? null
  );
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
          : t.notRunOther;
  return (
    <p className="muted free-ai-preview__not-run" role="note">
      {text}
    </p>
  );
}

/** Static skeleton cards: a label each and three bars, nothing from the scan. */
function DecoyCards(props: { language: Language }) {
  const titles = freePreviewCopy[props.language].preview.decoyTitles;
  return (
    <div className="free-ai-preview__decoys" aria-hidden="true" data-testid="free-locked-decoys">
      {titles.map((title) => (
        <div className="free-ai-preview__decoy" key={title}>
          <span className="free-ai-preview__decoy-title">{title}</span>
          <span className="free-ai-preview__bar" />
          <span className="free-ai-preview__bar free-ai-preview__bar--short" />
          <span className="free-ai-preview__bar" />
        </div>
      ))}
    </div>
  );
}

export function FreeAiPreview(props: {
  modules: readonly ScanModule[];
  observations: readonly GeoObservation[];
  evidence: GeoEvidence | null;
  language: Language;
  onUpgrade: (plan: PaidPlan) => void;
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
        <>
          <p className="muted">{t.lead}</p>
          <NotRunNote module={geoModule} language={props.language} />
        </>
      ) : (
        <FreeGeoAnswer
          observation={answer}
          evidence={props.evidence}
          language={props.language}
          answerLanguage={aiAnswerLanguage(geoModule)}
        />
      )}
      <div className="free-ai-preview__locked">
        <h4 className="free-ai-preview__locked-heading">{t.lockedHeading}</h4>
        <p id="free-ai-preview-locked-description">{t.lockedDescription}</p>
        <div className="free-ai-preview__stage">
          <DecoyCards language={props.language} />
          <div className="free-ai-preview__overlay">
            <p className="free-ai-preview__unlock-lead">{t.unlockLead}</p>
            <Button
              variant="primary"
              aria-describedby="free-ai-preview-locked-description"
              onClick={() => {
                trackUpgradeClicked(FREE_UNLOCK_PLAN, 'free_locked_preview');
                props.onUpgrade(FREE_UNLOCK_PLAN);
              }}
            >
              {t.unlockAction}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
