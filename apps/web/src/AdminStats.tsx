// The owner dashboard at /admin/stats: this deployment's business in numbers.
//
// English only, on purpose. The page is for the owner alone — linked from no
// menu, and a plain "Not available" to every other account — so a Ukrainian
// dictionary entry per label would be translation nobody reads. Every screen a
// customer sees still goes through i18n.ts.
//
// App mounts it only while it is the open screen, and it asks for its numbers
// only once mounted, so no other page's requests change because it exists.

import { useEffect, useState, type ReactNode } from 'react';

import {
  ADMIN_STATS_WINDOWS,
  DEFAULT_ADMIN_STATS_WINDOW,
  loadAdminStats,
  type AdminPeriodStats,
  type AdminStats,
  type AdminStatsResult,
  type AdminStatsWindow,
  type PlanCount,
  type RevenueLine,
  type StatusCount,
} from './admin-stats';
import { DailyCharts } from './AdminDailyChart';
import { Button, DataTable, EmptyState, Panel, SkeletonRows, Window } from './components';
// `.segmented`, the two-state switch the Issue Center already draws.
import './styles/findings.css';
import './styles/admin-stats.css';

const LOCALE = 'en';
const countFormat = new Intl.NumberFormat(LOCALE);
const percentFormat = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  maximumFractionDigits: 1,
});

type LoadState = { readonly kind: 'loading' } | AdminStatsResult;
/** Every state but "unavailable", which replaces the whole dashboard instead. */
type BodyState = Exclude<LoadState, { readonly kind: 'unavailable' }>;

const LOADING: LoadState = { kind: 'loading' };

function formatCount(value: number): string {
  return countFormat.format(value);
}

/**
 * Intl accepts any well-formed ISO code; the API's "unrecorded" bucket is not
 * one, so it gets the bare figure — the row's first cell already names it.
 */
function formatMoney(amount: number, currency: string): string {
  return /^[A-Z]{3}$/.test(currency)
    ? new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).format(amount)
    : amount.toFixed(2);
}

export function AdminStatsScreen() {
  const [days, setDays] = useState<AdminStatsWindow>(DEFAULT_ADMIN_STATS_WINDOW);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>(LOADING);

  useEffect(() => {
    // A slow answer for the window the owner just left must not replace the
    // one they switched to.
    let isCurrent = true;
    void loadAdminStats(days).then((result) => {
      if (isCurrent) setState(result);
    });
    return () => {
      isCurrent = false;
    };
  }, [days, attempt]);

  if (state.kind === 'unavailable') {
    return (
      <Window title="Not available">
        <EmptyState
          title="Not available"
          description="This page does not exist, or is not available to this account."
        />
      </Window>
    );
  }

  const chooseWindow = (next: AdminStatsWindow): void => {
    if (next === days) return;
    setState(LOADING);
    setDays(next);
  };
  const retry = (): void => {
    setState(LOADING);
    setAttempt((count) => count + 1);
  };

  return (
    <div className="stack admin-stats">
      <Window title="Owner dashboard">
        <div className="split">
          <div>
            <h2 className="section-heading">Business numbers</h2>
            <p className="muted">
              Counted in FluxRadar’s own database: every sign-up and every paid order, not only the
              visitors GA4 sees. Days are UTC. Test-mode orders are counted apart and never as
              revenue.
            </p>
          </div>
          <WindowSwitch days={days} onChoose={chooseWindow} />
        </div>
        <DashboardBody state={state} onRetry={retry} />
      </Window>
    </div>
  );
}

function WindowSwitch(props: {
  days: AdminStatsWindow;
  onChoose: (days: AdminStatsWindow) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Period">
      {ADMIN_STATS_WINDOWS.map((days) => (
        <button
          key={days}
          type="button"
          className="segmented__option"
          aria-pressed={props.days === days}
          onClick={() => props.onChoose(days)}
        >
          {days} days
        </button>
      ))}
    </div>
  );
}

function DashboardBody(props: { state: BodyState; onRetry: () => void }) {
  const { state } = props;
  if (state.kind === 'loading') return <SkeletonRows rows={4} />;
  if (state.kind === 'failed') {
    return (
      <Panel title="The numbers could not be loaded">
        <p className="muted" role="alert">
          {state.message}
        </p>
        <div className="button-row">
          <Button variant="primary" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      </Panel>
    );
  }
  return <Dashboard stats={state.stats} />;
}

function Dashboard({ stats }: { stats: AdminStats }) {
  const { period, allTime } = stats;
  const periodLabel = `Last ${stats.window.days} days`;
  return (
    <>
      <SummaryTiles period={period} allTime={allTime} />
      <section className="admin-stats__section admin-stats__pair" aria-label="Revenue">
        <RevenueTable title={`Revenue · ${periodLabel.toLowerCase()}`} lines={period.revenue} />
        <RevenueTable title="Revenue · all time" lines={allTime.revenue} />
      </section>
      <DailyCharts daily={stats.daily} />
      <Breakdowns period={period} allTime={allTime} periodLabel={periodLabel} />
      <p className="muted admin-stats__note">
        Test mode, {periodLabel.toLowerCase()} — checkouts opened:{' '}
        {formatCount(period.testMode.checkoutsOpened)}, orders paid:{' '}
        {formatCount(period.testMode.purchases)}. None of it is counted above.
      </p>
    </>
  );
}

