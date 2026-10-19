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

/**
 * Site, plan and the day of the check — the three facts an owner asks first.
 *
 * A list of terms, not a line of "·"-separated spans: on a phone the line
 * wrapped and its second row opened on a stray "·". The group gives the list
 * the name a bare `div` could not carry to assistive technology.
 */
export function ReportHeaderMeta(props: { scan: Scan; language: Language }) {
  const t = copy[props.language].report;
  const { scan } = props;
  const checkedAt = scan.completedAt ?? scan.startedAt ?? scan.createdAt;
  return (
    <div role="group" aria-label={t.headerLabel}>
      <dl className="report-meta">
        <div>
          <dt>{t.siteAddress}</dt>
          <dd className="technical">{displayDomain(scan.domain)}</dd>
        </div>
        <div>
          <dt>{t.plan}</dt>
          <dd>{planName(scan.plan, props.language)}</dd>
        </div>
        <div>
          <dt>{t.checkedOn}</dt>
          <dd>
            <time dateTime={checkedAt}>{formatDate(checkedAt, props.language)}</time>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** What a report's checks came to: a count, or that the site went unread. */
export type ReportChecks =
  | { readonly unread: true }
  | { readonly unread: false; readonly completed: number; readonly applicable: number };

/**
 * The one predicate behind the Free result panel and the checks line in the
 * report details, so the two can never disagree about one run.
 *
 * Unread when no page of the site could be read (the screen's site-failure
 * signal) or when no section produced usable output. Otherwise completed over
 * applicable checks — both counted over the sections with usable output, so
 * the ratio stays a statement about one set of results: counting the
 * denominator over every section would fold in checks of a section that
 * returned nothing, and read as a shortfall in the checks that did run.
 */
export function reportChecksOf(modules: readonly ScanModule[], siteUnread: boolean): ReportChecks {
  const usable = modules.filter((module) => module.usableOutput);
  if (siteUnread || usable.length === 0) return { unread: true };
  return {
    unread: false,
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
 * The checks line an unscored or unavailable report shows where a coverage
 * percentage would go.
 *
 * Completed checks, not a percentage: on a plan with no score weights the
 * weighted coverage is 0 by construction, and printing it would repeat the very
 * claim this screen exists to stop making. A scan that read nothing says so.
 */
export function checksSummary(checks: ReportChecks, language: Language): string {
  const t = copy[language].report;
  return checks.unread
    ? t.unscoredChecksNone
    : fillCopy(t.unscoredChecks, { completed: checks.completed, applicable: checks.applicable });
}

/**
 * Where a Free report's score dial would be: how many things were checked on
 * the homepage, and how many problems that found.
 *
 * The problem count is `openProblemGroups` over the same summary "Fix these
 * first" and the Free upsell read, so the three never name different numbers.
 * Until the summary arrives the count line is left out rather than shown as a
 * "0" that flips. An unread homepage, or a run that completed no check, gets no
 * problem count: "no problems found" there would be a clean bill of health for
 * a page nothing measured.
 */
export function FreeCheckStatus(props: {
  checks: ReportChecks;
  summary: IssueSummary | null;
  language: Language;
}) {
  const t = copy[props.language].report;
  const { checks } = props;
  const problems =
    !checks.unread && checks.completed > 0 && props.summary !== null
      ? openProblemGroups(props.summary).length
      : null;
  return (
    <div className="free-status" role="status" aria-label={t.freeStatusLabel}>
      <p className="free-status__headline">
        {checks.unread ? t.freeStatusUnread : t.freeStatusChecked(checks.completed)}
      </p>
      {problems === null ? null : (
        <p className="free-status__problems">{t.freeStatusProblems(problems)}</p>
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
              ? fillCopy(t.unscoredScoreBody, { plan: planName(props.plan, props.language) })
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
        <dd className="report-tech__value report-tech__value--technical">{scan.id}</dd>
        <dt>{t.rulesetVersion}</dt>
        <dd className="report-tech__value report-tech__value--technical">{scan.rulesetVersion}</dd>
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
