// The page half of a comparison: which addresses each scan read, under which
// name, and what the answer is when that record is gone.
//
// This is the part with no second source. A finished scan keeps no page list —
// the stored snapshots are a paused run's evidence and every terminal path
// deletes them — so the census is read out of the re-check proof, and the tests
// here pin both what that gives and what it cannot: a proof that was pruned, one
// that will not decode, and one that names no page.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildScanComparison } from './build.ts';
import { diffPages, pageSetsFor, readPageCensus } from './page-census.ts';
import { silentLogger } from '../../http/logger.ts';
import {
  allModules,
  canonicalRuleCoverage,
  finishScan,
  pageRuleCoverage,
} from '../../test-utils/comparison-fixtures.ts';
import { purchaseScan } from '../../test-utils/purchase-scan.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from '../../test-utils/test-db.ts';

const SITE = 'https://example.com';

describe('the page census of two finished scans', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function buy(): Promise<string> {
    const { scanId } = await purchaseScan(db.prisma, {
      siteProfileId: account.siteProfileId,
      plan: 'Complete',
      scope: { maxPages: 500 },
    });
    return scanId;
  }

  async function compare(currentId: string) {
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: currentId } });
    return buildScanComparison({ prisma: db.prisma, logger: silentLogger }, scan);
  }

  it('compares documents, not link forms, when both scans named document addresses', async () => {
    // `/deep.html` redirects to `/deep/`. The first crawl reached the document
    // under both addresses because the sitemap listed one and the navigation the
    // other; the second reached it only under its own address. Nothing about the
    // page changed, and the comparison must not report one removed.
    const firstId = await buy();
    await finishScan(db.prisma, firstId, {
      proofs: {
        SEO: [
          pageRuleCoverage([`${SITE}/`, `${SITE}/deep.html`, `${SITE}/deep/`]),
          canonicalRuleCoverage([`${SITE}/`, `${SITE}/deep/`]),
        ],
      },
    });
    const secondId = await buy();
    await finishScan(db.prisma, secondId, {
      proofs: {
        SEO: [
          pageRuleCoverage([`${SITE}/`, `${SITE}/deep/`]),
          canonicalRuleCoverage([`${SITE}/`, `${SITE}/deep/`]),
        ],
      },
    });

    const comparison = await compare(secondId);

    expect(comparison.pages.identity).toBe('canonical-document');
    expect(comparison.pages).toMatchObject({ added: 0, removed: 0, kept: 2 });
  });

  it('falls back to crawl addresses, and says so, when no rule named a document', async () => {
    // A one-page crawl leaves the duplicate-value rules with nothing to compare,
    // so no canonical census exists. The weaker identity is used and named,
    // rather than silently reported as if aliases had been collapsed.
    const firstId = await buy();
    await finishScan(db.prisma, firstId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/`, `${SITE}/old`])] },
    });
    const secondId = await buy();
    await finishScan(db.prisma, secondId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/`, `${SITE}/fresh`])] },
    });

    const comparison = await compare(secondId);

    expect(comparison.pages.identity).toBe('crawl-address');
    expect(comparison.pages).toMatchObject({ added: 1, removed: 1, kept: 1 });
    expect(comparison.pages.addedSample).toEqual([`${SITE}/fresh`]);
    expect(comparison.pages.removedSample).toEqual([`${SITE}/old`]);
  });

  it('unions the page rules of every module that ran', async () => {
    const firstId = await buy();
    await finishScan(db.prisma, firstId, {
      proofs: {
        SEO: [pageRuleCoverage([`${SITE}/`])],
        'Content Quality': [{ ruleId: 'CONTENT-003', checkedTargets: [`${SITE}/blog`] }],
      },
    });
    const secondId = await buy();
    await finishScan(db.prisma, secondId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/`])] },
    });

    const comparison = await compare(secondId);

    expect(comparison.pages.previousTotal).toBe(2);
    expect(comparison.pages.currentTotal).toBe(1);
    expect(comparison.pages.removedSample).toEqual([`${SITE}/blog`]);
  });

  it('ignores the targets of rules that judge something other than a page', async () => {
    // A site rule's targets are the whole site, and a media probe's are files.
    // Counting either as a page would invent addresses the crawl never read.
    const firstId = await buy();
    await finishScan(db.prisma, firstId, {
      proofs: {
        SEO: [pageRuleCoverage([`${SITE}/`]), { ruleId: 'SEO-TECH-007', checkedTargets: [SITE] }],
      },
    });
    const secondId = await buy();
    await finishScan(db.prisma, secondId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/`])] },
    });

    const comparison = await compare(secondId);

    expect(comparison.pages).toMatchObject({ added: 0, removed: 0, kept: 1 });
  });

  it('refuses to claim a page list when a stored proof will not decode', async () => {
    const firstId = await buy();
    await finishScan(db.prisma, firstId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/`, `${SITE}/gone`])] },
    });
    const secondId = await buy();
    await finishScan(db.prisma, secondId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/`])] },
    });
    await db.prisma.ruleCoverageProof.update({
      where: { scanId_module: { scanId: firstId, module: 'SEO' } },
      data: { proof: Uint8Array.from([1, 2, 3, 4]) },
    });

    const comparison = await compare(secondId);

    expect(comparison.pages.comparable).toEqual({
      ok: false,
      reason: 'page-evidence-unreadable',
    });
    expect(comparison.pages.removed).toBe(0);
  });

  it('says a proof that names no page is no page list, not an empty site', async () => {
    const firstId = await buy();
    await finishScan(db.prisma, firstId, {
      proofs: { SEO: [{ ruleId: 'SEO-TECH-007', checkedTargets: [SITE] }] },
    });
    const secondId = await buy();
    await finishScan(db.prisma, secondId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/`])] },
    });

    const comparison = await compare(secondId);

    expect(comparison.pages.comparable).toEqual({ ok: false, reason: 'page-evidence-empty' });
  });

  it('reads a fifty-thousand page census and diffs it inside a generous bound', async () => {
    // The URL ceiling a Complete scan is sold with. The census is read from the
    // compressed proof and diffed with sets, so this is a few seconds of decode —
    // the bound is deliberately loose, and its job is to fail if the work ever
    // becomes quadratic in the number of pages.
    const pages = (offset: number, count: number): readonly string[] =>
      Array.from({ length: count }, (_unused, index) => `${SITE}/page-${offset + index}`);
    const firstId = await buy();
    await finishScan(db.prisma, firstId, {
      modules: allModules(70),
      proofs: { SEO: [pageRuleCoverage(pages(0, 50_000))] },
    });
    const secondId = await buy();
    await finishScan(db.prisma, secondId, {
      modules: allModules(70),
      proofs: { SEO: [pageRuleCoverage(pages(1_000, 50_000))] },
    });

    const startedAt = Date.now();
    const comparison = await compare(secondId);
    const elapsedMs = Date.now() - startedAt;

    expect(comparison.pages.comparable).toEqual({ ok: true });
    expect(comparison.pages).toMatchObject({ added: 1_000, removed: 1_000, kept: 49_000 });
    expect(comparison.pages.addedSample).toHaveLength(20);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 120_000);

  it('reads the census and the diff as separate, testable steps', async () => {
    // The endpoint tests go through HTTP; this one pins the two functions the
    // endpoint composes, so a failure says which half moved.
    const scanId = await buy();
    await finishScan(db.prisma, scanId, {
      proofs: { SEO: [pageRuleCoverage([`${SITE}/a`, `${SITE}/b`])] },
    });

    const census = await readPageCensus(db.prisma, scanId);

    expect(census.problem).toBeNull();
    expect([...census.crawlAddress].toSorted()).toEqual([`${SITE}/a`, `${SITE}/b`]);
    const diff = diffPages(
      pageSetsFor(census, { ...census, crawlAddress: new Set([`${SITE}/b`]) }),
    );
    expect(diff).toEqual({ added: [`${SITE}/a`], removed: [], kept: 1 });
  });
});
