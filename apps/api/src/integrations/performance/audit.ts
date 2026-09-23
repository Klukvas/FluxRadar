// Runs the Performance audit: a bounded set of pages, on both emulated devices,
// measured more than once, plus one field read for the origin.
//
// THE REQUEST BUDGET IS A HARD CAP, NOT A TARGET. PageSpeed runs are slow and
// rate-limited, and a scan that exhausted the quota would take every later
// customer's Performance section down with it. The cap is checked before every
// request, the audit stops cleanly when it is reached, and `requestBudget.capped`
// says so — a truncated audit that looked complete would be worse than a small one.
//
// Nothing here fails the scan. A provider outage produces a device with no
// usable samples and a stated reason; the caller decides what that means for the
// module row.

import { fetchFieldMetrics, type CruxOptions } from './crux.ts';
import { performanceFindings, IMPLEMENTED_PERF_RULE_IDS } from './findings.ts';
import { PageSpeedError, runPageSpeed, type PageSpeedOptions } from './pagespeed.ts';
import { median, seriesByMetric } from './sampling.ts';
import { selectAuditUrls, MAX_AUDITED_URLS } from './url-selection.ts';
import {
  DEVICE_STRATEGIES,
  PERFORMANCE_AUDIT_VERSION,
  type DeviceResult,
  type DeviceStrategy,
  type FieldResult,
  type LabSample,
  type PerformanceAudit,
  type PerformanceAuditRequest,
  type ProviderInfo,
  type UrlAudit,
} from './types.ts';

/** Lighthouse runs per URL/device pair. Two is the cheapest count that has a spread. */
export const SAMPLES_PER_TARGET = 2;

/**
 * The most PageSpeed calls one audit may make. Three URLs on two devices twice
 * is twelve; the headroom above it exists so the cap is a backstop rather than
 * something the default configuration sits exactly on.
 */
export const MAX_PAGESPEED_REQUESTS = 14;

export interface PerformanceAuditOptions {
  readonly pageSpeedApiKey?: string | null;
  readonly cruxApiKey?: string | null;
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
  readonly samplesPerTarget?: number;
  readonly maxUrls?: number;
  readonly maxRequests?: number;
  readonly pageSpeedTimeoutMs?: number;
}

/** Counts requests and refuses to let an audit spend more than its budget. */
class RequestBudgetCounter {
  private used = 0;
  private cappedFlag = false;
  private readonly cap: number;

  // Node runs this source with strip-only type stripping, so a constructor
  // parameter property would not survive to runtime — the API fails to boot on
  // one. The field is therefore declared and assigned explicitly.
  constructor(cap: number) {
    this.cap = cap;
  }

  tryTake(): boolean {
    if (this.used >= this.cap) {
      this.cappedFlag = true;
      return false;
    }
    this.used += 1;
    return true;
  }

  get spent(): number {
    return this.used;
  }

  get capped(): boolean {
    return this.cappedFlag;
  }
}

function failureReason(error: unknown): string {
  if (error instanceof PageSpeedError) {
    return error.status === 0
      ? 'PageSpeed Insights could not be reached'
      : `PageSpeed Insights answered HTTP ${error.status}`;
  }
  return 'PageSpeed Insights returned an unusable result';
}

async function sampleDevice(
  url: string,
  strategy: DeviceStrategy,
  requested: number,
  budget: RequestBudgetCounter,
  pageSpeed: PageSpeedOptions,
  onSample: (sample: LabSample) => void,
): Promise<DeviceResult> {
  const samples: LabSample[] = [];
  const failures: string[] = [];
  for (let attempt = 0; attempt < requested; attempt += 1) {
    if (!budget.tryTake()) {
      failures.push('request budget reached before this sample was taken');
      break;
    }
    try {
      const sample = await runPageSpeed(url, strategy, pageSpeed);
      samples.push(sample);
      onSample(sample);
    } catch (error) {
      failures.push(failureReason(error));
    }
  }
  return {
    strategy,
    requestedSamples: requested,
    usableSamples: samples.length,
    metrics: seriesByMetric(samples),
    failures,
  };
}

/**
 * The module's score: the median of every usable device median.
 *
 * It is Lighthouse's own number and nothing else. The findings and the
 * regressions are reported beside it and deliberately do not subtract from it —
 * see findings.ts and comparison.ts for why doing so would penalise one slow
 * page twice.
 */
function auditScore(urls: readonly UrlAudit[]): number | null {
  const scores = urls.flatMap((entry) =>
    entry.devices.flatMap((device) => {
      const score = device.metrics.performanceScore.median;
      return device.usableSamples > 0 && score !== null ? [score] : [];
    }),
  );
  const middle = median(scores);
  return middle === null ? null : Math.round(middle);
}

