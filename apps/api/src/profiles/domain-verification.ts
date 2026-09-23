// Checking that an account controls the site in one of its profiles.
//
// Three public, read-only proofs — a DNS TXT record, a file at a fixed
// well-known path, or a meta tag on the homepage — and a random token that
// means nothing on its own. The check is a read: it makes GET requests through
// the same SSRF guard as the crawler, and a DNS lookup of the site's own name.
// Nothing here gates a scan, a plan or a price: whether it ever should is
// still the owner's decision.

import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

import {
  DOMAIN_VERIFICATION_FILE_PATH,
  DOMAIN_VERIFICATION_LIMITS,
  DOMAIN_VERIFICATION_TOKEN_NAME,
  domainVerificationTokenRecord,
  type DomainVerificationMethod,
  type DomainVerificationStatus,
} from '@fluxradar/contracts';
import { SafeFetchError, safeFetch } from '@fluxradar/safe-fetch';
import type { DomainVerification, PrismaClient, SiteProfile } from '@prisma/client';
import { parse } from 'node-html-parser';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DomainVerificationDeps {
  /** Test seam; production resolves TXT records with node:dns. */
  readonly resolveTxtRecords?: (host: string) => Promise<readonly string[]>;
  /** Passthrough to safe-fetch for the local fixture site only. */
  readonly dangerouslyAllowLoopback?: boolean;
}

export interface DomainVerificationView {
  readonly method: DomainVerificationMethod;
  readonly status: DomainVerificationStatus;
  readonly domain: string;
  readonly token: string;
  /** The exact string to publish, for the DNS TXT and file methods. */
  readonly record: string;
  /** Where to publish it, in the owner's terms. */
  readonly instruction: string;
  readonly issuedAt: string;
  readonly tokenExpiresAt: string;
  readonly tokenExpired: boolean;
  readonly verifiedAt: string | null;
  readonly lastCheckedAt: string | null;
  readonly lastFailureReason: string | null;
  readonly attempts: number;
}

/**
 * Issues a fresh token for a profile, replacing any previous one.
 *
 * Re-issuing is how a proof is rotated and how the method is changed, so it is
 * deliberately destructive of the old token: two live tokens for one domain
 * would mean a proof could be satisfied by a record the owner thought they had
 * retired.
 */
export async function startDomainVerification(
  prisma: PrismaClient,
  profile: SiteProfile,
  method: DomainVerificationMethod,
  now: Date,
): Promise<DomainVerification> {
  const token = randomBytes(DOMAIN_VERIFICATION_LIMITS.tokenBytes).toString('hex');
  const tokenExpiresAt = new Date(now.getTime() + DOMAIN_VERIFICATION_LIMITS.tokenTtlDays * DAY_MS);
  const data = {
    accountId: profile.accountId,
    domain: profile.domain,
    method,
    token,
    status: 'pending',
    issuedAt: now,
    tokenExpiresAt,
    verifiedAt: null,
    lastCheckedAt: null,
    lastFailureReason: null,
    attempts: 0,
  };
  return prisma.domainVerification.upsert({
    where: { siteProfileId: profile.id },
    create: { siteProfileId: profile.id, ...data },
    update: data,
  });
}

/** The proof on record for a profile, or null when none was ever started. */
export async function findDomainVerification(
  prisma: PrismaClient,
  siteProfileId: string,
  accountId: string,
): Promise<DomainVerification | null> {
  const record = await prisma.domainVerification.findUnique({ where: { siteProfileId } });
  // Another account's row is indistinguishable from no row at all, exactly as
  // another account's profile is.
  return record !== null && record.accountId === accountId ? record : null;
}

/**
 * Runs the proof and records what it found.
 *
 * A stale token is refused before any request: an expired token that later
 * appears in DNS proves control at an unknown time, which is not what the
 * record is supposed to say. A profile moved to another domain is refused for
 * the same reason — the token was issued for the address it names.
 *
 * The result is written under a compare-and-set on the token it was issued
 * against. Checking a proof takes a DNS lookup or an HTTP request, and the
 * owner can rotate the token during that window; an update by row id would then
 * mark the *new* token verified on the strength of a check of the old one.
 */
