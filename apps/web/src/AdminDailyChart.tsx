// The owner dashboard's per-day chart: one small bar chart per series, sharing
// the window's days, so a spike in sign-ups can be read against scans and
// purchases on the same day. English only, like the dashboard around it.

import type { DailyPoint } from './admin-stats';

const countFormat = new Intl.NumberFormat('en');

function formatCount(value: number): string {
  return countFormat.format(value);
}

const DAILY_SERIES = [
  { key: 'accounts', title: 'New accounts per day' },
  { key: 'scans', title: 'Scans per day' },
  { key: 'purchases', title: 'Purchases per day' },
] as const;

export function DailyCharts({ daily }: { daily: readonly DailyPoint[] }) {
  return (
    <section className="admin-stats__section admin-stats__charts" aria-label="Per day">
      {DAILY_SERIES.map((series) => (
        <DailyChart
          key={series.key}
          title={series.title}
          points={daily.map((point) => ({ day: point.day, value: point[series.key] }))}
        />
      ))}
    </section>
  );
}

/**
 * One series as bars in plain CSS: the tallest day fills the height and every
 * other day is drawn against it. The figure's accessible name carries what a
 * sighted reader takes from the shape — the total and the busiest day.
 */
function DailyChart(props: { title: string; points: readonly { day: string; value: number }[] }) {
  const values = props.points.map((point) => point.value);
  const peak = Math.max(0, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const first = props.points[0]?.day ?? '';
  const last = props.points[props.points.length - 1]?.day ?? '';
  return (
    <figure className="admin-chart">
      <figcaption className="admin-chart__caption">
        <span>{props.title}</span>
        <span>
          {formatCount(total)} total · peak {formatCount(peak)}
        </span>
      </figcaption>
      <div
        className="admin-chart__bars"
        role="img"
        aria-label={`${props.title}, ${first} to ${last}: ${formatCount(total)} in total, at most ${formatCount(peak)} on one day.`}
      >
        {props.points.map((point) => (
          <span
            key={point.day}
            className="admin-chart__bar"
            data-empty={point.value === 0}
            style={{ height: peak === 0 ? '0%' : `${(point.value / peak) * 100}%` }}
            title={`${point.day}: ${formatCount(point.value)}`}
          />
        ))}
      </div>
      <div className="admin-chart__axis technical" aria-hidden="true">
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </figure>
  );
}
