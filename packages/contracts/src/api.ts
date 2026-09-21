import { z } from 'zod';

import { PLANS } from './enums.js';
import { CRAWL_LIMITS } from './limits.js';
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
