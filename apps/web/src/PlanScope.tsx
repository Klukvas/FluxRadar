// What a report's plan covered and what it did not — the folded "plan scope"
// footnote under the section cards, and the check names a module row recorded.
// Split out of Report.tsx, which had reached the size one file should stop at.

import type { Scan, ScanModule } from './api';
import { checkCopyTitle } from './check-titles';
import { freePreviewCopy } from './free-preview-copy';
import { copy, fillCopy, type Language } from './i18n';
import { asRecord } from './module-metadata';
import { isLegacyPlan, isPreviewModule, modulesBeyondPlan, planName } from './plan-modules';
import { moduleResultLabel } from './scan-status';

/**
 * What this plan looked at, and what it did not.
 *
 * The cards above show the sections that ran; a section the plan does not carry
 * sends no module row at all, so its absence is invisible. That is how a Free
 * report came to read as a clean bill of health for security and accessibility,
 * which were never opened. The right-hand list names them and the plan that adds
 * each one, taken from the tariff matrix rather than from a sales page.
 *
 * A native `<details>` because the answer is a footnote, not the report: shut by
 * default, keyboard-operable and announced as a disclosure without a line of
 * script or a single ARIA attribute of our own.
 */
export function PlanScope(props: {
  modules: readonly ScanModule[];
  plan: Scan['plan'];
  language: Language;
}) {
  const t = copy[props.language].report;
  const locked = modulesBeyondPlan(props.plan);
  // A preview section (Free's one AI answer, D-236) is never a section the plan
  // includes in full. It is named a preview only where it produced an answer:
  // a preview that asked nothing says so in its own block above, and here it is
  // simply what the paid plan adds.
  const previewed = (name: string): boolean =>
    isPreviewModule(props.plan, name) &&
    props.modules.some((module) => module.module === name && module.usableOutput);
  const included = props.modules.filter((module) => !isPreviewModule(props.plan, module.module));
  return (
    <details className="plan-scope">
      <summary className="plan-scope__summary">
        {fillCopy(t.scopeSummary, { plan: planName(props.plan, props.language) })}
      </summary>
      <p className="muted plan-scope__lead">{t.scopeLead}</p>
      <div className="plan-scope__columns">
        <section aria-label={t.scopeIncludedTerm}>
          <h4 className="plan-scope__term">{t.scopeIncludedTerm}</h4>
          <ul className="plan-scope__list">
            {included.map((module) => (
              <li key={module.module}>
                <strong>{module.module}</strong>
                <span className="plan-scope__detail">{scopeDetail(module, props.language)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label={t.scopeLockedTerm}>
          <h4 className="plan-scope__term">{t.scopeLockedTerm}</h4>
          {locked.length === 0 ? (
            <p className="muted plan-scope__detail">
              {isLegacyPlan(props.plan) ? t.scopeLockedArchived : t.scopeLockedNone}
            </p>
          ) : (
            <ul className="plan-scope__list">
              {locked.map((entry) => (
                <li key={entry.module}>
                  <strong>{entry.module}</strong>
                  <span className="plan-scope__detail">
                    {previewed(entry.module)
                      ? freePreviewCopy[props.language].scopePreview
                      : fillCopy(t.scopeUnlock, { plan: planName(entry.plan, props.language) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

/**
 * One line about what a section that ran actually did.
 *
 * Everything in it comes off the module row: how it ended, how many of its
 * applicable checks closed, and — where the row recorded them, as the Free check
 * does — the names of the checks themselves. Nothing is filled in from the plan.
 */
function scopeDetail(module: ScanModule, language: Language): string {
  const t = copy[language].report;
  const parts = [moduleResultLabel(module, language)];
  if (module.completedApplicableChecks !== null && module.applicableChecks !== null) {
    parts.push(
      fillCopy(t.scopeChecks, {
        completed: module.completedApplicableChecks,
        applicable: module.applicableChecks,
      }),
    );
  }
  parts.push(...checkTitles(module.metadata, language));
  return parts.join(' · ');
}

/**
 * Names of the checks a module row says it ran, in the report language; empty
 * when it recorded none. The stored title is the fallback for a rule the report
 * has no copy for.
 */
export function checkTitles(
  metadata: Readonly<Record<string, unknown>> | undefined,
  language: Language,
): readonly string[] {
  const checks = metadata?.checks;
  if (!Array.isArray(checks)) {
    return [];
  }
  return checks.flatMap((entry: unknown) => {
    const record = asRecord(entry);
    const title = record?.title;
    if (typeof title !== 'string' || title === '') return [];
    const ruleId = record?.ruleId;
    return [(typeof ruleId === 'string' ? checkCopyTitle(ruleId, language) : undefined) ?? title];
  });
}
