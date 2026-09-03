import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InvalidTransitionError } from './errors.ts';
import { transitionScan } from './state-machine.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// BILLING-004: the worker claim is an atomic compare-and-set — of N concurrent
// Queued -> Running claims exactly one wins (§18, D-005/D-011); transitions
// outside SCAN_TRANSITIONS are rejected before touching the database.
describe('BILLING-004 atomic scan state transitions', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('lets exactly one of five concurrent Queued -> Running claims win', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Queued' });

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => transitionScan(db.prisma, scan.id, 'Queued', 'Running')),
    );

    const wins = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const losses = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(4);
    for (const loss of losses) {
      expect((loss as PromiseRejectedResult).reason).toBeInstanceOf(InvalidTransitionError);
    }

    const updated = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(updated.status).toBe('Running');
    expect(updated.startedAt).not.toBeNull();
  });

  it('rejects a transition pair not allowed by §18 without touching the row', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Pending' });

    await expect(transitionScan(db.prisma, scan.id, 'Pending', 'Running')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );

    const untouched = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(untouched.status).toBe('Pending');
  });

  it('rejects an allowed pair when the scan is not in the from-state', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Pending' });

    await expect(transitionScan(db.prisma, scan.id, 'Queued', 'Running')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    const untouched = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(untouched.status).toBe('Pending');
  });

  it('rejects any transition out of a terminal state', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Completed' });
    await expect(transitionScan(db.prisma, scan.id, 'Completed', 'Queued')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it('sets and clears run timestamps across the lifecycle', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Pending' });

    await transitionScan(db.prisma, scan.id, 'Pending', 'Queued');
    await transitionScan(db.prisma, scan.id, 'Queued', 'Running');
    const running = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(running.startedAt).not.toBeNull();
    expect(running.completedAt).toBeNull();

    await transitionScan(db.prisma, scan.id, 'Running', 'Completed');
    const completed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(completed.completedAt).not.toBeNull();
  });
});
