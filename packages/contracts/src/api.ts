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
const httpsOriginSchema = z
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
});
export type SiteProfileInput = z.infer<typeof siteProfileInputSchema>;

export const scanScopeSchema = z.object({
  includeSubdomains: z.boolean(),
  maxPages: z.number().int().min(1).optional(),
  maxDepth: z.number().int().min(0).max(100).optional(),
  urlPatterns: z.array(z.string().trim().min(1).max(CRAWL_LIMITS.maxUrlBytes)).max(100).optional(),
  excludePatterns: z
    .array(z.string().trim().min(1).max(CRAWL_LIMITS.maxUrlBytes))
    .max(100)
    .optional(),
  queryPolicy: z.enum(['include', 'ignore']).default('ignore'),
  respectRobots: z.boolean().default(true),
  robotsOverrideConfirmed: z.boolean().default(false),
  userAgent: z.enum(['desktop', 'mobile']).default('desktop'),
}).superRefine((scope, ctx) => {
  if (!scope.respectRobots && !scope.robotsOverrideConfirmed) {
    ctx.addIssue({
      code: 'custom',
      message: 'robotsOverrideConfirmed is required when respectRobots is false',
      path: ['robotsOverrideConfirmed'],
    });
  }
});
export type ScanScopeInput = z.infer<typeof scanScopeSchema>;

export const scanRequestInputSchema = z
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
export type ScanRequestInput = z.infer<typeof scanRequestInputSchema>;

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
