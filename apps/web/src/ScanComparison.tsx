// What changed since the previous scan of this site.
//
// The report answered "how is my site", and a customer who has just spent a week
// on fixes is asking a different question: did any of it work. This panel is that
// answer — score movement per section, pages that appeared and went, findings
// that are new, resolved or back — and it is held to one rule throughout: it
// shows a difference only where the server said the two scans are comparable.
// Everywhere else it prints the reason, because a reader who is shown "0 pages
// removed" cannot tell it from "we did not look".
//
// It is offered only to the plans that carry finding history (`issueHistory`),
// mirrored from the tariff table in plan-modules.ts. The server refuses the
// endpoint without it; this is the UI agreeing rather than asking and hiding a
// 403.

import { useEffect, useState } from 'react';

import type { Scan } from './api';
import {
  fetchScanComparison,
  type CrawlScopeFacts,
  type FirstCheckedFindings,
  type IssueCounts,
  type IssueSample,
  type ModuleScoreDelta,
  type PageComparison,
  type ScanComparison,
} from './comparison-api';
import { Button, Panel } from './components';
import { findingsCopy } from './findings-copy';
import { formatDate } from './format-date';
import { movement, scoreText, type ComparisonCopy } from './comparison-format';
import { copy, fillCopy, type Language } from './i18n';
import { planIncludesIssueHistory, planName } from './plan-modules';
import { moduleLabel, ruleTitle } from './rule-titles';
import './styles/comparison.css';
import './styles/findings.css';

/** Loading is a third state: an empty panel is not "nothing changed". */
type State =
  { kind: 'loading' } | { kind: 'ready'; comparison: ScanComparison } | { kind: 'unavailable' };

export function ScanComparisonPanel(props: {
  readonly scan: Scan;
  readonly language: Language;
  /** Opens another report in place; absent leaves the previous scan unlinked. */
  readonly onOpenScan?: (scanId: string) => void;
}) {
  const t = copy[props.language].report.comparison;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const scanId = props.scan.id;
  const supported = planIncludesIssueHistory(props.scan.plan);

  useEffect(() => {
    if (!supported) return;
    let current = true;
    setState({ kind: 'loading' });
    void fetchScanComparison(scanId).then((comparison) => {
      if (!current) return;
      setState(comparison === null ? { kind: 'unavailable' } : { kind: 'ready', comparison });
    });
    return () => {
      current = false;
    };
  }, [scanId, supported]);

  // Free and Basic buy no finding history, so there is no previous scan for
  // them to be compared with. Nothing is shown rather than a locked panel.
  if (!supported) return null;
  if (state.kind === 'loading') return null;
  if (state.kind === 'unavailable') {
    return (
      <Panel title={t.heading}>
        <p className="muted" role="status">
          {t.unavailable}
        </p>
      </Panel>
    );
  }
  return (
    <Panel title={t.heading}>
      <ComparisonBody
        comparison={state.comparison}
        language={props.language}
        onOpenScan={props.onOpenScan}
      />
    </Panel>
  );
}

function ComparisonBody(props: {
  readonly comparison: ScanComparison;
  readonly language: Language;
  readonly onOpenScan?: (scanId: string) => void;
}) {
  const t = copy[props.language].report.comparison;
  const { comparison } = props;
  const { previous } = comparison;
  if (previous === null) {
    return (
      <p className="muted" role="status">
        {comparison.comparable.ok === false && comparison.comparable.reason !== 'no-previous-scan'
          ? t.reason[comparison.comparable.reason]
          : fillCopy(t.firstReport, { plan: planName(comparison.current.plan) })}
      </p>
    );
  }
  return (
    <>
      <p className="muted">
        {fillCopy(t.since, {
          plan: planName(previous.plan),
          date: formatDate(previous.completedAt, props.language),
        })}
      </p>
      {/* A previous report whose payment was reversed is still the scan this
          report's Resolved statuses were written against, so it is still named —
          but it is no longer the owner's to open, and offering the link would
          send them into a 403. The server states nothing else about it: the
          verdict below is `previous-not-readable` and every section is empty. */}
      {props.onOpenScan === undefined || !previous.readable ? null : (
        <div className="button-row">
          <Button onClick={() => props.onOpenScan?.(previous.id)}>{t.openPrevious}</Button>
        </div>
      )}
      {comparison.comparable.ok ? (
        <>
          <Scores comparison={comparison} language={props.language} />
          <Pages pages={comparison.pages} language={props.language} />
          <Findings comparison={comparison} language={props.language} />
          <FirstChecked firstChecked={comparison.issues.firstChecked} language={props.language} />
        </>
      ) : (
        <section aria-labelledby="comparison-reason">
          <h4 id="comparison-reason">{t.notComparableHeading}</h4>
          <p role="status">{t.reason[comparison.comparable.reason]}</p>
          {/* `previous.readable` is what makes the previous scope readable at
              all: an unreadable previous report has no scope in the payload, and
              never reaches `scope-changed` — the verdict names the payment
              first. */}
          {comparison.comparable.reason === 'scope-changed' && previous.readable ? (
            <ScopeChanges
              current={comparison.current.scope}
              previous={previous.scope}
              language={props.language}
            />
          ) : null}
        </section>
      )}
    </>
  );
}

