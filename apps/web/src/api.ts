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

export interface ProfileScanConfig {
  readonly plan: 'Free' | 'Basic' | 'Complete';
  readonly scope: {
    readonly includeSubdomains: boolean;
    readonly maxPages?: number;
    readonly maxDepth?: number;
    readonly urlPatterns?: readonly string[];
    readonly excludePatterns?: readonly string[];
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
  readonly plan: 'Free' | 'Basic' | 'Complete';
  readonly domain: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly scope: {
    readonly includeSubdomains: boolean;
    readonly maxPages?: number;
    readonly maxDepth?: number;
    readonly urlPatterns?: readonly string[];
    readonly excludePatterns?: readonly string[];
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
  readonly progress: { readonly completedModules: number; readonly totalModules: number };
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
  readonly plan: 'Basic' | 'Complete' | string;
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
  }[];
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
