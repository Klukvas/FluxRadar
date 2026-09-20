// The Issue Center: every finding of one report, with its evidence.
//
// It opens on problems, not findings. A rule broken on 400 pages used to be 400
// rows headlined by its id, in the order of the stored severity text — so Low
// sorted above Medium — and only the first 100 were ever fetched, then filtered
// in the browser, so a search quietly missed everything past them. Now the
// problems come from `/issues/summary`, most urgent first, and a problem opens
// onto its findings, which the API filters and pages.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  apiRequest,
  apiRequestWithMeta,
  type Issue,
  type IssueSummary,
  type PageMeta,
  type Scan,
} from './api';
import { Button, EmptyState, Field, SelectField, SkeletonRows, Window } from './components';
import { findingsCopy } from './findings-copy';
import { copy, type Language } from './i18n';
import { IssueProblems } from './IssueProblems';
import { IssueTable, USER_STATUSES } from './IssueTable';
import { moduleLabel, ruleTitle } from './rule-titles';
import { displayDomain } from './scan-status';
import './styles/findings.css';

/** Findings fetched per page; the API's own ceiling is 100. */
export const ISSUE_PAGE_SIZE = 50;

const SEVERITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'] as const;
const STATUS_OPTIONS = [...USER_STATUSES, 'Resolved', 'Reopened'] as const;
const SEARCH_DELAY_MS = 300;

interface IssueFilters {
  readonly ruleId: string;
  readonly severity: string;
  readonly module: string;
  readonly status: string;
  readonly search: string;
}

const NO_FILTERS: IssueFilters = { ruleId: '', severity: '', module: '', status: '', search: '' };

function issuesPath(scanId: string, filters: IssueFilters, offset: number): string {
  const query = new URLSearchParams({ limit: String(ISSUE_PAGE_SIZE), offset: String(offset) });
  for (const key of ['ruleId', 'severity', 'module', 'status', 'search'] as const) {
    const value = filters[key].trim();
    if (value !== '') query.set(key, value);
  }
  return `/scans/${encodeURIComponent(scanId)}/issues?${query.toString()}`;
}

/** A summary the screen can use, or null — an older API, or a mocked one, may send anything. */
function readableSummary(value: unknown): IssueSummary | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<IssueSummary>;
  return Array.isArray(candidate.groups) && typeof candidate.open === 'number'
    ? (candidate as IssueSummary)
    : null;
}

/**
 * `value`, settled for `delayMs`, and a way to settle it at once. The setter is
 * for a caller that replaces the value outright — opening a problem clears the
 * search, and the old term must not ride along on the first request while the
 * timer catches up.
 */
function useDebounced(value: string, delayMs: number): readonly [string, (next: string) => void] {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return [debounced, setDebounced] as const;
}

