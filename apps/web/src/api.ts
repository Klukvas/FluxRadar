// Local FluxRadar API runs on 3310 because 3000 is occupied by another local service.
// Deployments should always provide VITE_API_URL explicitly.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3310';

export interface ApiResult<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly meta?: PageMeta;
}

/**
 * Paging information the API returns alongside a list.
 *
 * `hasNext` is optional on purpose: it is the newest field of the envelope and a
 * deployment that predates it still answers with `total`/`page`/`limit` only.
 * Read it through `hasMorePages` rather than directly, so a missing field falls
 * back to the arithmetic the older shape already supported.
 */
export interface PageMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly hasNext?: boolean;
}

/** A list response with the paging information the envelope carried for it. */
export interface PagedResult<T> {
  readonly data: T;
  readonly meta: PageMeta | null;
}

/** Whether another page follows the one described by `meta`. */
export function hasMorePages(meta: PageMeta | null): boolean {
  if (meta === null) return false;
  if (typeof meta.hasNext === 'boolean') return meta.hasNext;
  return meta.page * meta.limit < meta.total;
}

/** The offset the next page starts at, for a client that pages with offsets. */
export function nextPageOffset(meta: PageMeta | null): number {
  return meta === null ? 0 : meta.page * meta.limit;
}

const TECHNICAL_ERROR =
  /^(request failed|failed to fetch|networkerror|typeerror|fetch error|http\s*\d+)/i;

/**
 * A failed API call, carrying the envelope's machine-readable code.
 *
 * It is an `Error` with the same user-facing `message` every caller already
 * renders, so nothing that catches it has to change. The `code` exists for the
 * few screens that must say something of their own about a specific failure —
 * "this profile already exists" reads very differently from the generic
 * sentence — without matching on server prose. `code` is null when the failure
 * never reached the API (network) or the response carried no envelope.
 */
export class ApiRequestError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, options: { code: string | null; status: number }) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = options.code;
    this.status = options.status;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await apiRequestWithMeta<T>(path, init)).data;
}

/**
 * A binary download from the API, as a Blob.
 *
 * `apiRequest` speaks JSON (and CSV); a PDF is bytes, and putting it through a
 * string would corrupt it. A refusal still arrives as the usual JSON envelope, so
 * the failure path is parsed exactly as everywhere else and the caller can act on
 * the code — `PDF_TOO_LARGE` gets its own sentence rather than a generic error.
 */
export async function apiDownload(
  path: string,
): Promise<{ readonly blob: Blob; readonly filename: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  } catch {
    throw new ApiRequestError('FluxRadar is temporarily unavailable. Try again in a moment.', {
      code: null,
      status: 0,
    });
  }
  if (!response.ok) {
    let envelope: ApiResult<unknown> | null = null;
    try {
      envelope = (await response.json()) as ApiResult<unknown>;
    } catch {
      // Non-JSON refusal: the status decides the sentence below.
    }
    const backendMessage = envelope?.error?.message;
    throw new ApiRequestError(
      backendMessage !== undefined && !TECHNICAL_ERROR.test(backendMessage)
        ? backendMessage
        : friendlyStatusMessage(response.status),
      { code: envelope?.error?.code ?? null, status: response.status },
    );
  }
  return { blob: await response.blob(), filename: filenameFrom(response) };
}

/** The filename the server asked for, when it stated one in Content-Disposition. */
function filenameFrom(response: Response): string | null {
  const header = response.headers.get('content-disposition');
  const match = header === null ? null : /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
}

/**
 * The same request as `apiRequest`, keeping the envelope's `meta` instead of
 * dropping it. Only list screens that page need it; everything else stays on
 * `apiRequest` and is unaffected by this existing.
 */
