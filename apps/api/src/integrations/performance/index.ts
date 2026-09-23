// The Performance integration's public surface, plus the one legacy shape the
// stored reports and the report UI still speak.

import { readIntegrationConfig } from '../config.ts';
import { runPerformanceAudit, type PerformanceAuditOptions } from './audit.ts';
import {
  DEVICE_STRATEGIES,
  type DeviceStrategy,
  type PerformanceAudit,
  type PerformanceAuditRequest,
  type PerformanceRunner,
  type UrlAudit,
} from './types.ts';

export * from './types.ts';
export * from './thresholds.ts';
export { runPerformanceAudit, MAX_PAGESPEED_REQUESTS, SAMPLES_PER_TARGET } from './audit.ts';
export type { PerformanceAuditOptions } from './audit.ts';
export { IMPLEMENTED_PERF_RULE_IDS, performanceFindings } from './findings.ts';
export {
  compareWithPrevious,
  incomparableDetail,
  incomparableReason,
  incomparableSentence,
  performanceRegressions,
  type ComparisonResult,
  type PreviousPerformance,
} from './comparison.ts';
export { selectAuditUrls, MAX_AUDITED_URLS } from './url-selection.ts';
export { median, instabilityOf, seriesByMetric } from './sampling.ts';
export { runPageSpeed, PageSpeedError } from './pagespeed.ts';
export { fetchFieldMetrics } from './crux.ts';

/**
 * The flat snapshot every report written before this audit stored, and the shape
 * the report UI still reads (`metadata.metrics`, `metadata.strategy`).
 *
 * It is kept so an existing report keeps rendering and so the new one renders in
 * a client that has not been updated. Two deliberate differences from the
 * original:
 *
 *   * there is no `inpMs`. There never was a lab INP to put in it — Lighthouse
 *     cannot measure INP — so the old key was always null and the UI rated a
 *     measurement nobody had taken. `tbtMs` replaces it under its own name.
 *   * there is no `htmlBytes` either. The audit measures the whole transfer, and
 *     writing that figure under the key that used to mean the HTML document
 *     alone would silently multiply a stored measurement by ten and make old and
 *     new reports look comparable when they are not. It is emitted as
 *     `totalBytes`; a row written before the audit keeps its own `htmlBytes`,
 *     which the reader still shows under its own name.
 *   * the figures are medians of repeated runs, not one run.
 */
export interface PerformanceSnapshot {
  readonly source: 'pagespeed' | 'crux' | 'pagespeed+crux';
  readonly origin: string;
  readonly strategy: DeviceStrategy;
  readonly performanceScore: number | null;
  readonly metrics: Readonly<Record<string, number | string | null>>;
  readonly fetchedAt: string;
}

/** The device whose numbers the flat snapshot states: mobile when it ran. */
function headlineDevice(audit: PerformanceAudit): {
  readonly entry: UrlAudit;
  readonly strategy: DeviceStrategy;
} | null {
  const entry = audit.urls.find((candidate) => candidate.primary) ?? audit.urls[0];
  if (entry === undefined) return null;
  const usable = entry.devices.filter((device) => device.usableSamples > 0);
  const chosen = usable.find((device) => device.strategy === 'mobile') ?? usable[0];
  return chosen === undefined ? null : { entry, strategy: chosen.strategy };
}

function sourceOf(audit: PerformanceAudit, hasLab: boolean): PerformanceSnapshot['source'] {
  const hasField = audit.field.state === 'available';
  if (hasLab && hasField) return 'pagespeed+crux';
  return hasLab ? 'pagespeed' : 'crux';
}

/**
 * The flat snapshot for one audit. Returns null when nothing was measured at
 * all, which the caller reports as an unavailable module rather than as a
 * snapshot full of nulls.
 */
export function legacySnapshotOf(audit: PerformanceAudit): PerformanceSnapshot | null {
  const headline = headlineDevice(audit);
  const field = audit.field.metrics;
  if (headline === null && field === null) return null;
  const device = headline?.entry.devices.find(
    (candidate) => candidate.strategy === headline.strategy,
  );
  const lab = device?.metrics;
  return {
    source: sourceOf(audit, device !== undefined),
    origin: audit.origin,
    strategy: headline?.strategy ?? 'mobile',
    performanceScore: audit.score,
    metrics: {
      ...(lab === undefined
        ? {}
        : {
            ttfbMs: lab.ttfbMs.median,
            lcpMs: lab.lcpMs.median,
            clsScore: lab.clsScore.median,
            tbtMs: lab.tbtMs.median,
            totalBytes: lab.totalBytes.median,
            requestCount: lab.requestCount.median,
          }),
      ...(field === null
        ? {}
        : {
            lcpP75Ms: field.lcpP75Ms,
            inpP75Ms: field.inpP75Ms,
            clsP75: field.clsP75,
            ttfbP75Ms: field.ttfbP75Ms,
          }),
    },
    fetchedAt: audit.fetchedAt,
  };
}

/**
 * What one audit may spend when this deployment has no `PAGESPEED_API_KEY`.
 *
 * PageSpeed Insights does accept keyless requests, but Google throttles them per
 * caller instead of granting a quota: a scan that spent the full twelve-request
 * budget would meet HTTP 429 on the next one, and a rate-limited sample is
 * recorded as a failed check — a Partial Performance section on a paid audit,
 * for a reason that is this deployment's configuration rather than the site.
 *
 * So without a key the audit measures the primary page, on one device, once,
 * which is what this module did before it became an audit. Coverage is stated
 * over what it attempted, so the smaller audit completes honestly rather than
 * reporting a larger one it never ran. Configure the key to measure everything.
 */
export const KEYLESS_AUDIT_LIMITS = {
  maxUrls: 1,
  samplesPerTarget: 1,
  maxRequests: 1,
} as const;

/** The one device a keyless audit measures: the caller's first choice. */
function onOneDevice(request: PerformanceAuditRequest): PerformanceAuditRequest {
  const [device] = request.strategies ?? DEVICE_STRATEGIES;
  return { ...request, strategies: [device ?? 'mobile'] };
}

/**
 * The production runner, or undefined when this deployment has no performance
 * provider at all.
 *
 * PageSpeed Insights accepts requests without an API key, so the audit is on by
 * default — but a keyless deployment runs the reduced audit above, not the full
 * one. CrUX always needs its own key; without one the field section reports
 * `not_configured` and the report says out loud that INP could not be measured.
 */
export function createDefaultPerformanceRunner(
  overrides: PerformanceAuditOptions = {},
): PerformanceRunner {
  const config = readIntegrationConfig();
  const keyless = (config.pageSpeedApiKey ?? '') === '';
  const options: PerformanceAuditOptions = {
    pageSpeedApiKey: config.pageSpeedApiKey,
    cruxApiKey: config.cruxApiKey,
    ...(keyless ? KEYLESS_AUDIT_LIMITS : {}),
    ...overrides,
  };
  return (request: PerformanceAuditRequest) =>
    runPerformanceAudit(keyless ? onOneDevice(request) : request, options);
}
