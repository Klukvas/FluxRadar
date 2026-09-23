// The vocabulary of a Performance audit.
//
// Two things in here are deliberate and easy to get wrong later:
//
//   1. LAB TBT IS NOT INP. Lighthouse — and therefore PageSpeed Insights'
//      `runPagespeed` — does not measure Interaction to Next Paint: INP needs a
//      real interaction from a real visitor. Total Blocking Time is the lab
//      proxy, it has its own scale and its own thresholds, and it is carried
//      here under its own name. INP appears only in `FieldMetrics`, from the
//      Chrome UX Report, and when that is unavailable the audit says so in as
//      many words instead of quietly showing TBT in its place.
//
//   2. EVERY NUMBER KEEPS ITS PROVENANCE. A measurement is meaningless without
//      the URL it was taken on, the device it was emulated as, the provider and
//      version that produced it and when. Those travel with the samples rather
//      than being reconstructed by the reader.

export const PERFORMANCE_AUDIT_VERSION = 'performance-audit-v1';

export type DeviceStrategy = 'mobile' | 'desktop';

export const DEVICE_STRATEGIES: readonly DeviceStrategy[] = ['mobile', 'desktop'];

/** Lab metric names this audit reads out of one Lighthouse run. */
export const LAB_METRIC_NAMES = [
  'performanceScore',
  'ttfbMs',
  'fcpMs',
  'lcpMs',
  'clsScore',
  /** Total Blocking Time. Not INP — see the file header. */
  'tbtMs',
  'speedIndexMs',
  'totalBytes',
  'requestCount',
  'unusedJavaScriptBytes',
  'unusedCssBytes',
  'renderBlockingMs',
  'uncachedBytes',
  'uncompressedBytes',
  'unoptimisedImageBytes',
] as const;

export type LabMetricName = (typeof LAB_METRIC_NAMES)[number];

export type LabMetrics = Readonly<Record<LabMetricName, number | null>>;

/** One Lighthouse run: one URL, one emulated device, one moment. */
export interface LabSample {
  readonly url: string;
  readonly strategy: DeviceStrategy;
  readonly collectedAt: string;
  /** Lighthouse's own version string, when the provider stated one. */
  readonly lighthouseVersion: string | null;
  /** The provider's own analysis timestamp, when it stated one. */
  readonly analysedAt: string | null;
  readonly metrics: LabMetrics;
}

/**
 * One metric across the repeated runs of one URL/device pair.
 *
 * `median` is what everything downstream reads: a single Lighthouse run is noisy
 * enough that one slow pass can move a metric by a factor of two.
 * `instability` is that noise, stated rather than smoothed away — (max − min)
 * over the median — so a reader can tell a solid 3.1 s LCP from an average of
 * 1.4 s and 4.8 s. It is null when a single sample cannot say.
 */
export interface MetricSeries {
  readonly median: number | null;
  readonly samples: readonly number[];
  readonly instability: number | null;
}

export type MetricSeriesByName = Readonly<Record<LabMetricName, MetricSeries>>;

export interface DeviceResult {
  readonly strategy: DeviceStrategy;
  readonly requestedSamples: number;
  readonly usableSamples: number;
  readonly metrics: MetricSeriesByName;
  /** Why some or all runs produced nothing. Empty when every run answered. */
  readonly failures: readonly string[];
}

export interface UrlAudit {
  readonly url: string;
  /** True for the one URL the section's headline numbers are taken from. */
  readonly primary: boolean;
  readonly devices: readonly DeviceResult[];
}

