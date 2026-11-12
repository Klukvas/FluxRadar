import type { ScanModule } from './api';
import { localizedCheckTitle } from './check-titles';
import { freeReportCopy } from './free-report-copy';
import { copy, type Language } from './i18n';
import { asRecord, ruleCheckResult, ruleChecksOf } from './module-metadata';
import type { PaidPlan } from './plan-modules';
import { RuleChecksList } from './RuleChecksList';

import './styles/free-seo-checks.css';

function declaredChecksOf(module: ScanModule): readonly { ruleId: string; title: string }[] {
  const entries = module.metadata?.checks;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const check = asRecord(entry);
    return typeof check?.ruleId === 'string' && typeof check.title === 'string'
      ? [{ ruleId: check.ruleId, title: check.title }]
      : [];
  });
}

/** Only the Free report call site uses this fallback; paid section gates stay unchanged. */
export function hasDeclaredFreeSeoChecks(module: ScanModule): boolean {
  return module.module === 'SEO' && declaredChecksOf(module).length > 0;
}

function RecordedCheckNames(props: { module: ScanModule; language: Language }) {
  const checks = declaredChecksOf(props.module);
  if (checks.length === 0) return null;
  const t = freeReportCopy[props.language];
  return (
    <section className="free-seo-checks__group" aria-labelledby="free-seo-recorded-title">
      <h4 className="module-checks__subheading" id="free-seo-recorded-title">
        {t.recordedHeading}
      </h4>
      <p className="muted">{t.recordedNote}</p>
      <ul className="module-checks__list free-seo-checks__recorded-names">
        {checks.map((check) => (
          <li className="module-checks__item" key={check.ruleId}>
            <span>{localizedCheckTitle(check.ruleId, check.title, props.language)}</span>
            <small>{check.ruleId}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FreeSeoChecks(props: {
  module: ScanModule;
  language: Language;
  onOpenProblem?: (ruleId: string) => void;
  onUpgrade?: (plan: PaidPlan) => void;
}) {
  const t = freeReportCopy[props.language];
  const checks = ruleChecksOf(props.module.metadata);
  const groups = [
    { result: 'issues', label: t.issues },
    { result: 'passed', label: t.passed },
    { result: 'noted', label: t.noted },
    { result: 'notApplicable', label: t.notApplicable },
  ] as const;
  return (
    <div className="free-seo-checks">
      {checks.length === 0 ? (
        <RecordedCheckNames module={props.module} language={props.language} />
      ) : null}
      {checks.length === 0 ? null : (
        <p className="muted">{copy[props.language].report.checks.ruleLead}</p>
      )}
      {groups.map((group) => {
        const rows = checks.filter((check) => ruleCheckResult(check) === group.result);
        return rows.length === 0 ? null : (
          <section
            className="free-seo-checks__group"
            key={group.result}
            aria-labelledby={`free-seo-${group.result}`}
          >
            <h4 className="module-checks__subheading" id={`free-seo-${group.result}`}>
              {group.label} · {rows.length}
            </h4>
            <RuleChecksList
              checks={rows}
              language={props.language}
              hideLead
              onOpenProblem={props.onOpenProblem}
            />
          </section>
        );
      })}
    </div>
  );
}
