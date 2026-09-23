// What the Bing section concludes, as findings a reader can act on.
//
// Each check states a fact Bing's own numbers support and nothing beyond it.
// None of them scores: Bing coverage is informational in this release, so the
// findings are reported beside the data and are never turned into a penalty —
// which also means a site with no Bing connection is not marked down for it.
//
// They are deliberately NOT expressed as Google's rules: Bing's
// `AvgImpressionPosition` is its own measurement, computed over its own index,
// and comparing it numerically with Search Console's `position` would produce a
// difference that means nothing.

import type { BingDataSnapshot, BingQueryDetail, BingSiteSummary } from './types.ts';

/** A finding of the Bing section: an observation plus what to do about it. */
export interface BingFinding {
  readonly code: BingFindingCode;
  readonly severity: 'info' | 'attention';
  readonly summary: string;
  readonly recommendation: string;
  /** The numbers the sentence was derived from, for the report and the export. */
  readonly evidence: Readonly<Record<string, number | string | null>>;
}

export const BING_FINDING_CODES = [
  'BING-TRAFFIC-DROP',
  'BING-NO-CLICKS',
  'BING-LOW-CTR',
  'BING-PARTIAL-PERIOD',
  'BING-QUERY-CONCENTRATION',
  'BING-READ-UNAVAILABLE',
] as const;

export type BingFindingCode = (typeof BING_FINDING_CODES)[number];

/** A period-over-period fall this size is reported; below it is ordinary noise. */
const TRAFFIC_DROP_RATIO = 0.3;
/** Impressions below this make every rate derived from them meaningless. */
const MIN_IMPRESSIONS_FOR_RATE = 200;
/** Click-through below this, over enough impressions, is worth naming. */
const LOW_CTR = 0.01;
/** A period this incompletely reported is stated rather than silently averaged. */
const PARTIAL_PERIOD_DAYS = 21;
/** One query taking this share of all clicks is a concentration worth naming. */
const CONCENTRATION_SHARE = 0.6;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function trafficDrop(summary: BingSiteSummary): BingFinding | null {
  const previous = summary.previousTotals;
  if (summary.totals === null || previous === null || previous.clicks === 0) return null;
  const change = (summary.totals.clicks - previous.clicks) / previous.clicks;
  if (change > -TRAFFIC_DROP_RATIO) return null;
  return {
    code: 'BING-TRAFFIC-DROP',
    severity: 'attention',
    summary: `Bing clicks fell ${percent(Math.abs(change))} against the previous period.`,
    recommendation:
      'Check Bing Webmaster Tools for crawl or indexing changes on the pages that used to ' +
      'receive these clicks, and confirm they are still reachable and indexable.',
    evidence: {
      clicks: summary.totals.clicks,
      previousClicks: previous.clicks,
      changeRatio: Number(change.toFixed(4)),
    },
  };
}

function noClicks(summary: BingSiteSummary): BingFinding | null {
  if (summary.totals === null) return null;
  const { clicks, impressions } = summary.totals;
  if (clicks > 0 || impressions < MIN_IMPRESSIONS_FOR_RATE) return null;
  return {
    code: 'BING-NO-CLICKS',
    severity: 'attention',
    summary: `Bing showed this site ${impressions} times in the period and sent no clicks.`,
    recommendation:
      'Review the titles and descriptions Bing displays for the pages that are being shown: ' +
      'impressions without clicks usually means the snippet does not answer the query.',
    evidence: { impressions, clicks },
  };
}

function lowCtr(summary: BingSiteSummary): BingFinding | null {
  if (summary.totals === null) return null;
  const { clicks, impressions, ctr } = summary.totals;
  if (clicks === 0 || impressions < MIN_IMPRESSIONS_FOR_RATE || ctr >= LOW_CTR) return null;
  return {
    code: 'BING-LOW-CTR',
    severity: 'attention',
    summary: `Bing click-through is ${percent(ctr)} over ${impressions} impressions.`,
    recommendation:
      'Compare the titles and meta descriptions of the top Bing queries with what a searcher ' +
      'asked for; a click-through this low is usually a snippet problem, not a ranking one.',
    evidence: { clicks, impressions, ctr: Number(ctr.toFixed(4)) },
  };
}

/**
 * Bing returns whatever days it retained, which for a newly added site is fewer
 * than the window. Saying so is what keeps the totals from being read as a
 * full-period figure.
 */
