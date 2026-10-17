// The top and the foot of a report: what an owner reads first, and what only
// support asks for.
//
// Four owners reading a Free report were stopped by the same things: a header
// of internal ids, a score dial holding a dash that "looks broken", and a
// "How to read this report" block standing between them and their problems.
// The header now says which site, which plan and when; the Free result says
// what was checked and what was found; the explainer and the ids are folded.

import type { IssueSummary, Scan, ScanModule } from './api';
import { egressLocationLabel } from './egress-location';
import { formatDate } from './format-date';
import { copy, fillCopy, type Language } from './i18n';
import { planName } from './plan-modules';
import { openProblemGroups } from './ReportNextSteps';
import { displayDomain } from './scan-status';

/** Site, plan and the day of the check — the three facts an owner asks first. */
export function ReportHeaderMeta(props: { scan: Scan; language: Language }) {
  const t = copy[props.language].report;
  const { scan } = props;
  return (
    <div className="report-meta" aria-label={t.headerLabel}>
      <span>
        <small>{t.siteAddress}</small>
        <strong className="technical">{displayDomain(scan.domain)}</strong>
      </span>
      <span>
        <small>{t.plan}</small>
        <strong>{planName(scan.plan)}</strong>
      </span>
      <span>
        <small>{t.checkedOn}</small>
        <strong>
          {formatDate(scan.completedAt ?? scan.startedAt ?? scan.createdAt, props.language)}
        </strong>
      </span>
    </div>
  );
}

/**
 * Completed checks over the modules that produced usable output, or null when
 * none did. Both the Free panel and the checks line count from here, so the
 * two cannot disagree about one run.
 */
function completedChecks(modules: readonly ScanModule[]): {
  readonly completed: number;
  readonly applicable: number;
} | null {
  const usable = modules.filter((module) => module.usableOutput);
  if (usable.length === 0) return null;
  return {
    completed: sumChecks(usable, (module) => module.completedApplicableChecks),
    applicable: sumChecks(usable, (module) => module.applicableChecks),
  };
}

function sumChecks(
  modules: readonly ScanModule[],
  select: (module: ScanModule) => number | null,
): number {
  return modules.reduce((total, module) => total + (select(module) ?? 0), 0);
}

/**
 * The one line an unscored report can put where the coverage number goes.
 *
 * Completed checks, not a percentage: on a plan with no score weights the
 * weighted coverage is 0 by construction, and printing it would repeat the very
 * claim this screen exists to stop making. A scan that read nothing says so.
 *
 * Both halves are counted over the modules that produced usable output, so the
 * ratio stays a statement about one set of results. Counting the denominator
 * over every module would fold in checks belonging to a module that returned
 * nothing, and the line would read as a shortfall in the checks that did run.
 */
export function checksSummary(modules: readonly ScanModule[], language: Language): string {
  const t = copy[language].report;
  const checks = completedChecks(modules);
  return checks === null ? t.unscoredChecksNone : fillCopy(t.unscoredChecks, checks);
}

/**
 * Where a Free report's score dial would be: how many things were checked on
 * the homepage, and how many problems that found.
 *
 * The problem count is `openProblemGroups` over the same summary "Fix these
 * first" and the Free upsell read, so the three never name different numbers.
 * Until the summary arrives the count line is left out rather than shown as a
 * "0" that flips. A homepage that could not be read gets neither number: "no
 * problems found" there would be a clean bill of health for a page nobody saw.
 */
export function FreeCheckStatus(props: {
  modules: readonly ScanModule[];
  summary: IssueSummary | null;
  language: Language;
}) {
  const t = copy[props.language].report;
  const checks = completedChecks(props.modules);
  const unread = checks === null || checks.completed === 0;
  return (
    <div className="free-status" role="status" aria-label={t.freeStatusLabel}>
      <p className="free-status__headline">
        {unread ? t.freeStatusUnread : t.freeStatusChecked(checks.completed)}
      </p>
      {unread || props.summary === null ? null : (
        <p className="free-status__problems">
          {t.freeStatusProblems(openProblemGroups(props.summary).length)}
        </p>
      )}
    </div>
  );
}

/**
 * "How to read this report", folded: every word of it is still here, but it
 * follows the problems instead of standing in front of them, and opens only
 * for the reader who wants it.
 */
export function ReportHelp(props: {
  unscoredPlan: boolean;
  plan: Scan['plan'];
  language: Language;
}) {
  const t = copy[props.language].report;
  return (
    <details className="report-help" aria-label={t.helpHeading}>
      <summary className="report-help__summary">{t.helpHeading}</summary>
      <dl className="report-help__list">
        <div>
          <dt>{t.helpScoreTerm}</dt>
          <dd>
            {props.unscoredPlan
              ? fillCopy(t.unscoredScoreBody, { plan: planName(props.plan) })
              : t.helpScoreBody}
          </dd>
        </div>
        <div>
          <dt>{t.helpCoverageTerm}</dt>
          <dd>{t.helpCoverageBody}</dd>
        </div>
        <div>
          <dt>{t.helpFindingsTerm}</dt>
          <dd>{t.helpFindingsBody}</dd>
        </div>
      </dl>
    </details>
  );
}

/**
 * The ids support asks for, folded at the foot of the report: the report id,
 * the ruleset and configuration versions, where the crawl left from, and the
 * checks figure the old footer line carried.
 */
export function ReportTechnicalDetails(props: {
  scan: Scan;
  checksFigure: string;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { scan } = props;
  return (
    <details className="report-tech">
      <summary className="report-tech__summary">{t.technicalHeading}</summary>
      <p className="muted report-tech__lead">{t.technicalLead}</p>
      <dl className="report-tech__list">
        <dt>{t.reportId}</dt>
        <dd className="report-tech__value">{scan.id}</dd>
        <dt>{t.rulesetVersion}</dt>
        <dd className="report-tech__value">{scan.rulesetVersion}</dd>
        {scan.profileConfigVersion === undefined ? null : (
          <>
            <dt>{t.configurationVersion}</dt>
            <dd className="report-tech__value">v{scan.profileConfigVersion}</dd>
          </>
        )}
        {/* Where the crawl left from (D-228). A scan from before the choice
            says so plainly: some of those left from Kyiv, the earliest from a
            server in Germany, and nothing recorded which. */}
        <dt>{t.egressLocation}</dt>
        <dd className="report-tech__value">
          {scan.egressLocation == null
            ? t.egressLocationUnrecorded
            : egressLocationLabel(scan.egressLocation, props.language)}
        </dd>
        <dt>{t.helpCoverageTerm}</dt>
        <dd className="report-tech__value">{props.checksFigure}</dd>
      </dl>
    </details>
  );
}
