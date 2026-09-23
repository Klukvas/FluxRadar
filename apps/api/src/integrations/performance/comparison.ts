// "Is it slower than last time?" — answered against the previous scan of the
// same site profile, and answered only where the two scans measured the same
// thing.
//
// FOUR RULES, ALL OF THEM ABOUT NOT LYING WITH A COMPARISON:
//
//   1. Same measurement context, or no comparison at all. Two audits are
//      comparable only when they were produced by the same audit version and by
//      the same major version of Lighthouse. A Lighthouse major release changes
//      the scoring curve and can move metric definitions, so "the score fell 12
//      points" across one is an artefact of the provider, not of the site — and
//      it is the kind of artefact a customer would spend a day chasing.
//   2. Same URL, same device, or no comparison. A mobile run of /pricing and a
//      desktop run of / are not two readings of one number.
//   3. Both a ratio and an absolute floor must be crossed. A TTFB that went from
//      8 ms to 12 ms is a 50% regression and means nothing; the floors in
//      thresholds.ts are what keep noise out.
//   4. A regression NEVER changes the score. Lighthouse's score already fell if
//      the site got slower — subtracting again for the same slowdown would
//      penalise one fact twice. Regressions are reported beside the score, as
//      context for it, and the audit's `score` is computed without them.

import { REGRESSION_MIN_ABSOLUTE, REGRESSION_RATIO } from './thresholds.ts';
import type {
  IncomparableDetail,
  LabMetricName,
  PerformanceAudit,
  PerformanceComparison,
  PerformanceRegression,
  UrlAudit,
} from './types.ts';

/**
 * Metrics where a larger number is worse. Deliberately excludes
 * `performanceScore`, where the direction is the other way round and which is
 * compared separately below.
 */
const LOWER_IS_BETTER: readonly LabMetricName[] = [
  'ttfbMs',
  'fcpMs',
  'lcpMs',
  'clsScore',
  'tbtMs',
  'speedIndexMs',
  'totalBytes',
  'requestCount',
];

/** The previous audit, with the scan it belongs to. */
export interface PreviousPerformance {
  readonly scanId: string;
  readonly observedAt: string | null;
  readonly audit: PerformanceAudit;
}

function medianFor(
  urls: readonly UrlAudit[],
  url: string,
  strategy: string,
  metric: LabMetricName,
): number | null {
  const device = urls
    .find((entry) => entry.url === url)
    ?.devices.find((candidate) => candidate.strategy === strategy);
  return device === undefined || device.usableSamples === 0 ? null : device.metrics[metric].median;
}

function crossesFloor(metric: LabMetricName, change: number): boolean {
  const floor = REGRESSION_MIN_ABSOLUTE[metric];
  return floor === undefined || Math.abs(change) >= floor;
}

/**
 * Every metric that moved materially for the worse since the previous scan.
 *
 * `performanceScore` is included with its direction inverted: a score that fell
 * by enough points is the single number most readers look at, and leaving it out
 * because "lower is better" does not apply would be a gap in the one comparison
 * they want.
 */
export function performanceRegressions(
  current: readonly UrlAudit[],
  previous: PreviousPerformance | null,
): readonly PerformanceRegression[] {
  if (previous === null) return [];
  const regressions: PerformanceRegression[] = [];
  for (const entry of current) {
    for (const device of entry.devices) {
      if (device.usableSamples === 0) continue;
      for (const metric of LOWER_IS_BETTER) {
        const now = device.metrics[metric].median;
        const before = medianFor(previous.audit.urls, entry.url, device.strategy, metric);
        if (now === null || before === null || before <= 0) continue;
        const changeRatio = (now - before) / before;
        if (changeRatio < REGRESSION_RATIO || !crossesFloor(metric, now - before)) continue;
        regressions.push({
          url: entry.url,
          strategy: device.strategy,
          metric,
          previous: before,
          current: now,
          changeRatio: Number(changeRatio.toFixed(4)),
          previousScanId: previous.scanId,
          previousObservedAt: previous.observedAt,
        });
      }
      const score = device.metrics.performanceScore.median;
      const previousScore = medianFor(
        previous.audit.urls,
        entry.url,
        device.strategy,
        'performanceScore',
      );
      if (score === null || previousScore === null || previousScore <= 0) continue;
      const drop = previousScore - score;
      if (drop / previousScore < REGRESSION_RATIO || !crossesFloor('performanceScore', drop)) {
        continue;
      }
      regressions.push({
        url: entry.url,
        strategy: device.strategy,
        metric: 'performanceScore',
        previous: previousScore,
        current: score,
        // Stated as the size of the fall, so every regression's ratio reads the
        // same way regardless of which direction the metric improves in.
        changeRatio: Number((drop / previousScore).toFixed(4)),
        previousScanId: previous.scanId,
        previousObservedAt: previous.observedAt,
      });
    }
  }
  return regressions;
}

