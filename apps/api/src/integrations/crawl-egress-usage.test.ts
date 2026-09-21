import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import {
  EGRESS_MONTHLY_BYTE_LIMIT,
  logEgressUsage,
  readEgressUsage,
  recordEgressUsage,
  usageMonthOf,
} from './crawl-egress-usage.ts';

// The VPS the crawl leaves through sells 1 TB a month, and nothing counted it.
// The first sign of running out would have been every scan failing at once.

const JANUARY = new Date('2026-01-15T10:00:00.000Z');
const FEBRUARY = new Date('2026-02-01T00:00:00.000Z');

describe('crawl egress usage', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('keys usage to the UTC calendar month the plan resets on', () => {
    expect(usageMonthOf(JANUARY)).toBe('2026-01');
    expect(usageMonthOf(new Date('2026-09-30T23:59:59.999Z'))).toBe('2026-09');
  });

  it('accumulates across scans instead of overwriting', async () => {
    await recordEgressUsage(db.prisma, 1_000, JANUARY);
    const usage = await recordEgressUsage(db.prisma, 2_500, JANUARY);

    expect(usage.bytes).toBe(3_500);
    expect(usage.month).toBe('2026-01');
  });

  it('starts the next month from zero', async () => {
    await recordEgressUsage(db.prisma, 5_000, JANUARY);

    expect((await readEgressUsage(db.prisma, FEBRUARY)).bytes).toBe(0);
  });

  it('reads a month nothing has been recorded for as zero, not as missing', async () => {
    const usage = await readEgressUsage(db.prisma, JANUARY);

    expect(usage.bytes).toBe(0);
    expect(usage.nearingLimit).toBe(false);
  });

  it('ignores a nonsense byte count rather than corrupting the month', async () => {
    await recordEgressUsage(db.prisma, Number.NaN, JANUARY);
    const usage = await recordEgressUsage(db.prisma, -5, JANUARY);

    expect(usage.bytes).toBe(0);
  });

  it('raises the flag before the allowance runs out, not after', async () => {
    const belowThreshold = await recordEgressUsage(
      db.prisma,
      Math.round(EGRESS_MONTHLY_BYTE_LIMIT * 0.79),
      JANUARY,
    );
    expect(belowThreshold.nearingLimit).toBe(false);

    const overThreshold = await recordEgressUsage(
      db.prisma,
      Math.round(EGRESS_MONTHLY_BYTE_LIMIT * 0.02),
      JANUARY,
    );
    expect(overThreshold.nearingLimit).toBe(true);
    expect(overThreshold.usedRatio).toBeGreaterThan(0.8);
  });

  it('warns only when the allowance is running out', () => {
    const warn = vi.fn();
    const logger = { ...silentLogger, warn } as never;

    logEgressUsage(logger, {
      month: '2026-01',
      bytes: 1,
      limitBytes: EGRESS_MONTHLY_BYTE_LIMIT,
      usedRatio: 0,
      nearingLimit: false,
    });
    expect(warn).not.toHaveBeenCalled();

    logEgressUsage(logger, {
      month: '2026-01',
      bytes: EGRESS_MONTHLY_BYTE_LIMIT,
      limitBytes: EGRESS_MONTHLY_BYTE_LIMIT,
      usedRatio: 1,
      nearingLimit: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('nearing the monthly allowance'),
      expect.objectContaining({ month: '2026-01', usedPercent: 100 }),
    );
  });
});
