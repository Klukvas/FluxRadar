// Optional proof that the account asking for an audit controls the site.
//
// It is deliberately additive: FluxRadar audits public pages, so nothing here
// gates a scan, a plan or a price — whether it ever should is still the owner's
// decision. What it provides is a checkable record of control,
// for the abuse and legal risk a paid deep crawl carries.

import { z } from 'zod';

/** How an owner may prove control. All three are public, read-only signals. */
export const DOMAIN_VERIFICATION_METHODS = ['dns-txt', 'file', 'meta'] as const;
export type DomainVerificationMethod = (typeof DOMAIN_VERIFICATION_METHODS)[number];

/**
 * `pending` means a token was issued and nothing has confirmed it yet;
 * `failed` means the last check ran and did not find the token — both are
 * states of a still-usable token, not a dead end.
 */
export const DOMAIN_VERIFICATION_STATUSES = ['pending', 'verified', 'failed'] as const;
export type DomainVerificationStatus = (typeof DOMAIN_VERIFICATION_STATUSES)[number];

/** The name an owner publishes the token under, in every method. */
export const DOMAIN_VERIFICATION_TOKEN_NAME = 'fluxradar-site-verification';

/** Where the file method looks; a fixed path, never one the client supplies. */
export const DOMAIN_VERIFICATION_FILE_PATH = '/.well-known/fluxradar-site-verification.txt';

export const DOMAIN_VERIFICATION_LIMITS = {
  /** Random bytes behind a token; rendered as lowercase hex. */
  tokenBytes: 24,
  /** A token nobody published within this window has to be re-issued. */
  tokenTtlDays: 30,
  /** A confirmed proof is re-checked after this, so control cannot go stale silently. */
  proofTtlDays: 180,
  /** Bytes read from the proof file before the read is cut off. */
  maxFileBytes: 4096,
  /** A resolver that does not answer must not hold a request open. */
  dnsTimeoutMs: 5_000,
  /** TXT records examined; a zone with thousands is not a reason to read them all. */
  maxTxtRecords: 50,
} as const;

export const domainVerificationStartInputSchema = z.object({
  method: z.enum(DOMAIN_VERIFICATION_METHODS),
});
export type DomainVerificationStartInput = z.infer<typeof domainVerificationStartInputSchema>;

/** The exact string a `dns-txt` or `file` proof has to contain. */
export function domainVerificationTokenRecord(token: string): string {
  return `${DOMAIN_VERIFICATION_TOKEN_NAME}=${token}`;
}
