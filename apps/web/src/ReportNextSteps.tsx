// What a report asks the owner to do next.
//
// The dashboard ended in section cards and a button to a flat list: nothing
// said which problem to start with, a re-scan could not say what it had fixed,
// and a Free report — the product's first impression — ended in a dash and the
// sentence "Export is reserved for Complete scans", with no way on.

import { useEffect, useState } from 'react';

import { ActionPlan } from './ActionPlan';
import {
  apiRequest,
  canRetrySection,
  type IssueRuleGroup,
  type IssueSummary,
  type Scan,
  type ScanChanges,
} from './api';
import { Button, StatusChip } from './components';
import { egressLocationLabel } from './egress-location';
import { findingsCopy, type FindingsCopy } from './findings-copy';
import { formatDate } from './format-date';
import type { Language } from './i18n';
import { planIncludesIssueHistory } from './plan-modules';
import { problemTitle } from './finding-explainers';
import {
  CRAWLER_PAGE_HREF,
  nothingWasChecked,
  reportFailureCopy,
  statusMeaningClassOf,
  technicalDetailsOf,
  type SiteFailureStep,
  type SiteReadFailure,
} from './report-failure-copy';
import { ANALYTICS_MODULE } from './rule-titles';
import { displayDomain } from './scan-status';
import './styles/findings.css';

/** How many problems the report puts in front of the owner. */
export const FIX_FIRST_LIMIT = 5;

/**
 * Whether this report holds anything an Action Plan could be written about.
 *
 * Not `summary.open > 0`: that count includes Analytics, whose findings are
 * Google's data and never reach a provider, so the server refuses a plan for a
 * report whose only open findings are there (`ACTION_PLAN_NOTHING_TO_PLAN`).
 * Counting them here offered a button that was always refused — the dead end
 * the "nothing to plan" state exists to remove.
 */
export function hasPlannableOpenIssues(summary: IssueSummary): boolean {
  return summary.groups.some((group) => group.module !== ANALYTICS_MODULE && group.openIssues > 0);
}

export function useIssueSummary(scanId: string): IssueSummary | null {
  const [summary, setSummary] = useState<IssueSummary | null>(null);
  useEffect(() => {
    let current = true;
    apiRequest<IssueSummary>(`/scans/${encodeURIComponent(scanId)}/issues/summary`)
      .then((value) => {
        if (current && Array.isArray(value?.groups)) setSummary(value);
      })
      .catch((caught: unknown) => {
        // The report reads without this block; the Issue Center still lists everything.
        console.error('FluxRadar issue summary unavailable', caught);
      });
    return () => {
      current = false;
    };
  }, [scanId]);
  return summary;
}

/**
 * How each row of the block reaches the problem it names.
 *
 * On a report it is a button: pressing it opens that problem's findings, which
 * is a screen the reader does not have yet. The public example has every
 * problem on the page already, so there it is a link to the entry further down
 * — a real link, with a real address, labelled as a move down the page. It used
 * to be the report's own button, reading "Open" and only scrolling, on a page
 * that told the reader nothing on it could be pressed.
 */
export interface FixFirstJumps {
  /** The in-page address of one problem's own entry. */
  readonly problemHref: (ruleId: string) => string;
  /** The in-page address of the full list. */
  readonly allHref: string;
  /** What a row's control says, in place of "Open". */
  readonly openLabel: string;
  /**
   * Told which problem a row leads to, when the row is pressed.
   *
   * The link still navigates; this is only how the example learns that the
   * reader asked for one particular problem, so it can unfold that card rather
   * than leave them looking at a folded headline.
   */
  readonly onProblemJump?: (ruleId: string) => void;
}

/**
 * The accessible name of a jump row.
 *
 * WCAG 2.5.3 (label in name): the name has to contain the words the reader can
 * see. The row says "Show below ↓" and was announced "Show findings: <title>",
 * so somebody driving the page by voice could say neither — and the five rows
 * were five identical visible labels. The visible words come first, then the
 * problem the row leads to, which is what tells the rows apart.
 */
