// The comparison as one block of the printed client report.
//
// Counts and the verdict only: the printed report is handed to somebody who
// cannot expand a list, and the addresses behind these numbers are the Issue
// Center's job. The verdict is NOT dropped for being long — a printed page
// saying "3 resolved" without saying what the two crawls were is the one thing
// this feature must not put in front of a client.

import type { ScanComparison } from './comparison-api';
import { egressMayExplainDifference, movement, scoreText } from './comparison-format';
import { formatDate } from './format-date';
import { copy, fillCopy, type Language } from './i18n';
import { planName } from './plan-modules';

export function ComparisonPrintBlock(props: {
  readonly comparison: ScanComparison;
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  const { comparison } = props;
  const { previous } = comparison;
  return (
    <section className="print-section print-comparison">
      <h2>{t.heading}</h2>
      {previous === null ? (
        <p>{fillCopy(t.firstReport, { plan: planName(comparison.current.plan) })}</p>
      ) : (
        <>
          <p>
            {fillCopy(t.since, {
              plan: planName(previous.plan),
              date: formatDate(previous.completedAt, props.language),
            })}
          </p>
          {comparison.comparable.ok ? (
            <>
              <p>
                {t.overall}:{' '}
                {fillCopy(t.scoreMove, {
                  previous: scoreText(comparison.overall.previousScore, t),
                  current: scoreText(comparison.overall.currentScore, t),
                })}
                {movement(comparison.overall.delta, t) === null
                  ? ''
                  : ` (${movement(comparison.overall.delta, t) ?? ''})`}
              </p>
              <p>
                {t.issuesNew}: {comparison.issues.new} · {t.issuesResolved}:{' '}
                {comparison.issues.resolved} · {t.issuesReopened}: {comparison.issues.reopened} ·{' '}
                {t.issuesStillOpen}: {comparison.issues.stillOpen} · {t.issuesSettled}:{' '}
                {comparison.issues.settled}
              </p>
              {/* Printed too: a client reading "12 new" has to be told which of
                  them are new checks rather than new problems, and they cannot
                  expand anything to find out. */}
              {comparison.issues.firstChecked.count === 0 ? null : (
                <p>
                  {t.issuesFirstChecked}: {comparison.issues.firstChecked.count}
                </p>
              )}
              {/* And told when nobody can make that split at all: on a printed
                  page an unexplained "12 new" is the claim itself. */}
              {comparison.issues.firstChecked.known ? null : <p>{t.coverageUnknownNote}</p>}
              {comparison.pages.comparable.ok ? (
                <p>
                  {t.pagesHeading} — {t.pagesAdded}: {comparison.pages.added} · {t.pagesRemoved}:{' '}
                  {comparison.pages.removed} · {t.pagesKept}: {comparison.pages.kept}
                </p>
              ) : (
                <p>{t.pagesReason[comparison.pages.comparable.reason]}</p>
              )}
            </>
          ) : (
            <p>{t.reason[comparison.comparable.reason]}</p>
          )}
          {/* Printed on both paths, and whatever the verdict was: a client
              holding this page cannot be told "3 resolved" — or "not compared" —
              without being told that the two checks may have left from different
              places, or from places nobody recorded (D-228). An unreadable
              previous report carries no scope, and nothing is claimed about it. */}
          {previous.readable &&
          egressMayExplainDifference(comparison.current.scope, previous.scope) ? (
            <p>{t.scopeEgressNote}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
