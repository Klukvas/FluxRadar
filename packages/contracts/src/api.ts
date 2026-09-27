import { z } from 'zod';

import { MODULE_NAMES, PLANS } from './enums.js';
import { API_CHECK_LIMITS, CRAWL_LIMITS, CRAWL_SEED_LIMITS } from './limits.js';
import { TARIFFS } from './tariffs.js';

// bcrypt silently truncates passwords at 72 bytes, so longer input is rejected upfront.
const PASSWORD_MAX_BYTES = 72;
const PASSWORD_MIN_LENGTH = 8;

// D-028/D-111 limits are byte limits; z.string().max() counts UTF-16 code units,
// which would let multibyte input slip past the boundary.
const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;

const withinPasswordByteLimit = (value: string): boolean =>
  utf8ByteLength(value) <= PASSWORD_MAX_BYTES;

const passwordByteLimitMessage = `password must be at most ${PASSWORD_MAX_BYTES} bytes`;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .refine(withinPasswordByteLimit, { message: passwordByteLimitMessage });

export const registerInputSchema = z.object({
  email: z.email().max(254),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).refine(withinPasswordByteLimit, {
    message: passwordByteLimitMessage,
  }),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

const isHttpsOrigin = (value: string): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // A root slash is equivalent to the origin and is normalized away below;
  // non-root paths, queries and fragments remain invalid.
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
};

// Normalizing to url.origin lowercases the host and strips an explicit default port.
// Exported because a profile domain is not the only place an https origin is
// read: a server-side allowlist has to normalize the origins an operator writes
// by hand exactly the way a stored profile domain was normalized, or an exact
// match compares two spellings of the same site and answers no.
export const httpsOriginSchema = z
  .string()
  .refine((value) => utf8ByteLength(value) <= CRAWL_LIMITS.maxUrlBytes, {
    message: `domain must be at most ${CRAWL_LIMITS.maxUrlBytes} bytes`,
  })
  .refine(isHttpsOrigin, {
    message: 'domain must be a valid https origin without path, query, fragment, or credentials',
  })
  .transform((value) => new URL(value).origin);

export const siteProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: httpsOriginSchema,
  industry: z.string().trim().min(1).max(64).optional(),
  region: z.string().trim().min(1).max(64).optional(),
  language: z.string().trim().min(1).max(64).optional(),
  businessDescription: z.string().trim().min(1).max(800).optional(),
  offerings: z.string().trim().min(1).max(1200).optional(),
  targetLanguages: z.string().trim().min(1).max(200).optional(),
  targetAudience: z.string().trim().min(1).max(500).optional(),
  scanConfig: z.lazy(() => profileScanConfigSchema).optional(),
});
export type SiteProfileInput = z.infer<typeof siteProfileInputSchema>;

/**
 * The egress location a crawl leaves from: an ISO 3166-1 country code in lower
 * case, optionally narrowed (`de-fra`). Only the shape is checked here — which
 * locations exist, and which of them are up, is a fact of the deployment the
 * API checks at launch (apps/api/src/integrations/crawl-egress-locations.ts).
 */
export const egressLocationIdSchema = z
  .string()
  .max(16)
  .regex(/^[a-z]{2}(?:-[a-z0-9]{1,12})?$/, {
    message: 'egressLocation must be a lower-case country code, as in "ua" or "de-fra"',
  });
export type EgressLocationId = z.infer<typeof egressLocationIdSchema>;

/**
 * Where a scan leaves from when nobody chose: the Kyiv proxy every paid crawl
 * used before a choice existed (D-220, D-228).
 */
export const DEFAULT_EGRESS_LOCATION = 'ua' satisfies EgressLocationId;

/**
 * A public http(s) address a scan may be pointed at.
 *
 * Unlike `httpsOriginSchema` this keeps the path and query — a seed URL and an
 * API endpoint are both specific resources — but it refuses everything that
 * would make the request something other than an anonymous public GET:
 * credentials in the URL, a fragment the server never sees, and any scheme
 * other than http/https. Host-level scope is checked against the scanned site
 * separately, because only the scan knows what its site is.
 */
export const publicHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => utf8ByteLength(value) <= CRAWL_LIMITS.maxUrlBytes, {
    message: `url must be at most ${CRAWL_LIMITS.maxUrlBytes} bytes`,
  })
  .refine(
    (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username === '' &&
        url.password === '' &&
        url.hash === ''
      );
    },
    { message: 'must be an absolute http(s) URL without credentials or fragment' },
  )
  .transform((value) => new URL(value).href);