function jumpAccessibleName(openLabel: string, title: string): string {
  return `${openLabel} — ${title}`;
}

/** An extra sentence under the heading, for a reader with no report of their own. */
function FixFirstUnitNote({ note }: { note?: string }) {
  if (note === undefined) return null;
  return <p className="fix-first__unit">{note}</p>;
}

/**
 * How one row reaches the problem it names.
 *
 * A report's own button opens that problem's findings. The public example has
 * every problem on the page already, so there it is a real link to the entry
 * further down, labelled as a move down the page.
 */
function FixFirstRowControl(props: {
  ruleId: string;
  /** The problem's plain name, for the accessible name of either control. */
  title: string;
  labels: FindingsCopy;
  jumps?: FixFirstJumps;
  onOpenProblem?: (ruleId: string) => void;
}) {
  const { jumps, labels, ruleId, title } = props;
  if (jumps === undefined) {
    return (
      <Button
        onClick={() => props.onOpenProblem?.(ruleId)}
        aria-label={labels.issues.showFindingsFor(title)}
      >
        {labels.fixFirst.open}
      </Button>
    );
  }
  return (
    <a
      className="button fix-first__jump"
      href={jumps.problemHref(ruleId)}
      aria-label={jumpAccessibleName(jumps.openLabel, title)}
      onClick={() => jumps.onProblemJump?.(ruleId)}
    >
      {jumps.openLabel}
    </a>
  );
}

/** One problem: how urgent, what it is called, how many findings, and the way in. */
function FixFirstRow(props: {
  group: IssueRuleGroup;
  language: Language;
  labels: FindingsCopy;
  jumps?: FixFirstJumps;
  onOpenProblem?: (ruleId: string) => void;
}) {
  const { group, labels } = props;
  // The problem's plain name, the one the Issue Center shows. Two names for one
  // rule — "Heading structure is broken (H1–H6)" here and "Headings do not form
  // a clear outline" there — read as two different problems, and this block is
  // the link to that one. The technical title stays in a finding's technical fold.
  const title = problemTitle(group.ruleId, props.language);
  return (
    <li className="fix-first__item">
      <StatusChip status={group.severity} label={labels.severity[group.severity]} />
      <span className="fix-first__title">{title}</span>
      <span className="muted fix-first__count">{labels.fixFirst.pages(group.openIssues)}</span>
      <FixFirstRowControl
        ruleId={group.ruleId}
        title={title}
        labels={labels}
        jumps={props.jumps}
        onOpenProblem={props.onOpenProblem}
      />
    </li>
  );
}

/** The way to the problems this block had no room for. */
function FixFirstMore(props: {
  open: number;
  labels: FindingsCopy;
  jumps?: FixFirstJumps;
  onAll?: () => void;
}) {
  const { jumps, labels } = props;
  return (
    <div className="button-row fix-first__more">
      {jumps === undefined ? (
        <Button onClick={() => props.onAll?.()}>{labels.fixFirst.all(props.open)}</Button>
      ) : (
        <a className="button" href={jumps.allHref}>
          {labels.fixFirst.all(props.open)}
        </a>
      )}
    </div>
  );
}

export interface FixFirstProps {
  readonly summary: IssueSummary;
  readonly language: Language;
  /** How a report opens one problem. Left out only when `jumps` is given. */
  readonly onOpenProblem?: (ruleId: string) => void;
  /** How a report opens the whole list. Left out only when `jumps` is given. */
  readonly onAll?: () => void;
  /** True when the scan checked nothing: an empty list is then no verdict at all. */
  readonly nothingChecked?: boolean;
  /**
   * The level the surrounding document gives this block's heading. Three on the
   * report, where it sits under the report's own section heading; two on a page
   * whose other blocks are second-level, so the outline does not read as though
   * "fix these first" were part of whatever came before it.
   */
  readonly headingLevel?: 2 | 3;
  /**
   * Set only by the public example, which has nothing to open: its rows become
   * links down its own page. A report leaves it out and keeps its buttons.
   */
  readonly jumps?: FixFirstJumps;
  /** An extra sentence under the heading, for a reader with no report of their own. */
  readonly unitNote?: string;
}

