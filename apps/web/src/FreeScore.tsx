// A Free report's score: the homepage number out of 40, one short line saying
// this is a quick check, and a primary button to the whole-site audit scored
// out of 100 — kept together so the note is read with the number (D-237). Paid
// reports use `ScoreDial` directly and see none of this.

import type { Dashboard, ScanModule } from './api';
import { Button, ScoreDial } from './components';
import {
  FREE_SCORE_UPGRADE_PLAN,
  FULL_SCORE_MAX,
  freeDialProps,
  freeScoreCopy,
  isFreeScale,
} from './free-score-copy';
import { trackUpgradeClicked } from './funnel-analytics';
import type { Language } from './i18n';
import type { PaidPlan } from './plan-modules';

export function FreeScore(props: {
  overall: Dashboard['overall'];
  modules: readonly ScanModule[];
  language: Language;
  /** Absent where the report has nowhere to send an upgrade. */
  onUpgrade?: (plan: PaidPlan) => void;
}) {
  const { overall, onUpgrade } = props;
  const dial = freeDialProps(overall, props.modules, props.language);
  const freeScale = isFreeScale(overall.scoreMax);
  return (
    <div className="free-score">
      <ScoreDial
        score={overall.score}
        language={props.language}
        verdict={overall.verdict}
        coverage={overall.weightedCoverage}
        {...dial}
      />
      {freeScale && onUpgrade !== undefined ? (
        <div className="free-score__cta">
          {/* Primary: the dial's note is now one short line, so this button
              carries the full-audit promise and has to stand out (owner
              decision, D-237, reversing the earlier default variant). */}
          <Button
            variant="primary"
            onClick={() => {
              trackUpgradeClicked(FREE_SCORE_UPGRADE_PLAN, 'free_score');
              onUpgrade(FREE_SCORE_UPGRADE_PLAN);
            }}
          >
            {freeScoreCopy[props.language].upgrade(FULL_SCORE_MAX)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