/**
 * One explicitly configured API check (§9 Reliability contract v1).
 *
 * Only GET and HEAD are accepted: a scan observes a public endpoint, it never
 * changes one. No request headers and no body are accepted at all — that is
 * what makes the no-credentials policy (REL-API-005) structural rather than a
 * rule that has to catch a mistake after the request went out.
 */
export const apiCheckInputSchema = z.object({
  method: z.enum(['GET', 'HEAD']).default('GET'),
  url: publicHttpUrlSchema,
  expectedStatus: z
    .array(z.number().int().min(100).max(599))
    .max(API_CHECK_LIMITS.maxExpectedStatuses)
    .optional(),
});
export type ApiCheckInput = z.infer<typeof apiCheckInputSchema>;

export const scanScopeSchema = z
  .object({
    includeSubdomains: z.boolean(),
    maxPages: z.number().int().min(1).optional(),
    maxDepth: z.number().int().min(0).max(100).optional(),
    urlPatterns: z
      .array(z.string().trim().min(1).max(CRAWL_LIMITS.maxUrlBytes))
      .max(100)
      .optional(),
    excludePatterns: z
      .array(z.string().trim().min(1).max(CRAWL_LIMITS.maxUrlBytes))
      .max(100)
      .optional(),
    /**
     * URLs the owner listed by hand. They are queued beside the origin and the
     * sitemap, and are filtered by exactly the same scope, robots and page
     * limit — a seed is a starting point, never an exemption.
     */
    seedUrls: z.array(publicHttpUrlSchema).max(CRAWL_SEED_LIMITS.maxSeedUrls).optional(),
    /**
     * Whether pages are rendered in a browser before the rules read them.
     * Off by default: it costs a browser per scan, and a scan whose runtime is
     * missing reports that rather than falling back to the static HTML.
     */
    renderJs: z.boolean().default(false),
    apiChecks: z.array(apiCheckInputSchema).max(API_CHECK_LIMITS.maxChecks).optional(),
    queryPolicy: z.enum(['include', 'ignore']).default('ignore'),
    respectRobots: z.boolean().default(true),
    robotsOverrideConfirmed: z.boolean().default(false),
    userAgent: z.enum(['desktop', 'mobile']).default('desktop'),
    /**
     * Absent means different things in different places, and none of them is
     * "Ukraine": a request that leaves it out gets the default location, and a
     * stored scan without it predates the choice — its location was never
     * recorded, and before the proxy existed it was not Kyiv at all.
     */
    egressLocation: egressLocationIdSchema.optional(),
  })
  .superRefine((scope, ctx) => {
    if (!scope.respectRobots && !scope.robotsOverrideConfirmed) {
      ctx.addIssue({
        code: 'custom',
        message: 'robotsOverrideConfirmed is required when respectRobots is false',
        path: ['robotsOverrideConfirmed'],
      });
    }
  });
export type ScanScopeInput = z.infer<typeof scanScopeSchema>;

const scanConfigSchema = z
  .object({
    plan: z.enum(PLANS),
    scope: scanScopeSchema,
  })
  .superRefine((input, ctx) => {
    const { urlLimit } = TARIFFS[input.plan];
    if (input.scope.maxPages !== undefined && input.scope.maxPages > urlLimit) {
      ctx.addIssue({
        code: 'custom',
        message: `maxPages exceeds the ${input.plan} plan limit of ${urlLimit} URLs`,
        path: ['scope', 'maxPages'],
      });
    }
  });
/**
 * What a site is checked with until its owner says otherwise.
 *
 * `maxPages` is deliberately absent, and absent means "the whole plan" — the
 * crawl stops at the tariff's URL limit (`buildCrawlScope`), not at a number
 * this file invented. It used to be 15. A Complete scan costs $120 and sells
 * 50,000 URLs, so every site with more than fifteen addresses was audited at a
 * few percent of itself by default, and the report had no way to say so.
 *
 * An owner who wants a smaller crawl still sets one; the difference is that the
 * limit is then theirs, is stored as theirs, and is named as theirs in the
 * report (see `crawlSummarySchema.limitedBy`).
 */
