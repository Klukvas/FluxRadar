import { afterEach, describe, expect, it } from 'vitest';

import { initialIssueStatuses, markResolvedAgainstPrevious } from './issue-sync.ts';
import { createTestDb, seedAccountWithProfile, seedScan, type TestDb } from '../test-utils/test-db.ts';

describe('Complete issue lifecycle by fingerprint', () => {
  let db: TestDb | undefined;

  afterEach(async () => {
    await db?.cleanup();
    db = undefined;
  });

  it('marks a disappeared finding Resolved and reopens it when it returns', async () => {
    db = await createTestDb();
    const account = await seedAccountWithProfile(db.prisma);
    const first = await seedScan(db.prisma, {
      account,
      plan: 'Complete',
      status: 'Completed',
      withPurchase: false,
    });
    const second = await seedScan(db.prisma, {
      account,
      plan: 'Complete',
      status: 'Completed',
      withPurchase: false,
    });
    await db.prisma.scan.update({
      where: { id: first.scan.id },
      data: { createdAt: new Date('2026-09-03T12:00:00.000Z') },
    });
    await db.prisma.scan.update({
      where: { id: second.scan.id },
      data: { createdAt: new Date('2026-09-03T12:01:00.000Z') },
    });
    const fingerprint = 'fluxradar-fp-v1:issue-sync-fixture';
    await db.prisma.issue.create({
      data: {
        scanId: first.scan.id,
        ruleId: 'SEO-TECH-004',
        module: 'SEO',
        fingerprint,
        severity: 'High',
        category: 'Technical SEO',
        status: 'New',
        targetKind: 'page',
        normalizedUrl: 'https://example.com/',
        normalizedResource: '',
        normalizedSelector: '',
        normalizedParameter: '',
        ruleVariant: 'canonical-mismatch',
        targetUrl: 'https://example.com/',
        evidenceType: 'dom',
        evidenceRef: 'issue/fixture',
        evidenceExcerpt: 'canonical mismatch',
        recommendation: 'Fix canonical',
        confidence: 1,
        applicableTargets: 1,
        affectedTargets: 1,
        rulePenalty: 10,
        scoreDelta: -10,
        observedAt: new Date('2026-09-03T12:00:30.000Z'),
      },
    });

    expect(await markResolvedAgainstPrevious(db.prisma, second.scan)).toBe(1);
    const resolved = await db.prisma.issue.findFirstOrThrow({ where: { scanId: first.scan.id } });
    expect(resolved.status).toBe('Resolved');

    const third = await seedScan(db.prisma, {
      account,
      plan: 'Complete',
      status: 'Pending',
      withPurchase: false,
    });
    const statuses = await initialIssueStatuses(db.prisma, third.scan, [fingerprint]);
    expect(statuses.get(fingerprint)).toBe('Reopened');
  });
});