export async function verifyDomainOwnership(
  prisma: PrismaClient,
  profile: SiteProfile,
  record: DomainVerification,
  now: Date,
  deps: DomainVerificationDeps = {},
): Promise<DomainVerification> {
  if (record.domain !== profile.domain) {
    return recordFailure(prisma, record, now, 'DomainChangedSinceTokenIssued');
  }
  if (record.tokenExpiresAt.getTime() <= now.getTime()) {
    return recordFailure(prisma, record, now, 'TokenExpired');
  }
  const outcome = await runProof(
    record.method as DomainVerificationMethod,
    profile.domain,
    record.token,
    deps,
  );
  if (!outcome.found) {
    return recordFailure(prisma, record, now, outcome.reason);
  }
  // A count of zero means the token was re-issued while this check was running.
  // The check proved something about a token that has since been retired, so it
  // proves nothing about the one on record now, and the row is left as it
  // stands — which is exactly what re-reading it returns.
  await prisma.domainVerification.updateMany({
    where: issuedTokenMatches(record),
    data: {
      status: 'verified',
      verifiedAt: now,
      lastCheckedAt: now,
      lastFailureReason: null,
      attempts: { increment: 1 },
    },
  });
  return prisma.domainVerification.findUniqueOrThrow({ where: { id: record.id } });
}

/**
 * The row as it was when this check started: same row, same token, same domain,
 * same issue time. Anything else is a different proof wearing the same id.
 */
function issuedTokenMatches(record: DomainVerification): {
  readonly id: string;
  readonly token: string;
  readonly domain: string;
  readonly issuedAt: Date;
} {
  return {
    id: record.id,
    token: record.token,
    domain: record.domain,
    issuedAt: record.issuedAt,
  };
}

type ProofOutcome = { readonly found: true } | { readonly found: false; readonly reason: string };

async function runProof(
  method: DomainVerificationMethod,
  domain: string,
  token: string,
  deps: DomainVerificationDeps,
): Promise<ProofOutcome> {
  const expected = domainVerificationTokenRecord(token);
  if (method === 'dns-txt') return dnsProof(domain, expected, deps);
  if (method === 'file') return fileProof(domain, expected, deps);
  return metaProof(domain, token, deps);
}

async function dnsProof(
  domain: string,
  expected: string,
  deps: DomainVerificationDeps,
): Promise<ProofOutcome> {
  const host = new URL(domain).hostname;
  let records: readonly string[];
  try {
    records = await withDeadline(
      (deps.resolveTxtRecords ?? defaultTxtRecords)(host),
      DOMAIN_VERIFICATION_LIMITS.dnsTimeoutMs,
    );
  } catch {
    // A missing TXT record, a broken resolver and a resolver that never answers
    // look the same to the owner; all three mean "we could not read the proof",
    // never "the proof is wrong".
    return { found: false, reason: 'DnsLookupFailed' };
  }
  // A host can publish a great many TXT records; only a bounded prefix is read,
  // so a large zone cannot turn a proof into a long string comparison.
  return records
    .slice(0, DOMAIN_VERIFICATION_LIMITS.maxTxtRecords)
    .some((entry) => entry.trim() === expected)
    ? { found: true }
    : { found: false, reason: 'TxtRecordNotFound' };
}

async function defaultTxtRecords(host: string): Promise<readonly string[]> {
  // Node returns each record as its own array of strings, because a long TXT
  // value is split into 255-byte chunks on the wire; joining is what makes it
  // the value the owner actually published.
  const records = await resolveTxt(host);
  return records.map((chunks) => chunks.join(''));
}