function partialPeriod(summary: BingSiteSummary, windowDays: number): BingFinding | null {
  // A failed traffic read is not a short history, and saying "Bing reported 0 of
  // 28 days" for one would describe our outage as the site's.
  if (summary.totals === null || summary.totals.days >= PARTIAL_PERIOD_DAYS) return null;
  return {
    code: 'BING-PARTIAL-PERIOD',
    severity: 'info',
    summary: `Bing reported ${summary.totals.days} of the ${windowDays} days in this period.`,
    recommendation:
      'Treat these totals as covering the days listed rather than the whole period. A site ' +
      'recently added to Bing Webmaster Tools reports fewer days until its history builds up.',
    evidence: { reportedDays: summary.totals.days, windowDays },
  };
}

/**
 * One query taking most of the period's clicks.
 *
 * Both halves of the fraction come from the same place: the period's per-query
 * totals (snapshot.ts), one row per query. They used to come from Bing's raw
 * daily rows over its whole retained history, so the "share of this site's Bing
 * clicks" was a day of one query over an unbounded number of days of all of
 * them — a number an owner would have acted on.
 *
 * When the query list is not the period's whole truth, the sentence says what
 * the share is actually over instead of claiming the site's total.
 *
 * Without the detail there is no whole truth to claim: `summary.topQueries` is
 * capped at the leaderboard's length, so a caller that recomputes findings from
 * the stored snapshot alone (the detail is deliberately never persisted) gets
 * the share over the queries it can see, stated as such.
 */
function queryConcentration(
  summary: BingSiteSummary,
  detail: BingQueryDetail | null,
): BingFinding | null {
  const queries = detail?.queries ?? summary.topQueries ?? [];
  const complete = detail !== null && detail.queriesComplete;
  const totalClicks = queries.reduce((sum, row) => sum + row.clicks, 0);
  const leader = queries.reduce<(typeof queries)[number] | null>(
    (best, row) => (best === null || row.clicks > best.clicks ? row : best),
    null,
  );
  if (leader === null || totalClicks === 0 || leader.clicks === 0) return null;
  const share = leader.clicks / totalClicks;
  if (share < CONCENTRATION_SHARE || queries.length < 2) return null;
  return {
    code: 'BING-QUERY-CONCENTRATION',
    severity: 'info',
    summary: complete
      ? `One query brings ${percent(share)} of this site's Bing clicks in this period.`
      : `One query brings ${percent(share)} of the clicks across the ${queries.length} queries ` +
        'Bing listed for this period.',
    recommendation:
      'Traffic resting on a single query is fragile. Look for the next queries the site already ' +
      'gets impressions for and give each one a page that answers it directly.',
    evidence: {
      query: leader.query,
      queryClicks: leader.clicks,
      totalClicks,
      share: Number(share.toFixed(4)),
      queriesCounted: queries.length,
      queriesComplete: complete ? 'yes' : 'no',
    },
  };
}

/**
 * Which half of the section Bing did not answer.
 *
 * Reported as a finding rather than left to the section's detail sentence, so a
 * reader scanning the list is told that a number they expected is missing for a
 * reason that is ours, not the site's.
 */
const READ_LABELS: Readonly<Record<'traffic' | 'queries', string>> = {
  traffic: 'daily clicks and impressions',
  queries: 'the top search queries',
};

function unavailableReads(summary: BingSiteSummary): BingFinding | null {
  if (summary.unavailableReads.length === 0) return null;
  const missing = summary.unavailableReads.map((read) => READ_LABELS[read]).join(' and ');
  return {
    code: 'BING-READ-UNAVAILABLE',
    severity: 'info',
    summary: `Bing did not return ${missing} for this period.`,
    recommendation:
      'Nothing on the site caused this. The figures that are missing are left blank rather than ' +
      'shown as zero; the next scan asks Bing again.',
    evidence: { unavailableReads: summary.unavailableReads.join(', ') },
  };
}

/**
 * Every finding the Bing data supports, in report order. Returns an empty list
 * for a snapshot with no data — an unavailable section explains itself through
 * its state and must not also produce findings about numbers nobody has.
 */
export function bingFindings(
  snapshot: BingDataSnapshot,
  detail: BingQueryDetail | null,
): readonly BingFinding[] {
  const summary = snapshot.webmaster.data;
  if (summary === null) return [];
  const windowDays =
    Math.round(
      (Date.parse(`${snapshot.dateRange.endDate}T00:00:00Z`) -
        Date.parse(`${snapshot.dateRange.startDate}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000),
    ) + 1;
  return [
    unavailableReads(summary),
    trafficDrop(summary),
    noClicks(summary),
    lowCtr(summary),
    partialPeriod(summary, windowDays),
    queryConcentration(summary, detail),
  ].filter((finding): finding is BingFinding => finding !== null);
}
