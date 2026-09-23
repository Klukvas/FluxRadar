import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { DEFAULT_MONTHLY_TRAFFIC_BYTES } from './crawl-egress-locations.ts';
import {
  logEgressUsage,
  readEgressUsage,
  recordEgressUsage,
  usageMonthOf,
} from './crawl-egress-usage.ts';

// The VPS the crawl leaves through sells 1 TB a month, and nothing counted it.
// The first sign of running out would have been every scan failing at once.
// With a choice of locations each proxy is its own VPS on its own plan, so
// each is counted against its own allowance (D-228).

const JANUARY = new Date('2026-01-15T10:00:00.000Z');
const FEBRUARY = new Date('2026-02-01T00:00:00.000Z');
const KYIV = { id: 'ua', monthlyTrafficBytes: DEFAULT_MONTHLY_TRAFFIC_BYTES } as const;
const FRANKFURT = { id: 'de', monthlyTrafficBytes: 500_000_000_000 } as const;

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
    await recordEgressUsage(db.prisma, KYIV, 1_000, JANUARY);
    const usage = await recordEgressUsage(db.prisma, KYIV, 2_500, JANUARY);

    expect(usage.bytes).toBe(3_500);
    expect(usage.month).toBe('2026-01');
    expect(usage.location).toBe('ua');
  });

  it('counts each location on its own, against its own allowance', async () => {
    await recordEgressUsage(db.prisma, KYIV, 1_000, JANUARY);
    await recordEgressUsage(db.prisma, FRANKFURT, 400_000_000_000, JANUARY);

    const kyiv = await readEgressUsage(db.prisma, KYIV, JANUARY);
    const frankfurt = await readEgressUsage(db.prisma, FRANKFURT, JANUARY);
    expect(kyiv.bytes).toBe(1_000);
    expect(kyiv.nearingLimit).toBe(false);
    // 400 GB is nothing on Kyiv's 1 TB and 80% of Frankfurt's 500 GB.
    expect(frankfurt.bytes).toBe(400_000_000_000);
    expect(frankfurt.limitBytes).toBe(500_000_000_000);
    expect(frankfurt.nearingLimit).toBe(true);
  });

  it('starts the next month from zero', async () => {
    await recordEgressUsage(db.prisma, KYIV, 5_000, JANUARY);

    expect((await readEgressUsage(db.prisma, KYIV, FEBRUARY)).bytes).toBe(0);
  });

  it('reads a month nothing has been recorded for as zero, not as missing', async () => {
    const usage = await readEgressUsage(db.prisma, KYIV, JANUARY);

    expect(usage.bytes).toBe(0);
    expect(usage.nearingLimit).toBe(false);
  });

  it('ignores a nonsense byte count rather than corrupting the month', async () => {
    await recordEgressUsage(db.prisma, KYIV, Number.NaN, JANUARY);
    const usage = await recordEgressUsage(db.prisma, KYIV, -5, JANUARY);

    expect(usage.bytes).toBe(0);
  });

  it('raises the flag before the allowance runs out, not after', async () => {
    const belowThreshold = await recordEgressUsage(
      db.prisma,
      KYIV,
      Math.round(DEFAULT_MONTHLY_TRAFFIC_BYTES * 0.79),
      JANUARY,
    );
    expect(belowThreshold.nearingLimit).toBe(false);

    const overThreshold = await recordEgressUsage(
      db.prisma,
      KYIV,
      Math.round(DEFAULT_MONTHLY_TRAFFIC_BYTES * 0.02),
      JANUARY,
    );
    expect(overThreshold.nearingLimit).toBe(true);
    expect(overThreshold.usedRatio).toBeGreaterThan(0.8);
  });

  it('warns only when the allowance is running out, and names the location', () => {
    const warn = vi.fn();
    const logger = { ...silentLogger, warn } as never;

    logEgressUsage(logger, {
      location: 'ua',
      month: '2026-01',
      bytes: 1,
      limitBytes: DEFAULT_MONTHLY_TRAFFIC_BYTES,
      usedRatio: 0,
      nearingLimit: false,
    });
    expect(warn).not.toHaveBeenCalled();

    logEgressUsage(logger, {
      location: 'ua',
      month: '2026-01',
      bytes: DEFAULT_MONTHLY_TRAFFIC_BYTES,
      limitBytes: DEFAULT_MONTHLY_TRAFFIC_BYTES,
      usedRatio: 1,
      nearingLimit: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('nearing the monthly allowance'),
      expect.objectContaining({ location: 'ua', month: '2026-01', usedPercent: 100 }),
    );
  });
});
