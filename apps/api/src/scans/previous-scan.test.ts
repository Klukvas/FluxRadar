// Which scan is "the previous scan of this one" — the §14 selection itself.
//
// One rule, three readers: the Resolved/Reopened pass after a run, the status a
// new finding inherits, and the comparison endpoint. They agreed on the plan and
// the profile from the start and disagreed on the ordering, which is the part
// that decides anything: a Partial scan retried after a later scan completed had
// one reader measuring it against the run before it and another against the run
// after. These tests pin the ordering, both directions of the tie-break, and
// that the two halves of §14 read the same candidate set.

import { afterEach, expect, it } from 'vitest';

import {
  findPreviousScan,
  findPreviousScanRead,
  hasEarlierScanOfAnotherPlan,
} from './previous-scan.ts';
import { PURCHASE_STATUSES } from '../billing/constants.ts';
import { initialIssueStatuses } from '../orchestrator/issue-sync.ts';
import {
  createTestDb,
  describeDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

const AT = (iso: string): Date => new Date(iso);

describeDb('the previous scan of a scan', () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  /** A finished Complete scan of the profile, created and completed when told. */
  async function completed(
    database: TestDb,
    account: SeededAccount,
    times: {
      readonly createdAt: string;
      readonly completedAt: string;
      readonly refunded?: boolean;
    },
    plan: 'Complete' | 'WebsiteAudit' = 'Complete',
  ) {
    const { scan, purchase } = await seedScan(database.prisma, {
      account,
      plan,
      status: 'Completed',
      withPurchase: times.refunded === true,
      completedAt: AT(times.completedAt),
    });
    if (purchase !== null) {
      await database.prisma.purchase.update({
        where: { id: purchase.id },
        data: { status: PURCHASE_STATUSES.refunded },
      });
    }
    return database.prisma.scan.update({
      where: { id: scan.id },
      data: { createdAt: AT(times.createdAt) },
    });
  }

  it('is the scan that finished last before this one finished, not the one created before it', async () => {
    // The sequence this rule exists for. A ends Partial; the owner buys B, which
    // completes; the owner then retries A's unfinished section and A completes.
    // A's findings are current as of the moment A finished, so the picture to
    // measure them against is B — the latest complete reading before that
    // moment — and not the scan that happened to be created before A.
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    const older = await completed(db, account, {
      createdAt: '2026-09-01T10:00:00.000Z',
      completedAt: '2026-09-01T11:00:00.000Z',
    });
    const retried = await completed(db, account, {
      createdAt: '2026-09-02T10:00:00.000Z',
      // Retried and finished AFTER the scan that was bought later.
      completedAt: '2026-09-10T18:00:00.000Z',
    });
    const bought = await completed(db, account, {
      createdAt: '2026-09-05T10:00:00.000Z',
      completedAt: '2026-09-05T12:00:00.000Z',
    });

    expect((await findPreviousScan(db.prisma, retried))?.id).toBe(bought.id);
    // And from the other side: the scan bought in between still measures itself
    // against the one that finished before it.
    expect((await findPreviousScan(db.prisma, bought))?.id).toBe(older.id);
  });

  it('breaks a same-millisecond tie by id, the same way in both directions', async () => {
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    const sameMoment = '2026-09-07T09:00:00.000Z';
    const one = await completed(db, account, {
      createdAt: '2026-09-07T08:00:00.000Z',
      completedAt: sameMoment,
    });
    const two = await completed(db, account, {
      createdAt: '2026-09-07T08:00:00.000Z',
      completedAt: sameMoment,
    });
    const [lower, higher] = [one, two].toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ) as [typeof one, typeof one];

    // The higher id is the later scan; the lower one has nothing before it.
    expect((await findPreviousScan(db.prisma, higher))?.id).toBe(lower.id);
    expect(await findPreviousScan(db.prisma, lower)).toBeNull();
  });

  it('never answers with the scan itself, whatever timestamp the caller holds', async () => {
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    const only = await completed(db, account, {
      createdAt: '2026-09-07T08:00:00.000Z',
      completedAt: '2026-09-07T09:00:00.000Z',
    });

    // The worker holds the row it loaded BEFORE the run terminalized it, so the
    // completion time it passes can be blank while the stored one is not.
    expect(await findPreviousScan(db.prisma, { ...only, completedAt: null })).toBeNull();
  });

  it('measures a scan that has not finished against everything already finished', async () => {
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    const finished = await completed(db, account, {
      createdAt: '2026-09-01T10:00:00.000Z',
      completedAt: '2026-09-01T11:00:00.000Z',
    });
    const { scan: running } = await seedScan(db.prisma, {
      account,
      plan: 'Complete',
      status: 'Running',
      withPurchase: false,
    });

    expect((await findPreviousScan(db.prisma, running))?.id).toBe(finished.id);
  });

  it('gives the status inheritance the same candidate set as the Resolved pass', async () => {
    // The two halves of §14. `initialIssueStatuses` reads the last known fate of
    // a fingerprint; ordered by anything other than the scans' completion, it
    // would inherit from a run the Resolved pass has not reached yet.
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    const retried = await completed(db, account, {
      createdAt: '2026-09-02T10:00:00.000Z',
      completedAt: '2026-09-10T18:00:00.000Z',
    });
    const bought = await completed(db, account, {
      createdAt: '2026-09-05T10:00:00.000Z',
      completedAt: '2026-09-05T12:00:00.000Z',
    });
    const fingerprint = 'fluxradar-fp-v1:previous-scan';
    await seedIssue(db, retried.id, fingerprint, 'Ignored', AT('2026-09-10T18:00:00.000Z'));
    await seedIssue(db, bought.id, fingerprint, 'Resolved', AT('2026-09-05T12:00:00.000Z'));

    const { scan: next } = await seedScan(db.prisma, {
      account,
      plan: 'Complete',
      status: 'Pending',
      withPurchase: false,
    });
    const statuses = await initialIssueStatuses(db.prisma, next, [fingerprint]);

    // The retried scan finished last, so its Ignored is the fate that carries —
    // exactly the scan `findPreviousScan` would pick for the same run.
    expect(statuses.get(fingerprint)).toBe('Ignored');
    expect((await findPreviousScan(db.prisma, next))?.id).toBe(retried.id);
  });

  it('answers with the scan and its readability, without letting one decide the other', async () => {
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    const previous = await completed(db, account, {
      createdAt: '2026-09-01T10:00:00.000Z',
      completedAt: '2026-09-01T11:00:00.000Z',
      refunded: true,
    });
    const current = await completed(db, account, {
      createdAt: '2026-09-08T10:00:00.000Z',
      completedAt: '2026-09-08T11:00:00.000Z',
    });

    const read = await findPreviousScanRead(db.prisma, current);

    // Its purchase was reversed, so the report behind it is no longer the
    // owner's to open — and it is still the scan the selection returns, because
    // it is the one the Resolved statuses were written against.
    expect(read?.scan.id).toBe(previous.id);
    expect(read?.readable).toBe(false);
  });

  it('sees an earlier scan of another plan without letting it become the previous one', async () => {
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    await completed(
      db,
      account,
      { createdAt: '2026-09-01T10:00:00.000Z', completedAt: '2026-09-01T11:00:00.000Z' },
      'WebsiteAudit',
    );
    const current = await completed(db, account, {
      createdAt: '2026-09-08T10:00:00.000Z',
      completedAt: '2026-09-08T11:00:00.000Z',
    });

    expect(await findPreviousScan(db.prisma, current)).toBeNull();
    expect(await hasEarlierScanOfAnotherPlan(db.prisma, current)).toBe(true);
  });

  async function seedIssue(
    database: TestDb,
    scanId: string,
    fingerprint: string,
    status: string,
    observedAt: Date,
  ): Promise<void> {
    await database.prisma.issue.create({
      data: {
        scanId,
        ruleId: 'SEO-ONPAGE-001',
        module: 'SEO',
        fingerprint,
        severity: 'High',
        severityRank: 1,
        category: 'on-page',
        status,
        targetKind: 'page',
        normalizedUrl: 'https://example.com/',
        normalizedResource: '',
        normalizedSelector: '',
        normalizedParameter: '',
        ruleVariant: 'v1',
        targetUrl: 'https://example.com/',
        evidenceType: 'dom',
        recommendation: 'Fix it',
        confidence: 1,
        applicableTargets: 1,
        affectedTargets: 1,
        rulePenalty: 0,
        scoreDelta: 0,
        observedAt,
      },
    });
  }
});