/** What the Chrome UX Report reported for real visitors. */
export interface FieldMetrics {
  readonly lcpP75Ms: number | null;
  /** The only INP in this file: a real measurement from real interactions. */
  readonly inpP75Ms: number | null;
  readonly clsP75: number | null;
  readonly ttfbP75Ms: number | null;
  /** The days CrUX aggregated, when it stated them. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export type FieldState = 'available' | 'not_configured' | 'no_data' | 'request_failed';

export interface FieldResult {
  readonly state: FieldState;
  /** Whether the figures describe the whole origin or one URL. */
  readonly scope: 'origin';
  readonly detail: string;
  readonly metrics: FieldMetrics | null;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * One actionable conclusion. `ruleId` is a PERF-* identifier this module
 * implements — the list of implemented ids is `IMPLEMENTED_PERF_RULE_IDS`, and
 * nothing claims coverage beyond it.
 */
export interface PerformanceFinding {
  readonly ruleId: string;
  readonly severity: FindingSeverity;
  readonly url: string;
  readonly strategy: DeviceStrategy | null;
  readonly summary: string;
  readonly recommendation: string;
  /** The measurement the sentence was derived from, with its provenance. */
  readonly evidence: Readonly<Record<string, number | string | boolean | null>>;
}

/** A metric that moved for the worse against the previous scan of this profile. */
export interface PerformanceRegression {
  readonly url: string;
  readonly strategy: DeviceStrategy;
  readonly metric: LabMetricName;
  readonly previous: number;
  readonly current: number;
  readonly changeRatio: number;
  /** The previous scan the comparison was made against. */
  readonly previousScanId: string;
  readonly previousObservedAt: string | null;
}

/**
 * Why two audits may not be compared, as a code rather than as a sentence.
 *
 * The sentence used to be the only thing stored, so both deliverables printed an
 * English clause inside a Ukrainian frame ("Порівняння немає: the previous scan
 * was measured by …"). The code and the two version strings are what each reader's
 * side needs to say it in their own words.
 */
export const INCOMPARABLE_CODES = [
  /** The audit format itself changed between the two scans. */
  'AuditVersionChanged',
  /** One of the two scans did not state a single Lighthouse version. */
  'LighthouseVersionUnrecorded',
  /** Two different Lighthouse majors, whose scoring curves differ. */
  'LighthouseMajorChanged',
] as const;

export type IncomparableCode = (typeof INCOMPARABLE_CODES)[number];

export interface IncomparableDetail {
  readonly code: IncomparableCode;
  /** The version the previous scan stated; null when the code names none. */
  readonly previous: string | null;
  readonly current: string | null;
}

/**
 * What the comparison with the previous scan was able to do.
 *
 * It is stored even when there is nothing to compare, because "nothing got worse"
 * and "these two runs cannot be compared" are different statements and the report
 * must not print the first when it means the second.
 */
export interface PerformanceComparison {
  readonly previousScanId: string | null;
  readonly previousObservedAt: string | null;
  /**
   * The English sentence, kept because a stored row is read by whatever client
   * asks for it: it is what a reader still sees for a code this build does not
   * know, and what every report written before `incomparable` existed carries.
   * Null when the two runs were measured the same way.
   */
  readonly incomparableReason: string | null;
  /** The same fact as a code, for a reader who is not reading English. */
  readonly incomparable: IncomparableDetail | null;
}

export interface ProviderInfo {
  readonly name: 'pagespeed' | 'crux';
  /** Version reported by the provider itself, when it states one. */
  readonly version: string | null;
  readonly requests: number;
  readonly failures: number;
}

export interface RequestBudget {
  readonly cap: number;
  readonly used: number;
  /** True when the audit stopped early because the cap was reached. */
  readonly capped: boolean;
}

/**
 * How much of the promised Performance work this run actually did.
 *
 * `implementedRuleIds` is the closed list this module can produce. It is stored
 * with the audit so a report never implies coverage of a PERF rule that has no
 * code behind it.
 */
export interface PerformanceCoverage {
  readonly applicableChecks: number;
  readonly completedApplicableChecks: number;
  readonly implementedRuleIds: readonly string[];
}

export interface PerformanceAudit {
  readonly version: typeof PERFORMANCE_AUDIT_VERSION;
  readonly origin: string;
  readonly fetchedAt: string;
  readonly providers: readonly ProviderInfo[];
  readonly urls: readonly UrlAudit[];
  readonly field: FieldResult;
  readonly requestBudget: RequestBudget;
  readonly findings: readonly PerformanceFinding[];
  readonly regressions: readonly PerformanceRegression[];
  /** Null when this scan is the first one for the profile. */
  readonly comparison: PerformanceComparison | null;
  readonly coverage: PerformanceCoverage;
  /** Lighthouse's own performance score, as a median. Findings never change it. */
  readonly score: number | null;
}

export interface PerformanceAuditRequest {
  readonly origin: string;
  /**
   * Pages the crawl found, in the crawl's own order. The audit selects a bounded
   * subset of them; it never measures every page of a site.
   */
  readonly candidateUrls: readonly string[];
  /** Overrides the default two; a Free-tier caller may ask for one. */
  readonly strategies?: readonly DeviceStrategy[];
}

export type PerformanceRunner = (request: PerformanceAuditRequest) => Promise<PerformanceAudit>;