function providerInfo(
  samples: readonly LabSample[],
  labFailures: number,
  field: FieldResult,
  cruxRequests: number,
): readonly ProviderInfo[] {
  const versions = [
    ...new Set(
      samples.flatMap((sample) =>
        sample.lighthouseVersion === null ? [] : [sample.lighthouseVersion],
      ),
    ),
  ];
  return [
    {
      name: 'pagespeed',
      // More than one version across a single audit is possible while Google
      // rolls one out; stating both is more useful than picking one.
      version: versions.length === 0 ? null : versions.join(', '),
      requests: samples.length + labFailures,
      failures: labFailures,
    },
    {
      name: 'crux',
      version: null,
      requests: cruxRequests,
      failures: field.state === 'request_failed' ? 1 : 0,
    },
  ];
}

/**
 * How much of the promised work ran. One "check" is one URL/device pair that
 * produced at least one usable sample.
 *
 * THE FIELD READ IS DELIBERATELY NOT A CHECK. Whether the Chrome UX Report has a
 * record for an origin depends on how many Chrome visitors that site gets — a
 * fact about the customer's traffic, not about whether FluxRadar did its job.
 * Counting it would leave an unclosed applicable check on nearly every small
 * site, which §18 turns into a Partial scan, which is a billing-visible state.
 * The absence is reported instead, as its own finding (PERF-FIELD-INP).
 */
function coverageOf(urls: readonly UrlAudit[]) {
  const pairs = urls.flatMap((entry) => entry.devices);
  return {
    applicableChecks: pairs.length,
    completedApplicableChecks: pairs.filter((device) => device.usableSamples > 0).length,
    implementedRuleIds: [...IMPLEMENTED_PERF_RULE_IDS],
  };
}

/**
 * Measures the site and returns the audit. Never throws: every provider failure
 * is recorded in the result rather than raised, because a Performance section is
 * an enrichment and must not be able to fail a website scan.
 */
export async function runPerformanceAudit(
  request: PerformanceAuditRequest,
  options: PerformanceAuditOptions = {},
): Promise<PerformanceAudit> {
  const now = options.now ?? ((): Date => new Date());
  const fetchedAt = now().toISOString();
  const budget = new RequestBudgetCounter(options.maxRequests ?? MAX_PAGESPEED_REQUESTS);
  const strategies = request.strategies ?? DEVICE_STRATEGIES;
  const targets = selectAuditUrls(
    request.origin,
    request.candidateUrls,
    options.maxUrls ?? MAX_AUDITED_URLS,
  );
  const pageSpeed: PageSpeedOptions = {
    apiKey: options.pageSpeedApiKey ?? null,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.pageSpeedTimeoutMs === undefined ? {} : { timeoutMs: options.pageSpeedTimeoutMs }),
    now,
  };
  const crux: CruxOptions = {
    apiKey: options.cruxApiKey ?? null,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
  };

  const collected: LabSample[] = [];
  const urls: UrlAudit[] = [];
  for (const [index, url] of targets.entries()) {
    const devices: DeviceResult[] = [];
    for (const strategy of strategies) {
      devices.push(
        await sampleDevice(
          url,
          strategy,
          options.samplesPerTarget ?? SAMPLES_PER_TARGET,
          budget,
          pageSpeed,
          (sample) => collected.push(sample),
        ),
      );
    }
    urls.push({ url, primary: index === 0, devices });
  }

  const field = await fetchFieldMetrics(request.origin, crux);
  const labFailures = urls.reduce(
    (total, entry) =>
      total + entry.devices.reduce((sum, device) => sum + device.failures.length, 0),
    0,
  );
  return {
    version: PERFORMANCE_AUDIT_VERSION,
    origin: request.origin,
    fetchedAt,
    providers: providerInfo(
      collected,
      labFailures,
      field,
      field.state === 'not_configured' ? 0 : 1,
    ),
    urls,
    field,
    requestBudget: {
      cap: options.maxRequests ?? MAX_PAGESPEED_REQUESTS,
      used: budget.spent,
      capped: budget.capped,
    },
    findings: performanceFindings(request.origin, urls, field),
    // Filled in by the caller, which is the only place that knows the previous
    // scan. An audit taken in isolation has nothing to compare against — and
    // `comparison: null` says exactly that, rather than implying it was compared
    // and found unchanged.
    regressions: [],
    comparison: null,
    coverage: coverageOf(urls),
    score: auditScore(urls),
  };
}