export async function apiRequestWithMeta<T>(
  path: string,
  init: RequestInit = {},
): Promise<PagedResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiRequestError('FluxRadar is temporarily unavailable. Try again in a moment.', {
      code: null,
      status: 0,
    });
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/csv') && response.ok) {
    return { data: (await response.text()) as T, meta: null };
  }
  let envelope: ApiResult<T> | null = null;
  try {
    envelope = (await response.json()) as ApiResult<T>;
  } catch {
    // Non-JSON responses are converted into a safe product message below.
  }
  if (!response.ok || envelope?.success !== true) {
    const backendMessage = envelope?.error?.message;
    const message =
      backendMessage && !TECHNICAL_ERROR.test(backendMessage)
        ? backendMessage
        : friendlyStatusMessage(response.status);
    throw new ApiRequestError(message, {
      code: envelope?.error?.code ?? null,
      status: response.status,
    });
  }
  return { data: envelope.data as T, meta: envelope.meta ?? null };
}

function friendlyStatusMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  if (status === 403) return 'This action is not available for the current plan or account.';
  if (status === 404) return 'FluxRadar could not find the requested item.';
  if (status === 409) return 'This action conflicts with the current scan state.';
  if (status === 429) return 'Too many attempts. Try again later.';
  if (status >= 500) return 'FluxRadar is temporarily unavailable. Try again in a moment.';
  return 'FluxRadar could not complete this request. Try again.';
}

export interface Account {
  readonly accountId: string;
  readonly email: string;
  readonly internalFreeAccess?: boolean;
  readonly emailVerified?: boolean;
  readonly onboarding?: { readonly status: 'pending' | 'completed' | 'skipped' };
}

export interface SiteProfile {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly industry?: string | null;
  readonly region?: string | null;
  readonly language?: string | null;
  readonly businessDescription?: string | null;
  readonly offerings?: string | null;
  readonly targetLanguages?: string | null;
  readonly targetAudience?: string | null;
  readonly scanConfig?: ProfileScanConfig | null;
  readonly scanConfigVersion?: number;
}

/** One public endpoint the Reliability section checks. GET/HEAD only. */
export interface ApiCheckConfig {
  readonly method: 'GET' | 'HEAD';
  readonly url: string;
  readonly expectedStatus?: readonly number[];
}

export interface ProfileScanConfig {
  readonly plan: 'Free' | 'Basic' | 'WebsiteAudit' | 'Complete';
  readonly scope: {
    readonly includeSubdomains: boolean;
    readonly maxPages?: number;
    readonly maxDepth?: number;
    readonly urlPatterns?: readonly string[];
    readonly excludePatterns?: readonly string[];
    readonly seedUrls?: readonly string[];
    readonly renderJs?: boolean;
    readonly apiChecks?: readonly ApiCheckConfig[];
    readonly queryPolicy: 'include' | 'ignore';
    readonly respectRobots: boolean;
    readonly robotsOverrideConfirmed: boolean;
    readonly userAgent: 'desktop' | 'mobile';
    /** The owner's preferred egress location id; absent means "the default". */
    readonly egressLocation?: string;
  };
}

/**
 * A place a crawl can leave from. Mirrors `EgressLocationView` in
 * apps/api/src/integrations/crawl-egress-locations.ts: `label` and the rest are
 * null for an id the API no longer knows, which is still printed as its code.
 */
export interface EgressLocation {
  readonly id: string;
  readonly countryCode: string | null;
  readonly city: string | null;
  readonly label: { readonly en: string; readonly uk: string } | null;
}

/** What the launch screen may offer, as `GET /scans/launch-config` answers it. */
export interface EgressLaunchConfig {
  /** `direct`: this deployment has no egress location, and nothing to choose. */
  readonly mode: 'direct' | 'proxy';
  /** Configured and answering right now; nothing else is offered. */
  readonly locations: readonly EgressLocation[];
  readonly defaultLocationId: string | null;
}

export interface LaunchConfig {
  readonly egress: EgressLaunchConfig;
}

