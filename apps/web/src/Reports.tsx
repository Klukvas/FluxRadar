// The Reports tab: every check this account has started, newest first.
//
// It exists because the tab used to land on the report of whichever scan
// happened to be selected — and on nothing at all when none was. A list is also
// the only screen that can honestly answer "where did my report go?", so its
// three unhappy states (loading, empty, failed) are as deliberate as the rows.

import { useCallback, useEffect, useState } from 'react';

import {
  apiRequestWithMeta,
  hasMorePages,
  nextPageOffset,
  type PageMeta,
  type Scan,
  type SiteProfile,
} from './api';
import { Button, EmptyState, Panel, SkeletonRows, StatusChip, Window } from './components';
import { copy, fillCopy, type Language } from './i18n';
import {
  displayDomain,
  formatTimestamp,
  hasReadableReport,
  isTerminalScanStatus,
  scanStateLabel,
} from './scan-status';
import { statusKind } from './status-kind';
import { planName } from './plan-modules';

/**
 * How many reports one page holds.
 *
 * Below the API's own default so the "show older reports" control is reachable
 * on a normal account rather than being theoretical, and small enough that the
 * first screen paints from one short query.
 */
const PAGE_SIZE = 20;

export interface ReportsScreenProps {
  readonly language: Language;
  /** When set, the list is scoped to that profile instead of the whole account. */
  readonly profile: SiteProfile | null;
  readonly onOpenScan: (scan: Scan) => void;
  readonly onNewScan: () => void;
  readonly onShowAll: () => void;
}

interface ListState {
  readonly scans: readonly Scan[];
  readonly meta: PageMeta | null;
}

const EMPTY_LIST: ListState = { scans: [], meta: null };

export function ReportsScreen(props: ReportsScreenProps) {
  const t = copy[props.language].reports;
  const profileId = props.profile?.id ?? null;
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Held here rather than raised to the app-wide error dialog: a list that could
  // not load has somewhere to say so, and offering "try again" in place is a
  // better answer than an alert the owner has to dismiss before retrying.
  const [error, setError] = useState<string | null>(null);

  const pagePath = useCallback(
    (offset: number): string => {
      const query = `limit=${PAGE_SIZE}&offset=${offset}`;
      // Never `history=true`: the API reserves the full historical list for
      // accounts with a Complete scan and answers 403 otherwise, so asking for
      // it would turn an ordinary list into an error for a Basic-only owner.
      return profileId === null ? `/scans?${query}` : `/profiles/${profileId}/scans?${query}`;
    },
    [profileId],
  );

  const loadFirstPage = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const page = await apiRequestWithMeta<Scan[]>(pagePath(0));
      setList({ scans: page.data, meta: page.meta });
    } catch (caught) {
      setList(EMPTY_LIST);
      setError(caught instanceof Error ? caught.message : t.errorTitle);
    } finally {
      setLoading(false);
    }
  }, [pagePath, t.errorTitle]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadNextPage = async (): Promise<void> => {
    setLoadingMore(true);
    setError(null);
    try {
      const page = await apiRequestWithMeta<Scan[]>(pagePath(nextPageOffset(list.meta)));
      // Appended, never replaced: paging forward adds to what the owner is
      // already reading rather than swapping the list under them.
      setList((current) => ({ scans: [...current.scans, ...page.data], meta: page.meta }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.errorTitle);
    } finally {
      setLoadingMore(false);
    }
  };

  const heading =
    props.profile === null ? t.heading : fillCopy(t.profileHeading, { name: props.profile.name });
  const lead =
    props.profile === null
      ? t.lead
      : fillCopy(t.profileLead, { domain: displayDomain(props.profile.domain) });

  return (
    <div className="stack">
      <Window title={t.windowTitle}>
        <div className="split">
          <div>
            <h2 className="section-heading">{heading}</h2>
            <p className="muted">{lead}</p>
          </div>
          <div className="button-row">
            {props.profile === null ? null : <Button onClick={props.onShowAll}>{t.showAll}</Button>}
            <Button onClick={() => void loadFirstPage()} disabled={loading}>
              {t.refresh}
            </Button>
          </div>
        </div>
        <ReportsBody
          language={props.language}
          list={list}
          loading={loading}
          error={error}
          scoped={props.profile !== null}
          onRetry={() => void loadFirstPage()}
          onNewScan={props.onNewScan}
          onOpenScan={props.onOpenScan}
        />
        {loading || error !== null || list.scans.length === 0 ? null : (
          <div className="split reports-footer">
            <span className="muted">
              {fillCopy(t.showingCount, {
                shown: list.scans.length,
                total: list.meta?.total ?? list.scans.length,
              })}
            </span>
            {hasMorePages(list.meta) ? (
              <Button onClick={() => void loadNextPage()} disabled={loadingMore}>
                {loadingMore ? t.loadingMore : t.showMore}
              </Button>
            ) : null}
          </div>
        )}
      </Window>
    </div>
  );
}