export function FixFirst(props: FixFirstProps) {
  const f = findingsCopy[props.language];
  const open = props.summary.groups.filter((group) => group.openIssues > 0);
  const top = open.slice(0, FIX_FIRST_LIMIT);
  const Heading = props.headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="report-block" aria-labelledby="fix-first-heading">
      <Heading id="fix-first-heading">{f.fixFirst.heading}</Heading>
      {top.length === 0 ? (
        <p>
          {props.nothingChecked === true
            ? reportFailureCopy[props.language].nothingChecked
            : f.fixFirst.none}
        </p>
      ) : (
        <>
          <p className="muted">{f.fixFirst.lead}</p>
          <FixFirstUnitNote note={props.unitNote} />
          <ol className="fix-first">
            {top.map((group) => (
              <FixFirstRow
                key={`${group.ruleId}:${group.module}`}
                group={group}
                language={props.language}
                labels={f}
                jumps={props.jumps}
                onOpenProblem={props.onOpenProblem}
              />
            ))}
          </ol>
          {open.length > top.length ? (
            <FixFirstMore open={open.length} labels={f} jumps={props.jumps} onAll={props.onAll} />
          ) : null}
        </>
      )}
    </section>
  );
}

/** What changed since the previous scan of the plan; null until it arrives, or when it cannot. */
function useScanChanges(scanId: string): ScanChanges | null {
  const [changes, setChanges] = useState<ScanChanges | null>(null);
  useEffect(() => {
    let current = true;
    apiRequest<ScanChanges>(`/scans/${encodeURIComponent(scanId)}/changes`)
      .then((value) => {
        if (current && typeof value?.fixed === 'number') setChanges(value);
      })
      .catch((caught: unknown) => {
        console.error('FluxRadar scan changes unavailable', caught);
      });
    return () => {
      current = false;
    };
  }, [scanId]);
  return changes;
}

/**
 * Two crawls from two countries are two measurements, not a trend (D-228):
 * what one found and the other did not is a difference between places, so
 * it is not called fixed or new.
 */
function crossesCountries(changes: ScanChanges): boolean {
  return (
    changes.egressComparison === 'different' &&
    changes.egressLocation != null &&
    changes.previous?.egressLocation != null
  );
}

type ChangeLabels = Pick<
  FindingsCopy['changes'],
  'fixed' | 'introduced' | 'persisting' | 'fixedList' | 'introducedList'
>;

function changeLabels(f: FindingsCopy, acrossCountries: boolean): ChangeLabels {
  return acrossCountries
    ? {
        fixed: f.changes.onlyPrevious,
        introduced: f.changes.onlyCurrent,
        persisting: f.changes.inBoth,
        fixedList: f.changes.onlyPreviousList,
        introducedList: f.changes.onlyCurrentList,
      }
    : f.changes;
}

/** Where the two crawls left from, when that changes how the numbers read. */
function EgressNote(props: { changes: ScanChanges; language: Language }) {
  const f = findingsCopy[props.language];
  const current = props.changes.egressLocation;
  const previous = props.changes.previous?.egressLocation;
  if (props.changes.egressComparison === 'different' && current != null && previous != null) {
    return (
      <p role="note">
        {f.changes.egressDifferent(
          egressLocationLabel(current, props.language),
          egressLocationLabel(previous, props.language),
        )}
      </p>
    );
  }
  if (props.changes.egressComparison === 'unrecorded') {
    return (
      <p className="muted" role="note">
        {f.changes.egressUnrecorded}
      </p>
    );
  }
  return null;
}