/** The Lighthouse major version an audit's samples were taken with, when stated. */
function lighthouseMajor(audit: PerformanceAudit): string | null {
  const version = audit.providers.find((provider) => provider.name === 'pagespeed')?.version;
  if (version === null || version === undefined || version === '') return null;
  // `providerInfo` joins several versions with ", " when a rollout spanned the
  // audit; a run that saw two majors is not a stable basis for a comparison.
  const majors = [...new Set(version.split(',').map((entry) => entry.trim().split('.')[0]))];
  return majors.length === 1 ? (majors[0] ?? null) : null;
}

/**
 * Why these two audits may not be compared, as a code, or null when they may.
 *
 * A null version on either side is NOT treated as a match: an audit that did not
 * state which Lighthouse produced it cannot be shown to have been produced by the
 * same one, and inventing that equality is exactly the lie this function exists
 * to prevent.
 */
export function incomparableDetail(
  current: PerformanceAudit,
  previous: PerformanceAudit,
): IncomparableDetail | null {
  if (previous.version !== current.version) {
    return {
      code: 'AuditVersionChanged',
      previous: previous.version,
      current: current.version,
    };
  }
  const currentMajor = lighthouseMajor(current);
  const previousMajor = lighthouseMajor(previous);
  if (currentMajor === null || previousMajor === null) {
    return { code: 'LighthouseVersionUnrecorded', previous: previousMajor, current: currentMajor };
  }
  if (currentMajor !== previousMajor) {
    return { code: 'LighthouseMajorChanged', previous: previousMajor, current: currentMajor };
  }
  return null;
}

/**
 * The same fact as the English sentence that is stored beside the code.
 *
 * It is what a client this build does not control still renders, and the fallback
 * each deliverable falls back to for a code it has no copy for — so it stays a
 * complete sentence rather than a token.
 */
export function incomparableSentence(detail: IncomparableDetail): string {
  switch (detail.code) {
    case 'AuditVersionChanged':
      return `the previous scan was measured by ${detail.previous ?? '—'}, this one by ${detail.current ?? '—'}`;
    case 'LighthouseVersionUnrecorded':
      return 'one of the two scans did not record a single Lighthouse version';
    case 'LighthouseMajorChanged':
      return `Lighthouse ${detail.previous ?? '—'} measured the previous scan and Lighthouse ${detail.current ?? '—'} this one`;
  }
}

/** Why these two audits may not be compared, in the API's own English. */
export function incomparableReason(
  current: PerformanceAudit,
  previous: PerformanceAudit,
): string | null {
  const detail = incomparableDetail(current, previous);
  return detail === null ? null : incomparableSentence(detail);
}

export interface ComparisonResult {
  readonly regressions: readonly PerformanceRegression[];
  readonly comparison: PerformanceComparison | null;
}

/**
 * The comparison for one audit: the regressions, plus what the comparison was
 * able to do at all.
 *
 * This is the only entry point the module wiring uses. It returns an empty
 * regression list for an incomparable pair *and* says why, so the report can
 * print "not compared, because …" instead of the silence that reads as "nothing
 * got worse".
 */
export function compareWithPrevious(
  current: PerformanceAudit,
  previous: PreviousPerformance | null,
): ComparisonResult {
  if (previous === null) return { regressions: [], comparison: null };
  const detail = incomparableDetail(current, previous.audit);
  return {
    regressions: detail === null ? performanceRegressions(current.urls, previous) : [],
    comparison: {
      previousScanId: previous.scanId,
      previousObservedAt: previous.observedAt,
      incomparableReason: detail === null ? null : incomparableSentence(detail),
      incomparable: detail,
    },
  };
}