function ReportsBody(props: {
  language: Language;
  list: ListState;
  loading: boolean;
  error: string | null;
  scoped: boolean;
  onRetry: () => void;
  onNewScan: () => void;
  onOpenScan: (scan: Scan) => void;
}) {
  const t = copy[props.language].reports;
  if (props.loading) return <SkeletonRows rows={3} />;
  if (props.error !== null) {
    return (
      <Panel title={t.errorTitle}>
        <p className="muted" role="alert">
          {props.error}
        </p>
        <div className="button-row">
          <Button variant="primary" onClick={props.onRetry}>
            {t.retry}
          </Button>
        </div>
      </Panel>
    );
  }
  if (props.list.scans.length === 0) {
    return (
      <EmptyState
        title={props.scoped ? t.emptyProfileTitle : t.emptyTitle}
        description={props.scoped ? t.emptyProfileBody : t.emptyBody}
        action={
          <Button variant="primary" onClick={props.onNewScan}>
            {t.emptyAction}
          </Button>
        }
      />
    );
  }
  return (
    <ul className="report-list" aria-label={t.heading}>
      {props.list.scans.map((scan) => (
        <li key={scan.id}>
          <ReportRow scan={scan} language={props.language} onOpen={() => props.onOpenScan(scan)} />
        </li>
      ))}
    </ul>
  );
}

function ReportRow(props: { scan: Scan; language: Language; onOpen: () => void }) {
  const t = copy[props.language].reports;
  const { scan } = props;
  const terminal = isTerminalScanStatus(scan.status);
  const finished = formatTimestamp(scan.completedAt, props.language);
  const started = formatTimestamp(scan.startedAt ?? scan.createdAt, props.language);
  const actionLabel = !terminal
    ? t.followProgress
    : hasReadableReport(scan.status)
      ? t.openReport
      : t.viewDetails;
  return (
    // The card carries the status a second time, as the colour of its left
    // edge, so a list of twenty reports can be scanned for the failed one
    // without reading twenty chips. Colour is never the only carrier: the chip
    // beside the action says the same thing in words.
    <div className={`report-row report-row--${statusKind(scan.status)}`}>
      <div className="report-row__copy">
        <strong className="report-row__domain">{displayDomain(scan.domain)}</strong>
        <p className="muted report-row__meta">
          {planName(scan.plan)}
          {scan.profileConfigVersion === undefined ? '' : ` · v${scan.profileConfigVersion}`}
          {finished !== null
            ? ` · ${fillCopy(t.finishedAt, { time: finished })}`
            : started !== null
              ? ` · ${fillCopy(t.startedAt, { time: started })}`
              : ''}
        </p>
      </div>
      {/* How the check ended and what to do about it are one pair on one line.
          Read apart — the chip beside the address, the button in a column
          centred on the whole card — they only lined up when the address
          happened to fit one line, which is the same drift the integrations
          row was fixed for. */}
      <div className="report-row__action">
        <StatusChip status={scan.status} label={scanStateLabel(scan.status, props.language)} />
        {/* Every row's button reads the same on screen, so the accessible name
            carries the site address too — otherwise a screen reader announces a list
            of identical "Open report" buttons with no way to tell them apart.
            The visible text stays the start of the name (WCAG 2.5.3). */}
        <Button
          variant="primary"
          onClick={props.onOpen}
          aria-label={`${actionLabel} · ${displayDomain(scan.domain)}`}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