type ScopeField = keyof ComparisonCopy['scopeField'];
type UnsetScopeField = keyof ComparisonCopy['scopeUnset'];

/**
 * The three scope settings that can be blank, and mean something of their own.
 *
 * "Not set" is not one sentence: a missing page ceiling means the plan's own
 * limit applies, a missing depth means none does, and a missing crawl location
 * means the default one — which is how "Crawl location: whole plan → ua" got in
 * front of a reader.
 */
function isUnsetScopeField(field: ScopeField): field is UnsetScopeField & ScopeField {
  return field === 'maxPages' || field === 'maxDepth' || field === 'egressLocation';
}

/** A scope value as a reader would name it, never as the JSON spells it. */
function scopeValue(field: ScopeField, value: unknown, t: ComparisonCopy): string {
  if (value === null || value === undefined) {
    return isUnsetScopeField(field) ? t.scopeUnset[field] : t.scopeNotSet;
  }
  if (typeof value === 'boolean') return value ? t.scopeOn : t.scopeOff;
  if (Array.isArray(value)) return value.length === 0 ? t.scopeNone : value.join(', ');
  return String(value);
}

/**
 * Which settings differ, named one per line.
 *
 * The verdict says the scope changed; without this the reader has to diff two
 * scan screens by eye to find out what they changed and when.
 */
