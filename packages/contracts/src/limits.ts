// Crawler resource limits per D-028 (per page/URL) and D-030 (per host).
export const CRAWL_LIMITS = {
  maxHtmlBytes: 5 * 1024 * 1024,
  maxUrlBytes: 2048,
  maxRedirects: 5,
  pageTimeoutMs: 10_000,
  perHostRps: 5,
  perHostConcurrency: 4,
  /**
   * How many internal media files one crawl may verify with a HEAD request.
   *
   * CONTENT-004 used to report "internal media not confirmed by the crawl" as a
   * Medium finding worth a score penalty, on a crawler that fetched no media at
   * all — a penalty for something nobody had looked at. The crawl now looks,
   * within this budget, and anything past it is reported as unchecked rather
   * than as broken.
   */
  maxMediaChecks: 200,
} as const;

/**
 * Explicit crawl seeds (an owner pasting the URLs they care about).
 *
 * Seeds are a way to reach pages discovery would miss, never a second tariff:
 * they are queued like any other URL and the plan's page limit still decides
 * how many are fetched.
 */
export const CRAWL_SEED_LIMITS = {
  maxSeedUrls: 200,
} as const;

/**
 * Explicitly configured public API checks (§9 Reliability contract v1).
 *
 * The method allowlist lives in the rules engine; these are the resource bounds
 * a scan applies to them: a bounded list, a bounded expectation and a request
 * deadline of its own, so a slow endpoint cannot consume the page budget.
 */
export const API_CHECK_LIMITS = {
  maxChecks: 20,
  maxExpectedStatuses: 10,
  timeoutMs: 10_000,
  /**
   * Redirect hops a check may follow. Each one is re-checked against the
   * scanned site: a configured endpoint that answers `302 Location: somebody
   * else` must not turn the check into a request aimed at a third party, and
   * must not report that third party's status as the endpoint's own.
   */
  maxRedirects: 3,
} as const;

/**
 * Budgets for one JS-rendered page. Rendering opens a real browser, so every
 * dimension it can grow in is capped: how long a navigation may take, how many
 * subresources it may pull and how many bytes those may add up to.
 */
export const RENDER_LIMITS = {
  navigationTimeoutMs: 20_000,
  /** Idle window after load before the DOM is read. */
  settleMs: 750,
  maxSubresources: 100,
  /** Aggregate body bytes one rendered page may pull in. */
  maxSubresourceBytes: 8 * 1024 * 1024,
  /** Cap on a single response, so one huge file cannot take the whole budget. */
  maxBytesPerSubresource: 2 * 1024 * 1024,
  /** Redirect hops a subresource may take; every hop is re-vetted. */
  maxSubresourceRedirects: 3,
} as const;

/**
 * Checking that the images, video and audio a page references actually exist.
 *
 * A crawl fetches pages, not media, so without this a broken image can only be
 * guessed at. The probes are cheap by construction — HEAD, a small GET only
 * when HEAD is refused — but they are still requests to someone's site, so the
 * count is capped well below the page budget and the bytes far below it.
 */
export const MEDIA_PROBE_LIMITS = {
  /** Resources actually requested. Everything past this is reported unverified. */
  maxProbes: 200,
  /** Entries kept in the result, probed or not, so the report stays bounded. */
  maxRecorded: 1000,
  /** A GET fallback reads only enough to learn the status and the type. */
  maxFallbackBytes: 16 * 1024,
  timeoutMs: 10_000,
} as const;

/**
 * What a paused scan may persist so it can continue after a process restart.
 *
 * The checkpoint is the *index* of a paused run: which stages finished, what
 * was left in the frontier, and which already-read pages could not be kept.
 * The pages themselves live in the evidence store below, because a JSON column
 * is the wrong place for a site's worth of HTML.
 */
export const SCAN_CHECKPOINT_LIMITS = {
  maxFrontierUrls: 2000,
  /**
   * Pages that were read but whose evidence was not retained. They go back on
   * the frontier when the scan resumes, so this list is a re-fetch queue, not
   * a record of work already done.
   */
  maxUnretainedUrls: 2000,
  /** Duplicate-URL groups carried across a pause (input for SEO-TECH-007). */
  maxUrlVariantGroups: 500,
  /** Per-list cap for the coverage lists: skipped, robots-blocked, errors. */
  maxCoverageEntries: 1000,
  maxBytes: 1024 * 1024,
  /** A checkpoint nobody resumed is swept with the rest of the retention pass. */
  expiryDays: 14,
} as const;

/**
 * The pages a paused run keeps, so resuming does not re-read the site.
 *
 * This is the expensive half of a pause and the reason it has hard bounds. A
 * page that does not fit is not stored *and not silently forgotten*: its URL
 * goes back on the frontier, so the resumed scan re-reads it. The alternative —
 * keeping the URL as "done" with its evidence gone — would quietly turn a
 * resume into a partial scan wearing a full scan's label.
 */
export const SCAN_EVIDENCE_LIMITS = {
  /** Pages kept per paused scan. */
  maxPages: 1000,
  /** Compressed size of one stored page; a larger page is re-fetched instead. */
  maxPageBytes: 512 * 1024,
  /** Compressed size of the whole store for one scan. */
  maxTotalBytes: 32 * 1024 * 1024,
  /**
   * Compressed size of one scan's media-probe results.
   *
   * Kept separate and small: the probes are a bounded list of URLs and
   * statuses, never bodies. A set that does not fit is not stored, and the
   * resumed scan probes again — the honest fallback, not a silent partial.
   */
  maxResourceBytes: 2 * 1024 * 1024,
  /** Rows written per statement, so one pause is not one transaction per page. */
  writeBatchSize: 50,
  expiryDays: 14,
} as const;

// Hard caps per single AI request (§5). Exceeding input is truncated deterministically
// with a '[TRUNCATED]' marker; output hitting the cap gets finish_reason='length'.
export const AI_REQUEST_CAPS = {
  maxInputTokens: 8000,
  maxOutputTokens: 2000,
  maxReasoningUnits: 4000,
  maxSearchUnits: 8,
  maxCitationUnits: 32,
  /**
   * Input tokens one provider web search may add on top of maxInputTokens.
   * Search content is billed and reported as input, so a search-enabled answer
   * legitimately exceeds the prompt cap; the response contract allows
   * maxInputTokens + searchUnits * maxSearchContentTokens and nothing more —
   * which keeps provider-truth usage inside the §5 contract instead of
   * clamping the number and hiding spend.
   * One Anthropic search measured 10-13k input tokens on 2026-09-22, so 8000
   * left no margin and a slightly fuller result page would have discarded a
   * valid answer as a contract violation; 16000 keeps that headroom.
   */
  maxSearchContentTokens: 16000,
} as const;

/**
 * The caps one AI request runs under. Requests outside the scan pipeline —
 * the Action Plan (D-232) — override them, and everything that enforces a cap
 * reads this shape instead of the module-level constant.
 */
export interface AiRequestCapsShape {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxReasoningUnits: number;
  readonly maxSearchUnits: number;
  readonly maxCitationUnits: number;
  readonly maxSearchContentTokens: number;
}

// §16 data dictionary: evidence_excerpt is capped in Unicode characters, not bytes.
export const EVIDENCE_EXCERPT_MAX_CHARS = 2048;

// CONTENT-003 boundary: a page with fewer visible text characters is empty/low-value.
export const CONTENT_LOW_VALUE_MIN_VISIBLE_CHARS = 200;