export const defaultProfileScanConfig = {
  plan: 'Complete',
  scope: {
    includeSubdomains: false,
    maxDepth: 5,
    renderJs: false,
    queryPolicy: 'ignore',
    respectRobots: true,
    robotsOverrideConfirmed: false,
    userAgent: 'desktop',
    egressLocation: DEFAULT_EGRESS_LOCATION,
  },
} as const satisfies z.input<typeof scanConfigSchema>;

export const profileScanConfigSchema = scanConfigSchema;
export type ProfileScanConfig = z.infer<typeof profileScanConfigSchema>;

export const expectedProfileConfigVersionSchema = z.number().int().min(1);
export const scanRequestInputSchema = scanConfigSchema.safeExtend({
  expectedProfileConfigVersion: expectedProfileConfigVersionSchema.optional(),
});
export type ScanRequestInput = z.infer<typeof scanRequestInputSchema>;

export const siteProfilePatchInputSchema = siteProfileInputSchema.partial().extend({
  industry: siteProfileInputSchema.shape.industry.unwrap().nullable().optional(),
  region: siteProfileInputSchema.shape.region.unwrap().nullable().optional(),
  language: siteProfileInputSchema.shape.language.unwrap().nullable().optional(),
  businessDescription: siteProfileInputSchema.shape.businessDescription
    .unwrap()
    .nullable()
    .optional(),
  offerings: siteProfileInputSchema.shape.offerings.unwrap().nullable().optional(),
  targetLanguages: siteProfileInputSchema.shape.targetLanguages.unwrap().nullable().optional(),
  targetAudience: siteProfileInputSchema.shape.targetAudience.unwrap().nullable().optional(),
  expectedProfileConfigVersion: expectedProfileConfigVersionSchema.optional(),
});
export type SiteProfilePatchInput = z.infer<typeof siteProfilePatchInputSchema>;

export const executionConfigSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.enum(['launch', 'legacy-checkout']),
  profileConfigVersion: expectedProfileConfigVersionSchema.nullable(),
  profile: siteProfileInputSchema.omit({ scanConfig: true }),
  plan: z.enum(PLANS),
  scope: scanScopeSchema,
});
export type ExecutionConfig = z.infer<typeof executionConfigSchema>;

// Resolved/Reopened are assigned only by fingerprint comparison between Complete
// scans (§14); users may never set them by hand.
export const USER_SETTABLE_ISSUE_STATUSES = [
  'New',
  'Acknowledged',
  'Ignored',
  'False Positive',
] as const;

export const issueStatusUpdateInputSchema = z.object({
  status: z.enum(USER_SETTABLE_ISSUE_STATUSES),
});
export type IssueStatusUpdateInput = z.infer<typeof issueStatusUpdateInputSchema>;

/** Uniform API response envelope: data and error are mutually exclusive. */
export type ApiEnvelope<T> =
  | { readonly ok: true; readonly data: T; readonly error: null }
  | { readonly ok: false; readonly data: null; readonly error: string };

// ---------------------------------------------------------------------------
// GET /scans/:scanId/comparison — this report against the previous scan.
// ---------------------------------------------------------------------------
//
// The shape exists to make one promise enforceable: a comparison either states a
// difference it can stand behind, or names why it cannot. That is why every
// number here sits beside a comparability verdict — the whole read, each module,
// and the page census separately — and why the reasons are a closed list rather
// than prose. A client can act on `scope-changed`; it cannot act on a sentence.

/**
 * Why two scans of one site are not two readings of the same thing.
 *
 * Each of these makes "the finding is gone" mean something other than "it was
 * fixed", so the report says which one happened instead of showing a delta:
 *
 *   no-previous-scan         first scan of this plan for the site;
 *   previous-plan-differs    earlier scans exist, but none of this plan — two
 *                            plans read different modules, so one's absence is
 *                            not the other's fix (§14, D-110);
 *   previous-not-readable    the previous scan is there, and its report is no
 *                            longer the account's to read: the purchase behind
 *                            it was reversed, suspended or expired. Every number
 *                            a comparison would state — a score, a page count, a
 *                            resolved finding — is derived from that report's own
 *                            rows, and a count derived from them is still a read
 *                            of them (D-216), so the answer carries the previous
 *                            scan's identity and nothing else;
 *   previous-not-usable      the earlier scan produced no usable output;
 *   scope-changed            the crawl was pointed at a different set of pages
 *                            (page limit, patterns, subdomains, query policy,
 *                            depth, render mode, entry URL, seeds, egress);
 *   *-crawl-truncated        that crawl stopped at its page limit, so the pages
 *                            it never read are missing rather than removed;
 *   *-stopped-early          that scan is not a finished one: paused, cancelled,
 *                            or terminal with a module that failed;
 *   crawl-not-recorded       one of them predates `Scan.crawlSummaryJson`, so
 *                            nobody can say whether its crawl was complete.
 */