export function IssuesScreen(props: {
  scan: Scan | null;
  language: Language;
  onError: (value: string) => void;
  /** Opens straight onto one problem's findings, as "Fix these first" links do. */
  initialRuleId?: string | null;
  onNotice?: (value: string) => void;
}) {
  const t = copy[props.language].issues;
  const f = findingsCopy[props.language];
  const scanId = props.scan?.id ?? null;
  const { onError } = props;
  const [summary, setSummary] = useState<IssueSummary | null>(null);
  const [view, setView] = useState<'problems' | 'all'>(props.initialRuleId ? 'all' : 'problems');
  const [filters, setFilters] = useState<IssueFilters>({
    ...NO_FILTERS,
    ruleId: props.initialRuleId ?? '',
  });
  const [searchInput, setSearchInput] = useState('');
  const [search, settleSearch] = useDebounced(searchInput, SEARCH_DELAY_MS);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  // Filters change faster than the API answers; only the newest request may land.
  const requestSeq = useRef(0);

  const loadSummary = useCallback(() => {
    if (scanId === null) return;
    apiRequest<unknown>(`/scans/${encodeURIComponent(scanId)}/issues/summary`)
      .then((value) => setSummary(readableSummary(value)))
      .catch((caught: unknown) => {
        // The findings list below still works without the problem view.
        console.error('FluxRadar issue summary unavailable', caught);
        setSummary(null);
      });
  }, [scanId]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const activeFilters = { ...filters, search };
  const filterKey = JSON.stringify(activeFilters);
  useEffect(() => {
    if (scanId === null) {
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    apiRequestWithMeta<Issue[]>(issuesPath(scanId, JSON.parse(filterKey) as IssueFilters, 0))
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setIssues(page.data);
        setMeta(page.meta);
      })
      .catch((caught) => {
        if (seq !== requestSeq.current) return;
        onError(caught instanceof Error ? caught.message : 'Issues unavailable');
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [scanId, filterKey, onError]);

  const loadMore = async (): Promise<void> => {
    if (scanId === null) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const page = await apiRequestWithMeta<Issue[]>(
        issuesPath(scanId, activeFilters, issues.length),
      );
      if (seq !== requestSeq.current) return;
      setIssues((current) => [...current, ...page.data]);
      setMeta(page.meta);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Issues unavailable');
    } finally {
      setLoadingMore(false);
    }
  };

  const update = async (issue: Issue, status: string): Promise<void> => {
    try {
      const value = await apiRequest<Issue>(`/scans/${issue.scanId}/issues/${issue.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setIssues((current) =>
        current.map((candidate) => (candidate.id === value.id ? value : candidate)),
      );
      setSelectedIssue((current) => (current?.id === value.id ? value : current));
      // A problem's open count is what the problem view and the report show.
      loadSummary();
      props.onNotice?.(f.issues.statusUpdated);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Issue update failed');
    }
  };

  const openProblem = useCallback(
    (ruleId: string) => {
      setFilters({ ...NO_FILTERS, ruleId });
      setSearchInput('');
      settleSearch('');
      setSelectedIssue(null);
      setView('all');
    },
    [settleSearch],
  );
  const setFilter = (key: keyof IssueFilters, value: string): void => {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedIssue(null);
  };

  const domain = props.scan?.domain ? displayDomain(props.scan.domain) : t.noScan;
  const modules = [...new Set((summary?.groups ?? []).map((group) => group.module))];
  const total = meta?.total ?? issues.length;
  const showProblems = view === 'problems' && summary !== null;

  return (
    <Window title={`${t.windowTitle} · ${domain}`}>
      <div className="issues-head">
        <div>
          <h2 className="section-heading">{t.heading}</h2>
          <p className="muted">{f.issues.lead}</p>
          {summary === null ? null : (
            <p className="issues-summary-line" role="status">
              {summary.open === 0
                ? f.issues.summaryNone
                : f.issues.summaryLine(
                    summary.open,
                    summary.groups.filter((group) => group.openIssues > 0).length,
                  )}
            </p>
          )}
        </div>
        {summary === null ? null : (
          <div className="segmented" role="group" aria-label={f.issues.viewLabel}>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={view === 'problems'}
              onClick={() => setView('problems')}
            >
              {f.issues.viewProblems}
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={view === 'all'}
              onClick={() => setView('all')}
            >
              {f.issues.viewAll}
            </button>
          </div>
        )}
      </div>
      <p className="muted issue-severity-legend">
        <strong>{t.severityLegendTerm}</strong> {t.severityLegendBody}
      </p>
      {showProblems ? (
        <IssueProblems summary={summary} language={props.language} onOpen={openProblem} />
      ) : (
        <>
          <div className="issue-filters">
            <Field
              label={f.issues.searchLabel}
              technical
              value={searchInput}
              onChange={setSearchInput}
              placeholder={f.issues.searchPlaceholder}
            />
            <SelectField
              label={f.issues.severityFilter}
              value={filters.severity}
              onChange={(value) => setFilter('severity', value)}
              options={[
                { value: '', label: f.issues.any },
                ...SEVERITY_OPTIONS.map((value) => ({ value, label: f.severity[value] ?? value })),
              ]}
            />
            {modules.length > 1 ? (
              <SelectField
                label={f.issues.moduleFilter}
                value={filters.module}
                onChange={(value) => setFilter('module', value)}
                options={[
                  { value: '', label: f.issues.any },
                  ...modules.map((value) => ({ value, label: moduleLabel(value, props.language) })),
                ]}
              />
            ) : null}
            <SelectField
              label={f.issues.statusFilter}
              value={filters.status}
              onChange={(value) => setFilter('status', value)}
              options={[
                { value: '', label: f.issues.any },
                ...STATUS_OPTIONS.map((value) => ({ value, label: f.status[value] ?? value })),
              ]}
            />
          </div>
          {filters.ruleId === '' ? null : (
            <div className="issue-rule-filter">
              <strong>{f.issues.problemFilter(ruleTitle(filters.ruleId, props.language))}</strong>
              <Button onClick={() => setFilter('ruleId', '')}>{f.issues.clearProblem}</Button>
            </div>
          )}
          {loading ? (
            <SkeletonRows rows={3} />
          ) : issues.length === 0 ? (
            filterKey === JSON.stringify({ ...NO_FILTERS, search: '' }) ? (
              <EmptyState title={t.emptyAll} description={t.emptyAllBody} />
            ) : (
              <EmptyState title={t.emptyFiltered} />
            )
          ) : (
            <>
              <p className="muted issues-count" role="status">
                {f.issues.showing(issues.length, total)}
              </p>
              <IssueTable
                issues={issues}
                language={props.language}
                selectedIssue={selectedIssue}
                onSelect={setSelectedIssue}
                onStatus={(issue, status) => void update(issue, status)}
              />
              {issues.length < total ? (
                <div className="button-row issues-more">
                  <Button onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore
                      ? f.issues.loadingMore
                      : f.issues.loadMore(Math.min(ISSUE_PAGE_SIZE, total - issues.length))}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </Window>
  );
}
