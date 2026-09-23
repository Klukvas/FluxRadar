// What a report asks the owner to do next.
//
// The dashboard ended in section cards and a button to a flat list: nothing
// said which problem to start with, a re-scan could not say what it had fixed,
// and a Free report — the product's first impression — ended in a dash and the
// sentence "Export is reserved for Complete scans", with no way on.

import { useEffect, useState } from 'react';

import { ActionPlan } from './ActionPlan';
import { apiRequest, canRetrySection, type IssueSummary, type Scan, type ScanChanges } from './api';
import { Button, StatusChip } from './components';
import { findingsCopy } from './findings-copy';
import { formatDate } from './format-date';
import type { Language } from './i18n';
import { ANALYTICS_MODULE, ruleTitle } from './rule-titles';
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

export function FixFirst(props: {
  summary: IssueSummary;
  language: Language;
  onOpenProblem: (ruleId: string) => void;
  onAll: () => void;
}) {
  const f = findingsCopy[props.language];
  const open = props.summary.groups.filter((group) => group.openIssues > 0);
  const top = open.slice(0, FIX_FIRST_LIMIT);
  return (
    <section className="report-block" aria-labelledby="fix-first-heading">
      <h3 id="fix-first-heading">{f.fixFirst.heading}</h3>
      {top.length === 0 ? (
        <p>{f.fixFirst.none}</p>
      ) : (
        <>
          <p className="muted">{f.fixFirst.lead}</p>
          <ol className="fix-first">
            {top.map((group) => {
              const title = ruleTitle(group.ruleId, props.language);
              return (
                <li key={`${group.ruleId}:${group.module}`} className="fix-first__item">
                  <StatusChip status={group.severity} label={f.severity[group.severity]} />
                  <span className="fix-first__title">{title}</span>
                  <span className="muted fix-first__count">
                    {f.fixFirst.pages(group.openIssues)}
                  </span>
                  <Button
                    onClick={() => props.onOpenProblem(group.ruleId)}
                    aria-label={f.issues.showFindingsFor(title)}
                  >
                    {f.fixFirst.open}
                  </Button>
                </li>
              );
            })}
          </ol>
          {open.length > top.length ? (
            <div className="button-row fix-first__more">
              <Button onClick={props.onAll}>{f.fixFirst.all(open.length)}</Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export function ScanChangesBlock(props: { scanId: string; language: Language }) {
  const f = findingsCopy[props.language];
  const [changes, setChanges] = useState<ScanChanges | null>(null);
  useEffect(() => {
    let current = true;
    apiRequest<ScanChanges>(`/scans/${encodeURIComponent(props.scanId)}/changes`)
      .then((value) => {
        if (current && typeof value?.fixed === 'number') setChanges(value);
      })
      .catch((caught: unknown) => {
        console.error('FluxRadar scan changes unavailable', caught);
      });
    return () => {
      current = false;
    };
  }, [props.scanId]);
  if (changes === null) return null;
  if (changes.previous === null) {
    return (
      <section className="report-block" aria-labelledby="changes-heading">
        <h3 id="changes-heading">{f.changes.heading}</h3>
        <p className="muted">{f.changes.firstReport}</p>
      </section>
    );
  }
  const title = (ruleId: string) => ruleTitle(ruleId, props.language);
  return (
    <section className="report-block" aria-labelledby="changes-heading">
      <h3 id="changes-heading">{f.changes.heading}</h3>
      <p className="muted">
        {f.changes.since(formatDate(changes.previous.completedAt, props.language))}
      </p>
      <div className="changes-grid">
        <div className="changes-stat changes-stat--fixed">
          <strong>{changes.fixed}</strong>
          {f.changes.fixed}
        </div>
        <div className="changes-stat changes-stat--introduced">
          <strong>{changes.introduced}</strong>
          {f.changes.introduced}
        </div>
        <div className="changes-stat">
          <strong>{changes.persisting}</strong>
          {f.changes.persisting}
        </div>
      </div>
      {changes.fixedByRule.length > 0 || changes.introducedByRule.length > 0 ? (
        <div className="changes-lists">
          {changes.fixedByRule.length > 0 ? (
            <div>
              <h4>{f.changes.fixedList}</h4>
              <ul>
                {changes.fixedByRule.slice(0, FIX_FIRST_LIMIT).map((rule) => (
                  <li key={rule.ruleId}>
                    {title(rule.ruleId)} — {rule.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {changes.introducedByRule.length > 0 ? (
            <div>
              <h4>{f.changes.introducedList}</h4>
              <ul>
                {changes.introducedByRule.slice(0, FIX_FIRST_LIMIT).map((rule) => (
                  <li key={rule.ruleId}>
                    {title(rule.ruleId)} — {rule.count}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
 * The report's next-step blocks, in order: what to fix first, then either what
 * changed since the last scan (a paid report) or what the free check left
 * unread (a Free one).
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
}) {
  const summary = useIssueSummary(props.scan.id);
  // A ready plan in the selected language takes FixFirst's place: it says the
  // same thing in more useful words, and two "start here" lists would compete.
  const [planReady, setPlanReady] = useState(false);
  // Null until the summary arrives: "this report has nothing left to plan" is a
  // statement, and the plan block must not make it while it is still loading.
  const hasOpenIssues = summary === null ? null : hasPlannableOpenIssues(summary);
  return (
    <>
      {props.onRetry !== undefined && canRetrySection(props.scan) ? (
        <SectionRetry language={props.language} onRetry={props.onRetry} />
      ) : null}
      <ActionPlan
        scan={props.scan}
        language={props.language}
        targetLanguages={props.targetLanguages}
        onOpenProblem={props.onOpenProblem}
        onUpgrade={props.onUpgrade}
        hasOpenIssues={hasOpenIssues}
        onPlanReadyChange={setPlanReady}
      />
      {summary === null || planReady ? null : (
        <FixFirst
          summary={summary}
          language={props.language}
          onOpenProblem={props.onOpenProblem}
          onAll={props.onAllProblems}
        />
      )}
      {props.scan.plan === 'Free' ? (
        <FreeUpsell scan={props.scan} language={props.language} onUpgrade={props.onUpgrade} />
      ) : (
        <ScanChangesBlock scanId={props.scan.id} language={props.language} />
      )}
    </>
  );
}