export interface ScanModule {
  readonly module: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly coverage: number | null;
  readonly score: number | null;
  readonly applicableChecks: number | null;
  readonly completedApplicableChecks: number | null;
  readonly usableOutput: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The last answer a site gave about whether it will let the crawler read it.
 *
 * `canPurchase` is the API's own verdict — fresh enough and `reachable` — and
 * is re-derived on the server when a checkout opens. Nothing the browser does
 * with this field can widen what may be bought.
 */
export interface SiteReachability {
  readonly state:
    'reachable' | 'access-denied' | 'blocked-by-robots' | 'unreachable' | 'bad-response' | null;
  readonly startStatus?: number | null;
  readonly accessControlSignals?: readonly string[];
  readonly checkedAt: string | null;
  readonly expired?: boolean;
  readonly canPurchase: boolean;
}

/** Mirrors `MentionSignal` in @fluxradar/ai. */
export type MentionSignal =
  'mentioned' | 'not-mentioned' | 'named-in-question' | 'brand-is-hostname';

/** Mirrors `crawlSummarySchema` in @fluxradar/contracts. */
export interface CrawlSummary {
  readonly reach:
    'reachable' | 'access-denied' | 'blocked-by-robots' | 'unreachable' | 'bad-response';
  readonly startStatus: number | null;
  readonly accessControlSignals: readonly string[];
  readonly pagesRead: number;
  readonly pagesFetched: number;
  readonly urlsDiscovered: number;
  readonly urlsOverLimit: number;
  readonly urlsBlockedByRobots: number;
  readonly limitedBy: 'owner' | 'plan' | null;
  readonly maxPages: number;
}

export interface Scan {
  readonly id: string;
  readonly profileId: string;
  readonly plan: 'Free' | 'Basic' | 'WebsiteAudit' | 'Complete';
  readonly domain: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly scope: {
    readonly includeSubdomains: boolean;
    readonly maxPages?: number;
    readonly maxDepth?: number;
    readonly urlPatterns?: readonly string[];
    readonly excludePatterns?: readonly string[];
    readonly seedUrls?: readonly string[];
    readonly renderJs?: boolean;
    readonly apiChecks?: readonly ApiCheckConfig[];
    readonly queryPolicy?: 'include' | 'ignore';
    readonly respectRobots?: boolean;
    readonly robotsOverrideConfirmed?: boolean;
    readonly userAgent?: 'desktop' | 'mobile';
    readonly egressLocation?: string;
  };
  /**
   * Where the crawl left from. Null — and absent from an older API — when the
   * scan predates the choice: its location was never recorded, and the report
   * says so rather than assuming one.
   */
  readonly egressLocation?: EgressLocation | null;
  /**
   * How much of the site the crawl read, in addresses rather than in checks.
   * Null when a scan predates the record — the report then shows no coverage
   * line at all, rather than a number nobody measured.
   */
  readonly crawlSummary?: CrawlSummary | null;
  readonly profileConfigVersion?: number;
  readonly rulesetVersion: string;
  readonly progress: {
    readonly completedModules: number;
    readonly totalModules: number;
    /** URLs read so far and known to the crawl; absent from an older API. */
    readonly scannedUrls?: number;
    readonly discoveredUrls?: number;
  };
  /** Set while a pause has been asked for but the run has not stopped yet. */
  readonly pauseRequestedAt?: string | null;
  /**
   * Retries already used. A Partial scan may retry one unfinished section once
   * (`moduleRetryCount < 1` on the server); absent from an older API.
   */
  readonly retry?: { readonly platform: number; readonly module: number };
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly modules: readonly ScanModule[];
}

/** The optional proof that this account controls a site, as the API reports it. */
export interface DomainVerification {
  readonly method: 'dns-txt' | 'file' | 'meta';
  readonly status: 'pending' | 'verified' | 'failed';
  readonly domain: string;
  readonly token: string;
  readonly record: string;
  readonly instruction: string;
  readonly issuedAt: string;
  readonly tokenExpiresAt: string;
  readonly tokenExpired: boolean;
  readonly verifiedAt: string | null;
  readonly lastCheckedAt: string | null;
  readonly lastFailureReason: string | null;
  readonly attempts: number;
  readonly stale?: boolean;
}

/** Whether a finished scan can still retry one unfinished section. */
export function canRetrySection(scan: Pick<Scan, 'status' | 'retry'>): boolean {
  return scan.status === 'Partial' && (scan.retry?.module ?? 0) < 1;
}

export interface Issue {
  readonly id: string;
  readonly scanId: string;
  readonly ruleId: string;
  readonly module: string;
  readonly fingerprint: string;
  readonly severity: string;
  readonly category: string;
  readonly status: string;
  readonly targetUrl: string;
  readonly evidenceType: string;
  readonly evidenceRef: string;
  readonly evidenceExcerpt: string | null;
  readonly recommendation: string;
  /**
   * The evidence and recommendation in each report language, rendered by the API
   * from the finding's message codes. Null for a finding stored before codes
   * existed, or written by AI, and absent from an older API: show the stored text.
   */
  readonly localized?: Readonly<
    Record<
      'en' | 'uk',
      { readonly evidenceExcerpt: string | null; readonly recommendation: string | null }
    >
  > | null;
  readonly confidence: number;
  readonly affectedTargets: number;
  readonly applicableTargets: number;
  readonly rulePenalty: number;
  readonly scoreDelta: number;
  readonly observedAt: string;
}

/** One problem in a report: every finding of one rule, as `/issues/summary` folds them. */
export interface IssueRuleGroup {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly issues: number;
  /** Findings of this rule still asking for work: New, Acknowledged or Reopened. */
  readonly openIssues: number;
}

export interface IssueSummary {
  readonly total: number;
  readonly open: number;
  readonly bySeverity: Readonly<Record<string, number>>;
  /** Most urgent first; within a severity, the rule with the most open findings first. */
  readonly groups: readonly IssueRuleGroup[];
}

export interface ChangedRule {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly count: number;
}

/** What a report changed against the previous finished scan of the same profile and plan. */
export interface ScanChanges {
  readonly previous: {
    readonly id: string;
    readonly plan: string;
    readonly completedAt: string | null;
    readonly egressLocation?: EgressLocation | null;
  } | null;
  readonly egressLocation?: EgressLocation | null;
  /**
   * Whether both crawls left from the same place. `different`: the numbers
   * below are differences between two countries, not fixes. `unrecorded`: at
   * least one scan predates the choice. Absent from an older API.
   */
  readonly egressComparison?: 'same' | 'different' | 'unrecorded' | null;
  readonly introduced: number;
  readonly fixed: number;
  readonly persisting: number;
  readonly introducedByRule: readonly ChangedRule[];
  readonly fixedByRule: readonly ChangedRule[];
}

/** One purchase on the account screen. `amount` is what the card was charged. */
export interface Purchase {
  readonly id: string;
  readonly plan: 'Basic' | 'WebsiteAudit' | 'Complete' | string;
  readonly status: string;
  readonly amount: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly domain: string;
  readonly profileName: string;
  readonly entitlementExpiresAt: string | null;
  readonly scanId: string | null;
  readonly scanStatus: string | null;
}

export interface GeoObservation {
  readonly purpose: 'awareness' | 'discovery';
  readonly question: string;
  readonly status: 'answered' | 'unavailable';
  readonly reason: string | null;
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly answer: string | null;
  readonly citations: readonly string[];
  /**
   * What this answer showed about brand and domain visibility.
   *
   * Not booleans. An awareness question names the brand by construction, and
   * the question used to spell the domain out too, so "no finding for this
   * answer" — which is what these fields used to be — meant both badges were
   * green on every scan ever run. `named-in-question` and `brand-is-hostname`
   * are the two ways a signal can have no meaning, and both must read as "not
   * measured" rather than as a pass.
   */
  readonly mentions: {
    readonly brand: MentionSignal;
    readonly domain: MentionSignal;
  } | null;
}

export interface Dashboard {
  readonly scan: Scan;
  readonly overall: {
    readonly verdict: string;
    readonly score: number | null;
    readonly weightedCoverage: number;
    readonly moduleWeights: readonly {
      module: string;
      tariffWeight: number;
      effectiveWeight: number;
    }[];
  };
  readonly modules: readonly ScanModule[];
  /** Absent on responses created by older API versions and empty without GEO. */
  readonly geoObservations?: readonly GeoObservation[];
}

export interface ExportPayload {
  readonly scanId: string;
  readonly records: readonly Record<string, unknown>[];
}

export interface IntegrationStatus {
  readonly provider: string;
  readonly label: string;
  readonly kind: 'user' | 'platform';
  readonly status: 'connected' | 'available' | 'not_configured' | 'needs_reconnect' | 'limited';
  readonly services: readonly string[];
  readonly canConnect: boolean;
  readonly lastCheckedAt: string | null;
  readonly lastError: string | null;
}

/** Mirrors the API's GoogleDataState; every value has its own explanation in the UI. */
export type GoogleDataState =
  | 'connected'
  | 'not_connected'
  | 'no_property_selected'
  | 'needs_reconnect'
  | 'no_access'
  | 'no_data'
  | 'request_failed';

export interface GoogleDiscoverySection<T> {
  readonly state: GoogleDataState;
  /** English, for API clients; the panel explains `state` and `reason` in its own words. */
  readonly detail: string;
  /** `missing_scope` when the grant never included the service; absent from older API versions. */
  readonly reason?: 'missing_scope' | null;
  readonly items: readonly T[];
}

export interface GoogleDiscovery {
  readonly connection: { readonly state: GoogleDataState; readonly detail: string };
  readonly searchConsole: GoogleDiscoverySection<{
    readonly siteUrl: string;
    readonly permissionLevel: string;
  }>;
  readonly analytics: GoogleDiscoverySection<{
    readonly propertyId: string;
    readonly displayName: string;
    readonly accountName: string;
  }>;
}

export interface GoogleBinding {
  readonly siteProfileId: string;
  readonly searchConsoleSiteUrl: string | null;
  readonly ga4PropertyId: string | null;
  readonly ga4PropertyName: string | null;
  readonly updatedAt: string;
}

export interface GoogleServiceResult<T> {
  readonly state: GoogleDataState;
  readonly detail: string;
  readonly data: T | null;
}

export interface SearchConsoleRow {
  readonly key: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

export interface GoogleDataSnapshot {
  readonly source: 'google';
  readonly readOnly: boolean;
  readonly fetchedAt: string;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly searchConsole: GoogleServiceResult<{
    readonly siteUrl: string;
    readonly totals: {
      readonly clicks: number;
      readonly impressions: number;
      readonly ctr: number;
      readonly position: number;
    };
    readonly topQueries: readonly SearchConsoleRow[];
    readonly topPages: readonly SearchConsoleRow[];
  }>;
  readonly analytics: GoogleServiceResult<{
    readonly propertyId: string;
    readonly propertyName: string | null;
    readonly users: number;
    readonly sessions: number;
    readonly pageViews: number;
    readonly events: number;
    readonly keyEvents: number | null;
  }>;
}

// ── Bing Webmaster Tools ────────────────────────────────────────────────────
//
// A separate grant over a separate search engine, so it has its own types rather
// than reusing Google's: a report has to be able to say "Bing has no site
// selected" while Search Console has one, and the two must never be read as one
// number. Bing's average position is its own measurement over its own index and
// is deliberately not comparable with Search Console's.

/** The same vocabulary as the Google states, so one panel can explain both. */
export type BingDataState = GoogleDataState | 'not_verified';

export interface BingSite {
  /** The site exactly as Bing stated it; Bing matches on this string. */
  readonly siteUrl: string;
  readonly isVerified: boolean;
}

export interface BingDiscovery {
  readonly connection: { readonly state: BingDataState; readonly detail: string };
  readonly sites: {
    readonly state: BingDataState;
    readonly detail: string;
    readonly reason?: 'missing_scope' | null;
    readonly items: readonly BingSite[];
  };
}

export interface BingBinding {
  readonly siteProfileId: string;
  readonly siteUrl: string | null;
  readonly verifiedAtSelection: boolean;
  readonly updatedAt: string;
}

export interface BingQueryRow {
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  /** Bing's own measurement. Never averaged with Search Console's position. */
  readonly avgImpressionPosition: number | null;
  readonly avgClickPosition: number | null;
  readonly date: string | null;
}

/**
 * One query's totals over the report period.
 *
 * Bing states one row per query per day; the API adds up the days inside the
 * period, so a query appears once here however many days it had traffic on.
 */
export interface BingQueryTotal {
  readonly query: string;
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly avgImpressionPosition: number | null;
  readonly avgClickPosition: number | null;
  /** Days of the period this query appeared on. */
  readonly days: number;
}

export interface BingTotals {
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  /** Days Bing actually reported, which can be fewer than the period. */
  readonly days: number;
}

export interface BingSiteSummary {
  readonly siteUrl: string;
  /** Null when the traffic read failed: zeroes would read as "no clicks". */
  readonly totals: BingTotals | null;
  readonly previousTotals: BingTotals | null;
  /** Null when the query read failed; empty when Bing reported no queries. */
  readonly topQueries: readonly BingQueryTotal[] | null;
  readonly dailyTraffic: readonly {
    readonly date: string;
    readonly clicks: number;
    readonly impressions: number;
  }[];
  readonly unavailableReads: readonly ('traffic' | 'queries')[];
}

export interface BingFinding {
  readonly code: string;
  readonly severity: 'info' | 'attention';
  /** The API's own English sentence: the fallback, never what is shown by default. */
  readonly summary: string;
  readonly recommendation: string;
  /**
   * The numbers the sentence was derived from. `bing-findings-copy.ts` rebuilds
   * the sentence from these in the reader's language, so they are what the
   * report actually reads. Optional: a report stored before they existed has
   * only the English sentence above.
   */
  readonly evidence?: Readonly<Record<string, number | string | null>>;
}

export interface BingDataSnapshot {
  readonly source: 'bing';
  readonly readOnly: boolean;
  readonly fetchedAt: string;
  readonly dateRange: { readonly startDate: string; readonly endDate: string };
  readonly webmaster: {
    readonly state: BingDataState;
    readonly detail: string;
    readonly data: BingSiteSummary | null;
  };
}

/** What the Analytics section stores under `bing`: the snapshot and its findings. */
export interface BingSection {
  readonly snapshot: BingDataSnapshot;
  readonly findings: readonly BingFinding[];
}

/**
 * Why paid checkout is off, as a closed set of codes. The server deliberately
 * never names the configuration behind it — the sentence the buyer reads is
 * written here, from the code.
 */
export type CheckoutUnavailableReason = 'not_configured' | 'misconfigured';

/**
 * How the browser opens a FastSpring popup checkout, when this deployment has
 * one. `storefront` is the public `data-storefront` value the Store Builder
 * Library is initialised with; it is server-issued and server-validated so the
 * same bundle can serve a test and a live deployment. No credential is involved.
 */
export interface CheckoutPopupConfig {
  readonly storefront: string;
}

/** Whether paid checkout is switched on for this deployment, from the server. */
export interface CheckoutConfig {
  readonly provider: string;
  readonly available: boolean;
  readonly mode: 'test' | 'live' | null;
  readonly unavailableReason: CheckoutUnavailableReason | null;
  /** null when the deployment checks out on the provider-hosted page instead. */
  readonly popup: CheckoutPopupConfig | null;
  readonly plans: readonly {
    readonly plan: string;
    readonly priceUsd: number;
    readonly currency: string;
    /**
     * Whether this deployment can open a checkout for this plan. A plan whose
     * product does not exist at the provider is listed and unavailable rather
     * than missing, so the form can say so instead of quietly dropping it.
     * Absent on a server that predates the field — read as available, which is
     * what it meant before plans could differ.
     */
    readonly available?: boolean;
  }[];
  /**
   * The optional AI recipients this deployment can actually send to, by name.
   * Absent from an older server, which reads as "none": the form then offers no
   * optional recipient rather than one the scan would fail on.
   */
  readonly optInAiProviders?: readonly string[];
}

/** What the server hands back when a checkout starts: never an entitlement. */
export interface CheckoutSession {
  readonly reference: string;
  readonly sessionId: string;
  readonly checkoutUrl: string;
  readonly plan: string;
  readonly amount: number;
  readonly currency: string;
  readonly mode: 'test' | 'live';
  readonly expiresAt: string | null;
}

/**
 * Why a rejected checkout produced no scan. A closed set of codes, never the
 * server's internal reason: the sentence the buyer reads is written here.
 */
export type CheckoutReasonCode =
  'checkout_expired' | 'provider_unavailable' | 'payment_not_verified';

/** Polled after checkout; scanId appears only once the provider webhook lands. */
export interface CheckoutStatus {
  readonly reference: string;
  readonly plan: string;
  readonly status: string;
  readonly reasonCode: CheckoutReasonCode | null;
  readonly scanId: string | null;
  readonly purchaseId: string | null;
  readonly expiresAt: string | null;
}

/** One Action of a written Action Plan, with its live counts (D-232). */
export interface ActionPlanAction {
  readonly title: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly effort: string;
  readonly ruleIds: readonly string[];
  readonly openIssues: number;
  readonly totalIssues: number;
  readonly settled: boolean;
}

export interface ActionPlanReach {
  readonly share: number;
  readonly addressedOpenIssues: number;
  readonly totalOpenIssues: number;
  readonly rules: number;
}

export interface ActionPlanContent {
  readonly language: string;
  readonly overview: string;
  readonly actions: readonly ActionPlanAction[];
  readonly reach: ActionPlanReach | null;
  /** Modules that did not complete; the plan may be incomplete because of them. */
  readonly caveats: readonly string[];
  readonly generatedAt: string;
  readonly modelId: string;
  readonly noticeVersion: string;
}

/** Everything the report needs to draw the Action Plan block in any state. */
export interface ActionPlanState {
  readonly scanId: string;
  readonly languages: readonly string[];
  readonly running: { readonly language: string | null; readonly startedAt: string | null } | null;
  readonly lastFailure: { readonly code: string | null; readonly language: string } | null;
  readonly remaining: { readonly successes: number; readonly attempts: number };
  readonly windowEndsAt: string | null;
  readonly plan: ActionPlanContent | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isActionPlanAction(value: unknown): value is ActionPlanAction {
  if (!isRecord(value)) return false;
  return (
    typeof value.title === 'string' &&
    typeof value.why === 'string' &&
    isStringArray(value.steps) &&
    typeof value.effort === 'string' &&
    isStringArray(value.ruleIds) &&
    typeof value.openIssues === 'number' &&
    typeof value.totalIssues === 'number' &&
    typeof value.settled === 'boolean'
  );
}

function isActionPlanReach(value: unknown): value is ActionPlanReach {
  if (!isRecord(value)) return false;
  return (
    typeof value.share === 'number' &&
    typeof value.addressedOpenIssues === 'number' &&
    typeof value.totalOpenIssues === 'number' &&
    typeof value.rules === 'number'
  );
}

function isActionPlanContent(value: unknown): value is ActionPlanContent {
  if (!isRecord(value)) return false;
  return (
    typeof value.language === 'string' &&
    typeof value.overview === 'string' &&
    Array.isArray(value.actions) &&
    value.actions.every(isActionPlanAction) &&
    (value.reach === null || isActionPlanReach(value.reach)) &&
    isStringArray(value.caveats) &&
    typeof value.generatedAt === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.noticeVersion === 'string'
  );
}

/**
 * Whether a response really is the Action Plan state.
 *
 * The report tests answer any `/scans/...` path with a scan or dashboard
 * object, and so can a stale deployment. A mismatch means "unavailable" and the
 * block renders nothing — never an idle button that would spend a generation.
 *
 * The plan itself is checked down to each Action, not just at the top level.
 * A plan is a document written by a model and stored for months: a record from
 * an older release whose `steps` is a string, or whose `reach` lost a field, is
 * exactly what the report must survive. Half-validating it would move the crash
 * from here into the renderer, where it takes the whole report down with it.
 */
export function isActionPlanState(value: unknown): value is ActionPlanState {
  if (!isRecord(value)) return false;
  if (
    typeof value.scanId !== 'string' ||
    !isStringArray(value.languages) ||
    !isNullableString(value.windowEndsAt)
  ) {
    return false;
  }
  if (
    !isRecord(value.remaining) ||
    typeof value.remaining.successes !== 'number' ||
    typeof value.remaining.attempts !== 'number'
  ) {
    return false;
  }
  if (
    value.running !== null &&
    (!isRecord(value.running) ||
      !isNullableString(value.running.language) ||
      !isNullableString(value.running.startedAt))
  ) {
    return false;
  }
  if (
    value.lastFailure !== null &&
    (!isRecord(value.lastFailure) ||
      !isNullableString(value.lastFailure.code) ||
      typeof value.lastFailure.language !== 'string')
  ) {
    return false;
  }
  return value.plan === null || isActionPlanContent(value.plan);
}