/** Rejects when a lookup with no timeout of its own takes too long. */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('domain verification: lookup timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fileProof(
  domain: string,
  expected: string,
  deps: DomainVerificationDeps,
): Promise<ProofOutcome> {
  const url = new URL(DOMAIN_VERIFICATION_FILE_PATH, domain).href;
  try {
    const response = await safeFetch(url, {
      method: 'GET',
      headers: { 'user-agent': 'FluxRadarBot/0.1' },
      maxBodyBytes: DOMAIN_VERIFICATION_LIMITS.maxFileBytes,
      ...(deps.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
    });
    const offDomain = servedOffDomain(domain, response.finalUrl);
    if (offDomain !== null) return offDomain;
    if (response.status !== 200) {
      return { found: false, reason: `FileStatus${response.status}` };
    }
    return isTokenFile(response.body, expected)
      ? { found: true }
      : { found: false, reason: 'FileTokenMismatch' };
  } catch (error) {
    return {
      found: false,
      reason: error instanceof SafeFetchError ? error.name : 'FileReadFailed',
    };
  }
}

/**
 * Whether the file served at the well-known path *is* the token.
 *
 * A line-wise exact comparison, never a substring one: "the response contains
 * this token somewhere" would accept any 200 at that path that happens to echo
 * it — a paste bin, an error page quoting the request. Surrounding whitespace
 * and a trailing newline are tolerated because an editor adds them; anything
 * else on the line is a different file.
 */
function isTokenFile(body: string, expected: string): boolean {
  return body.split(/\r?\n/).some((line) => line.trim() === expected);
}

async function metaProof(
  domain: string,
  token: string,
  deps: DomainVerificationDeps,
): Promise<ProofOutcome> {
  try {
    const response = await safeFetch(domain, {
      method: 'GET',
      headers: { 'user-agent': 'FluxRadarBot/0.1' },
      ...(deps.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
    });
    const offDomain = servedOffDomain(domain, response.finalUrl);
    if (offDomain !== null) return offDomain;
    if (response.status !== 200) {
      return { found: false, reason: `HomepageStatus${response.status}` };
    }
    const meta = parse(response.body).querySelector(
      `meta[name="${DOMAIN_VERIFICATION_TOKEN_NAME}"]`,
    );
    const content = meta?.getAttribute('content')?.trim();
    return content === token
      ? { found: true }
      : { found: false, reason: content === undefined ? 'MetaTagNotFound' : 'MetaTokenMismatch' };
  } catch (error) {
    return {
      found: false,
      reason: error instanceof SafeFetchError ? error.name : 'HomepageReadFailed',
    };
  }
}

/**
 * Refuses a proof that a redirect fetched from somewhere else.
 *
 * Control of `example.com` is what is being established, so the token has to be
 * served *by* `example.com`. A site that redirects the well-known path — or its
 * homepage — anywhere else would otherwise let whoever runs that other host
 * decide whether this account owns the domain, and `www.` is not an exception:
 * it is a different name, and an owner who cannot serve the file on the bare
 * domain still has the DNS method. Returns null when the response did come from
 * the domain, so the caller carries on.
 */
function servedOffDomain(domain: string, finalUrl: string): ProofOutcome | null {
  let expected: string;
  let actual: string;
  try {
    // `host`, not `hostname`: a redirect onto another port is another service.
    // Default ports are absent from `host`, so an http → https upgrade of the
    // same name still matches, which is the one redirect worth allowing.
    expected = new URL(domain).host;
    actual = new URL(finalUrl).host;
  } catch {
    return { found: false, reason: 'ProofUrlUnreadable' };
  }
  return expected === actual ? null : { found: false, reason: 'ProofServedByAnotherHost' };
}

async function recordFailure(
  prisma: PrismaClient,
  record: DomainVerification,
  now: Date,
  reason: string,
): Promise<DomainVerification> {
  // Guarded by the same compare-and-set as the success path. A failure written
  // blindly would be just as wrong the other way round: it would stamp "we
  // looked and it was not there" onto a token that had only just been issued
  // and that nobody has had a chance to publish yet.
  await prisma.domainVerification.updateMany({
    where: issuedTokenMatches(record),
    data: {
      // A proof that was confirmed once is not un-confirmed by a later read
      // failing: the record keeps its verified state and says the last check
      // did not find it, which is the honest description of both facts.
      status: record.status === 'verified' ? 'verified' : 'failed',
      lastCheckedAt: now,
      lastFailureReason: reason,
      attempts: { increment: 1 },
    },
  });
  return prisma.domainVerification.findUniqueOrThrow({ where: { id: record.id } });
}

/** Whether a confirmed proof is old enough that it should be checked again. */
export function isProofStale(record: DomainVerification, now: Date): boolean {
  if (record.verifiedAt === null) return true;
  return (
    now.getTime() - record.verifiedAt.getTime() > DOMAIN_VERIFICATION_LIMITS.proofTtlDays * DAY_MS
  );
}

export function toDomainVerificationView(
  record: DomainVerification,
  now: Date,
): DomainVerificationView {
  const method = record.method as DomainVerificationMethod;
  return {
    method,
    status: record.status as DomainVerificationStatus,
    domain: record.domain,
    token: record.token,
    record: domainVerificationTokenRecord(record.token),
    instruction: instructionFor(method, record.domain),
    issuedAt: record.issuedAt.toISOString(),
    tokenExpiresAt: record.tokenExpiresAt.toISOString(),
    tokenExpired: record.tokenExpiresAt.getTime() <= now.getTime(),
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: record.lastCheckedAt?.toISOString() ?? null,
    lastFailureReason: record.lastFailureReason,
    attempts: record.attempts,
  };
}

function instructionFor(method: DomainVerificationMethod, domain: string): string {
  const host = new URL(domain).hostname;
  if (method === 'dns-txt') {
    return `Add a TXT record on ${host} whose value is the record below.`;
  }
  if (method === 'file') {
    return `Publish the record below as plain text at ${domain}${DOMAIN_VERIFICATION_FILE_PATH}.`;
  }
  return `Add <meta name="${DOMAIN_VERIFICATION_TOKEN_NAME}" content="…"> to the homepage of ${domain}, with the token as its content.`;
}