function ChangesGrid(props: {
  changes: ScanChanges;
  labels: ChangeLabels;
  acrossCountries: boolean;
}) {
  const { changes, labels, acrossCountries } = props;
  return (
    <div className="changes-grid">
      <div className={`changes-stat${acrossCountries ? '' : ' changes-stat--fixed'}`}>
        <strong>{changes.fixed}</strong>
        {labels.fixed}
      </div>
      <div className={`changes-stat${acrossCountries ? '' : ' changes-stat--introduced'}`}>
        <strong>{changes.introduced}</strong>
        {labels.introduced}
      </div>
      <div className="changes-stat">
        <strong>{changes.persisting}</strong>
        {labels.persisting}
      </div>
    </div>
  );
}

/** The rules behind one of the numbers, most findings first as the API sends them. */
function ChangedRules(props: {
  heading: string;
  rules: ScanChanges['fixedByRule'];
  language: Language;
}) {
  if (props.rules.length === 0) return null;
  return (
    <div>
      <h4>{props.heading}</h4>
      <ul>
        {props.rules.slice(0, FIX_FIRST_LIMIT).map((rule) => (
          <li key={rule.ruleId}>
            {problemTitle(rule.ruleId, props.language)} — {rule.count}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScanChangesBlock(props: { scanId: string; language: Language }) {
  const f = findingsCopy[props.language];
  const changes = useScanChanges(props.scanId);
  if (changes === null) return null;
  if (changes.previous === null) {
    return (
      <section className="report-block" aria-labelledby="changes-heading">
        <h3 id="changes-heading">{f.changes.heading}</h3>
        <p className="muted">{f.changes.firstReport}</p>
      </section>
    );
  }
  const acrossCountries = crossesCountries(changes);
  const labels = changeLabels(f, acrossCountries);
  return (
    <section
      className={`report-block${acrossCountries ? ' report-block--warning' : ''}`}
      aria-labelledby="changes-heading"
    >
      <h3 id="changes-heading">{f.changes.heading}</h3>
      <p className="muted">
        {f.changes.since(formatDate(changes.previous.completedAt, props.language))}
      </p>
      <EgressNote changes={changes} language={props.language} />
      <ChangesGrid changes={changes} labels={labels} acrossCountries={acrossCountries} />
      {changes.fixedByRule.length > 0 || changes.introducedByRule.length > 0 ? (
        <div className="changes-lists">
          <ChangedRules
            heading={labels.fixedList}
            rules={changes.fixedByRule}
            language={props.language}
          />
          <ChangedRules
            heading={labels.introducedList}
            rules={changes.introducedByRule}
            language={props.language}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * A Partial report can run its unfinished section once more. The API has taken
 * that retry since the start; nothing on screen ever offered it.
 */
export function SectionRetry(props: { language: Language; onRetry: () => Promise<void> }) {
  const f = findingsCopy[props.language].retry;
  const [working, setWorking] = useState(false);
  return (
    <section className="report-block report-block--warning" aria-labelledby="retry-heading">
      <h3 id="retry-heading">{f.heading}</h3>
      <p>{f.body}</p>
      <div className="button-row">
        <Button
          variant="primary"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void props.onRetry().finally(() => setWorking(false));
          }}
        >
          {working ? f.working : f.action}
        </Button>
      </div>
    </section>
  );
}

/**
 * The one block a report shows when no page of the site could be read.
 *
 * It replaces what the owner used to piece together from eight "Unavailable"
 * cards and a raw reason code: what we saw, the usual causes, and what to do —
 * with the crawler page one click away, because a protection layer refusing us
 * is the cause the owner can fix themselves. The raw reason stays, small, for
 * whoever the owner forwards this to.
 */
export function SiteUnreadBlock(props: {
  failure: SiteReadFailure;
  domain: string;
  /**
   * The Free check cannot skip robots.txt, so that alternative is not offered
   * there, and nothing was paid for it, so no refund line is shown.
   */
  plan: Scan['plan'];
  language: Language;
}) {
  const t = reportFailureCopy[props.language];
  const details = technicalDetailsOf(props.failure, props.language);
  const guidance = t.guidance[props.failure.kind];
  // What the answer the site gave actually means. The number itself stays in
  // the technical-details line below: "HTTP 410" is the only thing on this
  // block that named the real answer, and it named it to nobody. Every class
  // of answer has a sentence now, including no answer at all — except where
  // the failure's own sentence above has already said it.
  const statusClass = statusMeaningClassOf(props.failure);
  // A labelled region, not an alert: the block is on the page from the first
  // paint, and an alert would be read out in full on every visit.
  return (
    <section className="report-block report-block--warning" aria-labelledby="site-unread-heading">
      <h3 id="site-unread-heading">{t.heading}</h3>
      <p>{t.lead(props.domain)}</p>
      {/* Conditional, on every surface: a paid plan says a scan was bought,
          not that money moved. The provider's own checkout says nothing is
          taken from the card while it runs in test mode. */}
      {props.plan === 'Free' ? null : <p>{t.paidNotDelivered}</p>}
      <h4>{t.whatWeSaw}</h4>
      <p>{t.kinds[props.failure.kind]}</p>
      {statusClass === null ? null : <p>{t.statusMeanings[statusClass]}</p>}
      {guidance.causes.length === 0 ? null : (
        <>
          <h4>{t.causesHeading}</h4>
          <ul>
            {guidance.causes.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        </>
      )}
      <h4>{t.whatToDoHeading}</h4>
      <ol>
        {guidance.steps.map((step) => (
          <li key={step}>
            <SiteFailureStepText
              step={step}
              domain={props.domain}
              canOverrideRobots={props.plan !== 'Free'}
              language={props.language}
            />
          </li>
        ))}
      </ol>
      {details === null ? null : <p className="muted technical">{details}</p>}
    </section>
  );
}

function SiteFailureStepText(props: {
  step: SiteFailureStep;
  domain: string;
  canOverrideRobots: boolean;
  language: Language;
}) {
  const t = reportFailureCopy[props.language];
  const crawlerLink = <a href={CRAWLER_PAGE_HREF}>{t.crawlerLink}</a>;
  switch (props.step) {
    case 'checkInBrowser':
      return <>{t.checkInBrowser(props.domain)}</>;
    case 'opensInBrowser':
      return (
        <>
          {t.opensInBrowserBefore} <a href={CRAWLER_PAGE_HREF}>{t.opensInBrowserLink}</a>{' '}
          {t.opensInBrowserAfter}
        </>
      );
    case 'allowCrawler':
      return (
        <>
          {t.allowCrawlerBefore} {crawlerLink} {t.allowCrawlerAfter}
        </>
      );
    case 'allowInRobots':
      return (
        <>
          {t.allowInRobotsBefore} {crawlerLink} {t.allowInRobotsAfter}
          {props.canOverrideRobots ? ` ${t.robotsOverride}` : null}
        </>
      );
    case 'runAgain':
      return <>{t.runAgain}</>;
    case 'runAgainAfterChange':
      return <>{t.runAgainAfterChange}</>;
  }
}

export function FreeUpsell(props: { scan: Scan; language: Language; onUpgrade: () => void }) {
  const f = findingsCopy[props.language];
  return (
    <section className="report-block upsell" aria-labelledby="upsell-heading">
      <h3 id="upsell-heading">{f.upsell.heading}</h3>
      <p>{f.upsell.lead(displayDomain(props.scan.domain))}</p>
      <ul>
        {f.upsell.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className="button-row">
        <Button variant="primary" onClick={props.onUpgrade}>
          {f.upsell.action('Complete')}
        </Button>
        <a href="/plans">{f.upsell.compare}</a>
      </div>
    </section>
  );
}

/**
 * Whether this report draws its own "since last scan" numbers here.
 *
 * Only one block on a report may: the plans that carry finding history now get
 * the comparison panel above the section cards (ScanComparison.tsx), which
 * answers the same question from the §14 proof — it will not call a finding
 * fixed unless the run re-checked it — while this block diffs fingerprints in
 * process and calls every absence a fix. Two blocks, two different numbers, one
 * report. The panel wins where it renders; Basic, which buys no finding history
 * and gets no panel, keeps this one.
 *
 * The D-228 egress note goes with it: the crawl location is part of the crawl
 * scope fingerprint, so two runs from two countries reach the panel as
 * `scope-changed` and it names the location that moved, which is the same
 * warning stated more precisely.
 */
function drawsOwnChanges(scan: Scan): boolean {
  return scan.plan !== 'Free' && !planIncludesIssueHistory(scan.plan);
}

/**
 * The report's next-step blocks, in order: what to fix first — the AI Action
 * Plan when one is ready in the chosen language, "Fix these first" otherwise —
 * then either what changed since the last scan (a paid report without the
 * comparison panel) or what the free check left unread (a Free one).
 */
export function ReportNextSteps(props: {
  scan: Scan;
  language: Language;
  onOpenProblem: (ruleId: string) => void;
  onAllProblems: () => void;
  onUpgrade: () => void;
  /** The site profile's target languages, offered first by the plan picker. */
  targetLanguages?: string | null;
  /** Absent where the screen offers no retry; the block is then not drawn. */
  onRetry?: () => Promise<void>;
  /** Set when no page of the site could be read; leads the blocks below. */
  siteFailure?: SiteReadFailure | null;
  /** Whether the scan checked nothing; derived from the scan when absent. */
  nothingChecked?: boolean;
}) {
  const summary = useIssueSummary(props.scan.id);
  const siteFailure = props.siteFailure ?? null;
  const nothingChecked =
    props.nothingChecked ?? (siteFailure !== null || nothingWasChecked(props.scan));
  // A ready plan in the selected language takes FixFirst's place: it says the
  // same thing in more useful words, and two "start here" lists would compete.
  const [planReady, setPlanReady] = useState(false);
  // Null until the summary arrives: "this report has nothing left to plan" is a
  // statement, and the plan block must not make it while it is still loading.
  const hasOpenIssues = summary === null ? null : hasPlannableOpenIssues(summary);
  return (
    <>
      {siteFailure === null ? null : (
        <SiteUnreadBlock
          failure={siteFailure}
          domain={displayDomain(props.scan.domain)}
          plan={props.scan.plan}
          language={props.language}
        />
      )}
      {props.onRetry !== undefined && canRetrySection(props.scan) ? (
        <SectionRetry language={props.language} onRetry={props.onRetry} />
      ) : null}
      {/* The block above already says to run the scan again; a plan block
          beside it would only repeat that nothing was checked. */}
      {siteFailure !== null ? null : (
        <ActionPlan
          scan={props.scan}
          language={props.language}
          targetLanguages={props.targetLanguages}
          onOpenProblem={props.onOpenProblem}
          onUpgrade={props.onUpgrade}
          hasOpenIssues={hasOpenIssues}
          nothingChecked={nothingChecked}
          onPlanReadyChange={setPlanReady}
        />
      )}
      {summary === null || planReady ? null : (
        <FixFirst
          summary={summary}
          language={props.language}
          onOpenProblem={props.onOpenProblem}
          onAll={props.onAllProblems}
          nothingChecked={nothingChecked}
        />
      )}
      {/* Selling a bigger scan of a site we could not read would sell a second
          failure; the block above says what to fix first. */}
      {props.scan.plan === 'Free' && siteFailure === null ? (
        <FreeUpsell scan={props.scan} language={props.language} onUpgrade={props.onUpgrade} />
      ) : null}
      {drawsOwnChanges(props.scan) ? (
        <ScanChangesBlock scanId={props.scan.id} language={props.language} />
      ) : null}
    </>
  );
}