export const COMPARISON_INCOMPARABLE_REASONS = [
  'no-previous-scan',
  'previous-plan-differs',
  'previous-not-readable',
  'previous-not-usable',
  'scope-changed',
  'current-crawl-truncated',
  'previous-crawl-truncated',
  'current-stopped-early',
  'previous-stopped-early',
  'crawl-not-recorded',
] as const;
export type ComparisonIncomparableReason = (typeof COMPARISON_INCOMPARABLE_REASONS)[number];

/**
 * Why one module carries no delta even when the two scans compare.
 *
 * A module that ran once is not a module that improved or regressed, and a
 * module with no score has nothing to subtract.
 */
export const MODULE_COMPARISON_REASONS = [
  'module-absent-previously',
  'module-absent-now',
  'module-not-scored-previously',
  'module-not-scored-now',
] as const;
export type ModuleComparisonReason = (typeof MODULE_COMPARISON_REASONS)[number];

/**
 * Why the pages of two scans cannot be diffed even when their findings can.
 *
 * The addresses a finished crawl read survive only in the re-check proof of the
 * plans that close findings (`RuleCoverageProof`), and that proof is kept for the
 * last two completed scans of a plan. An older report therefore compares its
 * findings and says this about its pages rather than inventing a census.
 */
export const PAGE_COMPARISON_REASONS = [
  'page-evidence-missing',
  'page-evidence-unreadable',
  'page-evidence-empty',
  /**
   * One scan named its pages by document and the other could not.
   *
   * Diffing the two under the weaker name would collapse redirect aliases on one
   * side only, so every alias of the other side would read as a page that
   * appeared or went. The census is refused instead of being drawn wrong.
   */
  'page-identity-mismatch',
  /** The two scans do not compare at all; the verdict above says why. */
  'scans-not-comparable',
] as const;
export type PageComparisonReason = (typeof PAGE_COMPARISON_REASONS)[number];

/**
 * Which name the page diff compared pages under.
 *
 * `canonical-document`: the address the site's own redirects say the document
 * lives at, one entry per document — `/p` and `/p/` are one page, so a change in
 * which form the site links does not read as one page removed and another added.
 * `crawl-address`: the address each snapshot was read under, used when no rule
 * of the run established document identity (a single-page crawl). The weaker of
 * the two, and named so the reader knows which one they are looking at.
 */
export const PAGE_IDENTITY_KINDS = ['canonical-document', 'crawl-address'] as const;
export type PageIdentityKind = (typeof PAGE_IDENTITY_KINDS)[number];

/** At most this many addresses or findings are listed per sample. */
export const COMPARISON_SAMPLE_LIMIT = 20;

/**
 * The one verdict shape every section of the comparison repeats.
 *
 * Declared here rather than in each consumer: the server's verdict builder and
 * the web client's mirror were two independent copies of it, and a shape this
 * small is exactly the kind that drifts unnoticed.
 */
export type Comparability<Reason extends string> =
  { readonly ok: true } | { readonly ok: false; readonly reason: Reason };

const comparabilitySchema = <Reason extends string>(reasons: readonly [Reason, ...Reason[]]) =>
  z.union([
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), reason: z.enum(reasons) }),
  ]);

/**
 * What a crawl was pointed at, as the verdict above reads it.
 *
 * Sent for both scans so a reader who is told "the scope changed" can see which
 * setting moved, instead of being asked to trust the word. `scopeKey` is the
 * crawl-filter fingerprint the re-check policy already compares runs by
 * (`crawlScopeKey`); the fields beside it are the ones it deliberately leaves
 * out, and a page diff needs them.
 */