function ScopeChanges(props: {
  readonly current: CrawlScopeFacts;
  readonly previous: CrawlScopeFacts;
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  const fields: readonly ScopeField[] = [
    'entryUrl',
    'maxPages',
    'maxDepth',
    'includeSubdomains',
    'urlPatterns',
    'excludePatterns',
    'seedUrls',
    'queryPolicy',
    'renderJs',
    'respectRobots',
    'userAgent',
    'egressLocation',
  ];
  const changed = fields.filter(
    (field) =>
      scopeValue(field, props.current[field], t) !== scopeValue(field, props.previous[field], t),
  );
  if (changed.length === 0) return null;
  return (
    <>
      <h5>{t.scopeChangedHeading}</h5>
      <ul className="comparison-scope">
        {changed.map((field) => (
          <li key={field}>
            {fillCopy(t.scopeChangedRow, {
              field: t.scopeField[field],
              previous: scopeValue(field, props.previous[field], t),
              current: scopeValue(field, props.current[field], t),
            })}
          </li>
        ))}
      </ul>
    </>
  );
}

function ScoreRow(props: {
  readonly label: string;
  readonly previousScore: number | null;
  readonly currentScore: number | null;
  readonly delta: number | null;
  readonly note: string | null;
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  const direction = movement(props.delta, t);
  const kind = props.delta === null || props.delta === 0 ? 'same' : props.delta > 0 ? 'up' : 'down';
  return (
    <li className={`comparison-score comparison-score--${kind}`}>
      <strong>{props.label}</strong>
      <span className="technical">
        {fillCopy(t.scoreMove, {
          previous: scoreText(props.previousScore, t),
          current: scoreText(props.currentScore, t),
        })}
      </span>
      <span>{direction ?? props.note ?? ''}</span>
    </li>
  );
}

function Scores(props: { readonly comparison: ScanComparison; readonly language: Language }) {
  const t = copy[props.language].report.comparison;
  const { overall, modules } = props.comparison;
  return (
    <section aria-labelledby="comparison-scores">
      <h4 id="comparison-scores">{t.scoresHeading}</h4>
      <ul className="comparison-scores">
        <ScoreRow
          label={t.overall}
          previousScore={overall.previousScore}
          currentScore={overall.currentScore}
          delta={overall.delta}
          note={null}
          language={props.language}
        />
        {modules.map((module: ModuleScoreDelta) => (
          <ScoreRow
            key={module.module}
            label={moduleLabel(module.module, props.language)}
            previousScore={module.previousScore}
            currentScore={module.currentScore}
            delta={module.delta}
            note={module.comparable.ok ? null : t.moduleReason[module.comparable.reason]}
            language={props.language}
          />
        ))}
      </ul>
    </section>
  );
}

/** One number with its label; the same tile the "since last scan" block uses. */
function Stat(props: { readonly value: number; readonly label: string; readonly kind?: string }) {
  return (
    <div
      className={`changes-stat${props.kind === undefined ? '' : ` changes-stat--${props.kind}`}`}
    >
      <strong>{props.value}</strong>
      {props.label}
    </div>
  );
}

function SampleList(props: {
  readonly id: string;
  readonly heading: string;
  readonly total: number;
  readonly items: readonly string[];
  readonly showLabel: string;
  readonly hideLabel: string;
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  const [open, setOpen] = useState(false);
  if (props.items.length === 0) return null;
  return (
    <div>
      <Button aria-expanded={open} aria-controls={props.id} onClick={() => setOpen(!open)}>
        {open ? props.hideLabel : `${props.showLabel} · ${props.heading}`}
      </Button>
      {open ? (
        <div id={props.id}>
          <p className="muted">
            {fillCopy(t.sampleNote, { shown: props.items.length, total: props.total })}
          </p>
          <ul className="comparison-sample">
            {props.items.map((item) => (
              <li key={item} className="technical">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Pages(props: { readonly pages: PageComparison; readonly language: Language }) {
  const t = copy[props.language].report.comparison;
  const { pages } = props;
  return (
    <section aria-labelledby="comparison-pages">
      <h4 id="comparison-pages">{t.pagesHeading}</h4>
      {pages.comparable.ok ? (
        <>
          <div className="comparison-grid">
            <Stat value={pages.added} label={t.pagesAdded} kind="introduced" />
            <Stat value={pages.removed} label={t.pagesRemoved} />
            <Stat value={pages.kept} label={t.pagesKept} />
          </div>
          <p className="muted">
            {fillCopy(t.pagesTotals, {
              current: pages.currentTotal,
              previous: pages.previousTotal,
            })}
          </p>
          {pages.identity === null ? null : (
            <p className="muted">{t.pagesIdentity[pages.identity]}</p>
          )}
          <SampleList
            id="comparison-pages-added"
            heading={t.pagesAdded}
            total={pages.added}
            items={pages.addedSample}
            showLabel={t.showPages}
            hideLabel={t.hidePages}
            language={props.language}
          />
          <SampleList
            id="comparison-pages-removed"
            heading={t.pagesRemoved}
            total={pages.removed}
            items={pages.removedSample}
            showLabel={t.showPages}
            hideLabel={t.hidePages}
            language={props.language}
          />
        </>
      ) : (
        <p className="muted" role="status">
          {t.pagesReason[pages.comparable.reason]}
        </p>
      )}
    </section>
  );
}

function FindingSample(props: {
  readonly id: string;
  readonly heading: string;
  readonly total: number;
  readonly items: readonly IssueSample[];
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  const severityLabels = findingsCopy[props.language].severity;
  const [open, setOpen] = useState(false);
  if (props.items.length === 0) return null;
  return (
    <div>
      <Button aria-expanded={open} aria-controls={props.id} onClick={() => setOpen(!open)}>
        {open ? t.hideFindings : `${t.showFindings} · ${props.heading}`}
      </Button>
      {open ? (
        <div id={props.id}>
          <p className="muted">
            {fillCopy(t.sampleNote, { shown: props.items.length, total: props.total })}
          </p>
          <ul className="comparison-sample">
            {props.items.map((issue) => (
              <li key={issue.fingerprint}>
                {severityLabels[issue.severity] ?? issue.severity} ·{' '}
                {ruleTitle(issue.ruleId, props.language)} ·{' '}
                {moduleLabel(issue.module, props.language)}
                {issue.normalizedUrl === '' ? null : (
                  <>
                    {' · '}
                    <span className="technical">{issue.normalizedUrl}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CountsTable(props: {
  readonly heading: string;
  readonly firstColumn: string;
  readonly rows: readonly (IssueCounts & { readonly label: string })[];
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  if (props.rows.length === 0) return null;
  return (
    <>
      <h5>{props.heading}</h5>
      <table className="comparison-table">
        <thead>
          <tr>
            <th scope="col">{props.firstColumn}</th>
            <th scope="col">{t.issuesNew}</th>
            <th scope="col">{t.issuesResolved}</th>
            <th scope="col">{t.issuesReopened}</th>
            <th scope="col">{t.issuesStillOpen}</th>
            <th scope="col">{t.issuesSettled}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.new}</td>
              <td>{row.resolved}</td>
              <td>{row.reopened}</td>
              <td>{row.stillOpen}</td>
              <td>{row.settled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** One column of counts — the first-checked breakdowns, which have no verdicts. */
function SimpleCountsTable(props: {
  readonly heading: string;
  readonly firstColumn: string;
  readonly rows: readonly { readonly label: string; readonly count: number }[];
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  if (props.rows.length === 0) return null;
  return (
    <>
      <h5>{props.heading}</h5>
      <table className="comparison-table">
        <thead>
          <tr>
            <th scope="col">{props.firstColumn}</th>
            <th scope="col">{t.columnFindings}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Rule ids as the reader knows them, so a note never prints SEO-TECH-011. */
function ruleList(ruleIds: readonly string[], language: Language): string {
  return ruleIds.map((ruleId) => ruleTitle(ruleId, language)).join(', ');
}

/**
 * Findings of checks that ran here for the first time.
 *
 * Held apart from "new" because the two answer different questions: one is what
 * changed on the site, the other is what the product started looking at. Folding
 * them together told an owner who had changed nothing that they had introduced
 * forty problems.
 */
function FirstChecked(props: {
  readonly firstChecked: FirstCheckedFindings;
  readonly language: Language;
}) {
  const t = copy[props.language].report.comparison;
  const severityLabels = findingsCopy[props.language].severity;
  const { firstChecked } = props;
  if (firstChecked.count === 0) return null;
  return (
    <section aria-labelledby="comparison-first-checked">
      <h4 id="comparison-first-checked">{t.issuesFirstChecked}</h4>
      <p className="muted" role="status">
        {fillCopy(t.firstCheckedNote, {
          rules:
            firstChecked.ruleIds.length === 0
              ? ''
              : fillCopy(t.firstCheckedRules, {
                  list: ruleList(firstChecked.ruleIds, props.language),
                }),
        })}
      </p>
      <FindingSample
        id="comparison-findings-first-checked"
        heading={t.firstCheckedList}
        total={firstChecked.count}
        items={firstChecked.sample}
        language={props.language}
      />
      <SimpleCountsTable
        heading={t.bySeverityHeading}
        firstColumn={t.columnSeverity}
        rows={firstChecked.bySeverity.map((row) => ({
          label: severityLabels[row.severity] ?? row.severity,
          count: row.count,
        }))}
        language={props.language}
      />
      <SimpleCountsTable
        heading={t.byModuleHeading}
        firstColumn={t.columnModule}
        rows={firstChecked.byModule.map((row) => ({
          label: moduleLabel(row.module, props.language),
          count: row.count,
        }))}
        language={props.language}
      />
    </section>
  );
}

function Findings(props: { readonly comparison: ScanComparison; readonly language: Language }) {
  const t = copy[props.language].report.comparison;
  const severityLabels = findingsCopy[props.language].severity;
  const { issues } = props.comparison;
  return (
    <section aria-labelledby="comparison-findings">
      <h4 id="comparison-findings">{t.issuesHeading}</h4>
      <div className="comparison-grid">
        <Stat value={issues.new} label={t.issuesNew} kind="introduced" />
        <Stat value={issues.resolved} label={t.issuesResolved} kind="fixed" />
        <Stat value={issues.reopened} label={t.issuesReopened} />
        <Stat value={issues.stillOpen} label={t.issuesStillOpen} />
        <Stat value={issues.settled} label={t.issuesSettled} />
      </div>
      <p className="muted">{t.resolvedNote}</p>
      {/* Beside "New", because that is the number it qualifies: with the previous
          scan's proof gone, a finding of a check that shipped since is counted
          there instead of under "Checked for the first time". */}
      {issues.firstChecked.known ? null : (
        <p className="muted" role="status">
          {t.coverageUnknownNote}
        </p>
      )}
      {issues.settled > 0 ? <p className="muted">{t.settledNote}</p> : null}
      {issues.reopened > 0 ? <p className="muted">{t.reopenedNote}</p> : null}
      {issues.noLongerChecked.length === 0 ? null : (
        <p className="muted" role="status">
          {fillCopy(t.noLongerCheckedNote, {
            list: ruleList(issues.noLongerChecked, props.language),
          })}
        </p>
      )}
      <FindingSample
        id="comparison-findings-new"
        heading={t.newList}
        total={issues.new}
        items={issues.newSample}
        language={props.language}
      />
      <FindingSample
        id="comparison-findings-resolved"
        heading={t.resolvedList}
        total={issues.resolved}
        items={issues.resolvedSample}
        language={props.language}
      />
      <CountsTable
        heading={t.bySeverityHeading}
        firstColumn={t.columnSeverity}
        rows={issues.bySeverity.map((row) => ({
          ...row,
          label: severityLabels[row.severity] ?? row.severity,
        }))}
        language={props.language}
      />
      <CountsTable
        heading={t.byModuleHeading}
        firstColumn={t.columnModule}
        rows={issues.byModule.map((row) => ({
          ...row,
          label: moduleLabel(row.module, props.language),
        }))}
        language={props.language}
      />
    </section>
  );
}
