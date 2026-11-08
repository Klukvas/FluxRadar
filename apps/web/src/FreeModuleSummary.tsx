import type { GeoObservation, ScanModule } from './api';
import { hasFreeAiAnswer } from './free-geo-claims';
import { freeReportCopy } from './free-report-copy';
import {
  freeCheckCountOf,
  freeIssueCheckCountOf,
  freeScoreCopy,
  isFreeScale,
} from './free-score-copy';
import type { Language } from './i18n';
import { ruleChecksOf } from './module-metadata';
import { moduleScoreLabel } from './scan-status';

export function FreeModuleSummary(props: {
  module: ScanModule;
  language: Language;
  observations: readonly GeoObservation[];
}) {
  const { module, language } = props;
  const t = freeReportCopy[language];
  const issues = freeIssueCheckCountOf([module]);
  const count = freeCheckCountOf([module]);
  const hasChecks =
    ruleChecksOf(module.metadata).length > 0 ||
    (Array.isArray(module.metadata?.checks) && module.metadata.checks.length > 0);
  return (
    <>
      <div
        className={
          module.score === null
            ? 'module-card__score module-card__score--null'
            : 'module-card__score'
        }
      >
        {module.module === 'SEO' && module.score !== null && isFreeScale(module.scoreMax)
          ? t.points(
              freeScoreCopy[language].valueOverMax(Math.round(module.score), module.scoreMax ?? 40),
            )
          : moduleScoreLabel(module, language)}
      </div>
      {module.module === 'SEO' ? (
        <>
          {issues === null ? null : (
            <small className="module-card__meta">{t.issueChecks(issues)}</small>
          )}
          {module.score !== null && isFreeScale(module.scoreMax) ? (
            <small className="module-card__meta">{t.rounding}</small>
          ) : null}
          {hasChecks ? <small className="module-card__meta">{t.checks(count)}</small> : null}
        </>
      ) : module.module === 'AI SEO / GEO' && props.observations.some(hasFreeAiAnswer) ? (
        <small className="module-card__meta">{t.aiExcluded}</small>
      ) : null}
    </>
  );
}
