// D-216 as a test rather than a promise: the previous report of a reversed
// purchase is never read.
//
// Every number a comparison states — a score, a page total, a resolved finding —
// is derived from the previous report's own rows, and a count derived from them
// is still a read of them. The endpoint therefore names that scan and stops. The
// shape of the answer is pinned by the contract; what is pinned here is the
// BEHAVIOUR behind it, because a build that loaded the rows and then dropped the
// numbers would pass every assertion about the payload.
//
// So the database here is a stand-in that throws on any read but the two the
// path is allowed to make. The second test is its receipt: with the same
// purchase intact, the previous side IS loaded, so the trap in the first test is
// a trap and not an accident of how few queries this path happens to run.

import { scanComparisonSchema } from '@fluxradar/contracts';
import type { PrismaClient, Scan } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { NO_ISSUE_COMPARISON } from './issue-diff.ts';
import { buildScanComparison } from './build.ts';

const CURRENT_ID = 'scan-current';
const PREVIOUS_ID = 'scan-previous';
const NOW = new Date('2026-09-20T00:00:00.000Z');
const EARLIER = new Date('2026-09-10T00:00:00.000Z');

/** Values that may only appear in the answer if the previous report was read. */
const PREVIOUS_DOMAIN = 'https://previous-only.example';
const PREVIOUS_PAGES_READ = 777;
const PREVIOUS_EGRESS = 'previous-only-egress';

function scanRow(overrides: Record<string, unknown> = {}): Scan {
  return {
    id: CURRENT_ID,
    accountId: 'account-1',
    siteProfileId: 'profile-1',
    plan: 'Complete',
    status: 'Completed',
    statusReason: null,
    createdAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    domain: 'https://current.example',
    executionConfigJson: null,
    scopeJson: JSON.stringify({ includeSubdomains: false, egressLocation: 'ua' }),
    crawlSummaryJson: JSON.stringify({ pagesRead: 12, urlsDiscovered: 12, urlsOverLimit: 0 }),
    purchaseId: 'purchase-current',
    rulesetVersion: 'rules-mvp-0.1',
    ...overrides,
  } as unknown as Scan;
}

/** The §14 previous scan, loaded with its paid-access include. */
function previousRow(purchase: Record<string, unknown>): Scan {
  return scanRow({
    id: PREVIOUS_ID,
    createdAt: EARLIER,
    startedAt: EARLIER,
    completedAt: EARLIER,
    domain: PREVIOUS_DOMAIN,
    scopeJson: JSON.stringify({ includeSubdomains: false, egressLocation: PREVIOUS_EGRESS }),
    crawlSummaryJson: JSON.stringify({
      pagesRead: PREVIOUS_PAGES_READ,
      urlsDiscovered: PREVIOUS_PAGES_READ,
      urlsOverLimit: 0,
    }),
    purchaseId: 'purchase-previous',
    purchase,
  });
}

const REFUNDED = {
  status: 'Refunded',
  entitlement: { suspended: true, expiresAt: new Date('2099-01-01T00:00:00.000Z') },
};
const PAID = {
  status: 'paid',
  entitlement: { suspended: false, expiresAt: new Date('2099-01-01T00:00:00.000Z') },
};

const MODULES = [
  { module: 'SEO', runtimeStatus: 'Completed', score: 60, usableOutput: true, coverage: 1 },
];

/**
 * A database that answers the two allowed reads and throws on everything else.
 *
 * `mayReadModulesOf` is the whole point: a scan id absent from it is a scan this
 * path promised not to read, and asking for its rows fails the test where it
 * happens instead of somewhere downstream.
 */
function prismaStandIn(options: {
  readonly previous: Scan;
  readonly mayReadModulesOf: readonly string[];
}): { readonly prisma: PrismaClient; readonly calls: readonly string[] } {
  const calls: string[] = [];
  const answer = (model: string, method: string, args: unknown): unknown => {
    calls.push(`${model}.${method}`);
    if (model === 'scan' && method === 'findFirst') return Promise.resolve(options.previous);
    if (model === 'scanModule' && method === 'findMany') {
      const { where } = args as { where: { scanId: string } };
      if (options.mayReadModulesOf.includes(where.scanId)) return Promise.resolve(MODULES);
    }
    throw new Error(`the comparison read ${model}.${method} with ${JSON.stringify(args)}`);
  };
  const modelOf = (model: string): unknown =>
    new Proxy(
      {},
      { get: (_target, method) => (args: unknown) => answer(model, String(method), args) },
    );
  const prisma = new Proxy({}, { get: (_target, model) => modelOf(String(model)) });
  return { prisma: prisma as PrismaClient, calls };
}

describe('buildScanComparison against a previous report the account may not read', () => {
  it('reads nothing of it but the row that selected it, and states nothing derived from it', async () => {
    const { prisma, calls } = prismaStandIn({
      previous: previousRow(REFUNDED),
      mayReadModulesOf: [CURRENT_ID],
    });

    const comparison = await buildScanComparison({ prisma }, scanRow());
    const parsed = scanComparisonSchema.parse(comparison);

    expect([...calls].sort()).toEqual(['scan.findFirst', 'scanModule.findMany']);
    expect(parsed.comparable).toEqual({ ok: false, reason: 'previous-not-readable' });
    expect(parsed.previous).toEqual({
      id: PREVIOUS_ID,
      plan: 'Complete',
      completedAt: EARLIER.toISOString(),
      readable: false,
    });
    expect(parsed.overall.previousScore).toBeNull();
    expect(parsed.overall.delta).toBeNull();
    expect(parsed.modules).toEqual([]);
    expect(parsed.pages.previousTotal).toBe(0);
    expect(parsed.issues).toEqual(NO_ISSUE_COMPARISON);
    // Nothing that only the previous report could have supplied: not its entry
    // URL, not what its crawl read, not where it left from.
    const answer = JSON.stringify(comparison);
    expect(answer).not.toContain(PREVIOUS_DOMAIN);
    expect(answer).not.toContain(String(PREVIOUS_PAGES_READ));
    expect(answer).not.toContain(PREVIOUS_EGRESS);
  });

  it('does load that same previous scan once its purchase is intact', async () => {
    // The receipt for the test above: the scope of the two runs differs, so the
    // verdict stops before the findings — and the previous side has already been
    // loaded by then, which is exactly the read the refusal above prevents.
    const { prisma, calls } = prismaStandIn({
      previous: previousRow(PAID),
      mayReadModulesOf: [CURRENT_ID, PREVIOUS_ID],
    });

    const parsed = scanComparisonSchema.parse(await buildScanComparison({ prisma }, scanRow()));

    expect(calls.filter((call) => call === 'scanModule.findMany')).toHaveLength(2);
    expect(parsed.comparable).toEqual({ ok: false, reason: 'scope-changed' });
    expect(parsed.previous?.readable).toBe(true);
  });
});