function SummaryTiles({
  period,
  allTime,
}: {
  period: AdminPeriodStats;
  allTime: AdminPeriodStats;
}) {
  const { checkouts } = period;
  const conversion =
    checkouts.conversion === null ? 'no checkouts' : percentFormat.format(checkouts.conversion);
  return (
    <div className="admin-stats__tiles">
      <Tile title="New accounts" value={period.accounts.created} allTime={allTime.accounts.created}>
        {formatCount(period.accounts.verified)} confirmed their email
      </Tile>
      <Tile
        title="Free checks"
        value={period.freeChecks.claimed}
        allTime={allTime.freeChecks.claimed}
      />
      <Tile title="Scans" value={period.scans.created} allTime={allTime.scans.created} />
      <Tile title="Checkouts opened" value={checkouts.opened} allTime={allTime.checkouts.opened}>
        {formatCount(checkouts.completed)} paid · {formatCount(checkouts.rejected)} rejected ·{' '}
        {conversion}
      </Tile>
      <Tile
        title="Purchases"
        value={period.purchases.completed}
        allTime={allTime.purchases.completed}
      />
      <Tile title="Refunds" value={period.refunds.count} allTime={allTime.refunds.count} />
    </div>
  );
}

function Breakdowns(props: {
  period: AdminPeriodStats;
  allTime: AdminPeriodStats;
  periodLabel: string;
}) {
  const { period, allTime, periodLabel } = props;
  const byStatus = (rows: readonly StatusCount[]) =>
    rows.map((row) => [row.status, row.count] as const);
  const byPlan = (rows: readonly PlanCount[]) => rows.map((row) => [row.plan, row.count] as const);
  return (
    <section className="admin-stats__section admin-stats__pair" aria-label="Breakdowns">
      <Breakdown
        title="Scans by status"
        keyLabel="Status"
        periodLabel={periodLabel}
        period={byStatus(period.scans.byStatus)}
        allTime={byStatus(allTime.scans.byStatus)}
      />
      <Breakdown
        title="Scans by plan"
        keyLabel="Plan"
        periodLabel={periodLabel}
        period={byPlan(period.scans.byPlan)}
        allTime={byPlan(allTime.scans.byPlan)}
      />
      <Breakdown
        title="Purchases by status"
        keyLabel="Status"
        periodLabel={periodLabel}
        period={byStatus(period.purchases.byStatus)}
        allTime={byStatus(allTime.purchases.byStatus)}
      />
    </section>
  );
}

function Tile(props: { title: string; value: number; allTime: number; children?: ReactNode }) {
  return (
    <Panel title={props.title} className="admin-stats__tile">
      <strong className="admin-stats__value">{formatCount(props.value)}</strong>
      {props.children === undefined ? null : (
        <p className="muted admin-stats__detail">{props.children}</p>
      )}
      <p className="muted admin-stats__detail">All time: {formatCount(props.allTime)}</p>
    </Panel>
  );
}

function RevenueTable(props: { title: string; lines: readonly RevenueLine[] }) {
  return (
    <Panel title={props.title}>
      {props.lines.length === 0 ? (
        <p className="muted">No payments.</p>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>Currency</th>
              <th className="admin-stats__num">Gross</th>
              <th className="admin-stats__num">Refunded</th>
              <th className="admin-stats__num">Net</th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((line) => (
              <tr key={line.currency}>
                <td data-label="Currency" className="technical">
                  {line.currency}
                </td>
                <td data-label="Gross" className="admin-stats__num">
                  {formatMoney(line.gross, line.currency)}
                </td>
                <td data-label="Refunded" className="admin-stats__num">
                  {formatMoney(line.refunded, line.currency)}
                </td>
                <td data-label="Net" className="admin-stats__num">
                  {formatMoney(line.net, line.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}

/** One breakdown for the period and all time, keyed as the API spells them. */
function Breakdown(props: {
  title: string;
  keyLabel: string;
  periodLabel: string;
  period: readonly (readonly [string, number])[];
  allTime: readonly (readonly [string, number])[];
}) {
  const inPeriod = new Map(props.period);
  const ever = new Map(props.allTime);
  const keys = [...new Set([...ever.keys(), ...inPeriod.keys()])];
  return (
    <Panel title={props.title}>
      {keys.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>{props.keyLabel}</th>
              <th className="admin-stats__num">{props.periodLabel}</th>
              <th className="admin-stats__num">All time</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <td data-label={props.keyLabel} className="technical">
                  {key}
                </td>
                <td data-label={props.periodLabel} className="admin-stats__num">
                  {formatCount(inPeriod.get(key) ?? 0)}
                </td>
                <td data-label="All time" className="admin-stats__num">
                  {formatCount(ever.get(key) ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}