export const crawlScopeFactsSchema = z.object({
  /** The address the crawl started from — the scan's own recorded origin. */
  entryUrl: z.string(),
  /** Page ceiling actually applied; null when the scan recorded none. */
  maxPages: z.number().int().min(1).nullable(),
  maxDepth: z.number().int().min(0).nullable(),
  includeSubdomains: z.boolean(),
  queryPolicy: z.enum(['include', 'ignore']),
  urlPatterns: z.array(z.string()).max(100),
  excludePatterns: z.array(z.string()).max(100),
  seedUrls: z.array(z.string()).max(CRAWL_SEED_LIMITS.maxSeedUrls),
  renderJs: z.boolean(),
  /**
   * Whether the crawl obeyed the site's own robots.txt.
   *
   * Beside `maxPages` for the same reason: the crawl RECORDS an address robots
   * closed, so the re-check policy can tolerate the difference — but a page
   * census cannot. Turning the rule off adds pages that would read as pages the
   * owner published.
   */
  respectRobots: z.boolean(),
  userAgent: z.string(),
  egressLocation: z.string().nullable(),
  /** Fingerprint of the crawl filters (`crawlScopeKey`); equal means equal. */
  scopeKey: z.string(),
});
export type CrawlScopeFacts = z.infer<typeof crawlScopeFactsSchema>;

/**
 * WHICH scan is being compared — never a word about what it found.
 *
 * These three fields name a report the way the reports list names it, and the
 * list is the one place a scan the account no longer owns still appears: it
 * carries the row "but without the report payload" (D-216). So this is the whole
 * of `previous` when that report is no longer readable, and the base of it when
 * it is.
 */
const comparedScanIdentity = {
  id: z.string(),
  plan: z.enum(PLANS),
  completedAt: z.string().nullable(),
} as const;

/** The previous scan of a report the account may not read: identity, and the flag. */
export const unreadableComparedScanSchema = z.object({
  ...comparedScanIdentity,
  /**
   * False: the purchase behind this scan was reversed, suspended or expired.
   *
   * Nothing else about the scan is here, and that is the point — a score, a page
   * total or a resolved count is derived from the report's own rows, and a count
   * derived from them is still a read of them. The verdict beside it is
   * `previous-not-readable`, so no section of the comparison carries a number
   * either.
   */
  readable: z.literal(false),
});
export type UnreadableComparedScan = z.infer<typeof unreadableComparedScanSchema>;

/** Which scan is being compared, in the terms a report header needs. */
export const readableComparedScanSchema = z.object({
  ...comparedScanIdentity,
  status: z.string(),
  /** From `Scan.crawlSummaryJson`; null on a scan that recorded no crawl. */
  pagesRead: z.number().int().min(0).nullable(),
  urlsDiscovered: z.number().int().min(0).nullable(),
  urlsOverLimit: z.number().int().min(0).nullable(),
  scope: crawlScopeFactsSchema,
  /**
   * True: this report is still the account's to open.
   *
   * Always true for `current` — the endpoint refuses a report the account may
   * not read at all. It is the discriminant of the union below, so a client that
   * reads `pagesRead` or `scope` has to check it first, and a server that fills
   * them in for an unreadable report cannot typecheck.
   */
  readable: z.literal(true),
});
export type ReadableComparedScan = z.infer<typeof readableComparedScanSchema>;

export const comparedScanSchema = z.discriminatedUnion('readable', [
  readableComparedScanSchema,
  unreadableComparedScanSchema,
]);
export type ComparedScan = z.infer<typeof comparedScanSchema>;

export const moduleScoreDeltaSchema = z.object({
  module: z.enum(MODULE_NAMES),
  previousScore: z.number().nullable(),
  currentScore: z.number().nullable(),
  /** Current minus previous; null whenever `comparable.ok` is false. */
  delta: z.number().nullable(),
  comparable: comparabilitySchema(MODULE_COMPARISON_REASONS),
});
export type ModuleScoreDelta = z.infer<typeof moduleScoreDeltaSchema>;

export const pageComparisonSchema = z.object({
  comparable: comparabilitySchema(PAGE_COMPARISON_REASONS),
  identity: z.enum(PAGE_IDENTITY_KINDS).nullable(),
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  kept: z.number().int().min(0),
  currentTotal: z.number().int().min(0),
  previousTotal: z.number().int().min(0),
  addedSample: z.array(z.string()).max(COMPARISON_SAMPLE_LIMIT),
  removedSample: z.array(z.string()).max(COMPARISON_SAMPLE_LIMIT),
});
export type PageComparison = z.infer<typeof pageComparisonSchema>;

const issueCountsSchema = z.object({
  /**
   * Fingerprint present now, absent from the previous scan, under a rule that
   * BOTH scans ran. A finding under a rule the previous scan never ran is not
   * news about the site — it is news about the product — and is counted in
   * `firstChecked` instead.
   */
  new: z.number().int().min(0),
  /** Findings of the previous scan this run closed (§14 Resolved policy). */
  resolved: z.number().int().min(0),
  /** Closed by an earlier scan of the plan and back — a subset of what is absent
      from the previous scan, so of `new` and `firstChecked` together. */
  reopened: z.number().int().min(0),
  /** Present in both scans, and still asking the owner for work. */
  stillOpen: z.number().int().min(0),
  /**
   * Present in both scans, and settled by the owner: Ignored or False Positive
   * (and Resolved, where a later scan has already closed it).
   *
   * Split out of `stillOpen` so the two numbers add up to "present in both" and
   * neither overstates the work left: a finding the owner marked a false
   * positive is not an open problem the report may keep counting.
   */
  settled: z.number().int().min(0),
});

export const issueSampleSchema = z.object({
  fingerprint: z.string(),
  ruleId: z.string(),
  module: z.string(),
  severity: z.string(),
  normalizedUrl: z.string(),
});
export type IssueSample = z.infer<typeof issueSampleSchema>;

/**
 * Findings under rules the previous scan never ran.
 *
 * The ruleset grows between two scans of a site, and it grows without moving
 * `RULESET_VERSION`: six page rules shipped in one week under the same version
 * string. Counted by fingerprint alone, every finding of a newly shipped rule is
 * "new" — the report would tell an owner who changed nothing that they had
 * introduced forty problems. What the stored re-check proof knows, and a version
 * string does not, is which rules actually ran in each scan, so these findings
 * are named for what they are: checked here for the first time.
 *
 * They are real findings and the Issue Center lists them; they are simply not a
 * difference between the two readings of the site.
 */
export const firstCheckedSchema = z.object({
  /**
   * Whether both scans recorded WHICH rules they ran.
   *
   * False means the separation above could not be made at all: the stored proof
   * of one of the two scans is gone — it is kept for the last two completed scans
   * of a plan — so nobody can say which rules ran there, and every finding of a
   * rule that shipped since is counted as `new` rather than as first-checked.
   * `count: 0` alone cannot say that: it reads as "no rule shipped between these
   * two scans", which is the opposite claim. Every report but the latest one of a
   * plan is in this state, so the reader is told.
   */
  known: z.boolean(),
  count: z.number().int().min(0),
  byModule: z.array(z.object({ module: z.string(), count: z.number().int().min(0) })),
  bySeverity: z.array(z.object({ severity: z.string(), count: z.number().int().min(0) })),
  /** The rules that ran here and not in the previous scan, sorted by id. */
  ruleIds: z.array(z.string()),
  sample: z.array(issueSampleSchema).max(COMPARISON_SAMPLE_LIMIT),
});
export type FirstCheckedFindings = z.infer<typeof firstCheckedSchema>;

export const issueComparisonSchema = issueCountsSchema.extend({
  byModule: z.array(issueCountsSchema.extend({ module: z.string() })),
  bySeverity: z.array(issueCountsSchema.extend({ severity: z.string() })),
  newSample: z.array(issueSampleSchema).max(COMPARISON_SAMPLE_LIMIT),
  resolvedSample: z.array(issueSampleSchema).max(COMPARISON_SAMPLE_LIMIT),
  firstChecked: firstCheckedSchema,
  /**
   * Rules the previous scan ran and this one did not — the other half of the
   * same honesty. No findings: a rule that did not run found nothing, and
   * whatever it had found before is absent for that reason and not because it
   * was fixed. The §14 Resolved policy already refuses to close those findings;
   * this is the report saying so out loud.
   */
  noLongerChecked: z.array(z.string()),
});
export type IssueComparison = z.infer<typeof issueComparisonSchema>;

export const scanComparisonSchema = z.object({
  current: readableComparedScanSchema,
  /**
   * Null exactly when `comparable` names a reason about there being none.
   *
   * Identity only — `readable: false` — when the report behind it is no longer
   * the account's; the verdict is then `previous-not-readable` and every section
   * below is empty rather than counted.
   */
  previous: comparedScanSchema.nullable(),
  comparable: comparabilitySchema(COMPARISON_INCOMPARABLE_REASONS),
  overall: z.object({
    previousScore: z.number().nullable(),
    currentScore: z.number().nullable(),
    delta: z.number().nullable(),
  }),
  modules: z.array(moduleScoreDeltaSchema),
  pages: pageComparisonSchema,
  issues: issueComparisonSchema,
});
export type ScanComparison = z.infer<typeof scanComparisonSchema>;
