import { describe, expect, it } from 'vitest';

import { isAdminEmail, readAdminEmails } from './admin-emails.ts';
import {
  conversionRate,
  fillDailySeries,
  revenueLines,
  statsWindow,
  sumByCurrency,
} from './stats-window.ts';

describe('owner dashboard window', () => {
  it('covers whole UTC days, today included, whatever the hour', () => {
    const lateEvening = statsWindow(7, new Date('2026-09-21T23:59:59.999Z'));
    const justAfterMidnight = statsWindow(7, new Date('2026-09-21T00:00:00.000Z'));

    expect(lateEvening.from.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(justAfterMidnight.from.toISOString()).toBe('2026-09-15T00:00:00.000Z');
  });

  it('draws one point per day, oldest first, with zeros where nothing happened', () => {
    const window = statsWindow(7, new Date('2026-09-21T12:00:00Z'));
    const daily = fillDailySeries(window, [
      { series: 'accounts', day: '2026-09-15', count: 2 },
      { series: 'purchases', day: '2026-09-21', count: 1 },
    ]);

    expect(daily).toHaveLength(7);
    expect(daily[0]).toEqual({ day: '2026-09-15', accounts: 2, scans: 0, purchases: 0 });
    expect(daily[6]).toEqual({ day: '2026-09-21', accounts: 0, scans: 0, purchases: 1 });
    expect(daily.slice(1, 6).every((point) => point.accounts + point.purchases === 0)).toBe(true);
  });
});

describe('owner dashboard money', () => {
  it('adds amounts of one currency and never across currencies', () => {
    expect(
      sumByCurrency([
        { currency: 'USD', amount: 55 },
        { currency: 'EUR', amount: 110.5 },
        { currency: 'USD', amount: 0.1 },
        { currency: 'USD', amount: 0.2 },
      ]),
    ).toEqual([
      { currency: 'EUR', amount: 110.5 },
      { currency: 'USD', amount: 55.3 },
    ]);
  });

  it('keeps a currency that only saw a refund, with the net below zero', () => {
    expect(
      revenueLines([{ currency: 'USD', amount: 120 }], [{ currency: 'GBP', amount: 40 }]),
    ).toEqual([
      { currency: 'GBP', gross: 0, refunded: 40, net: -40 },
      { currency: 'USD', gross: 120, refunded: 0, net: 120 },
    ]);
  });

  it('has no conversion rate until a checkout was opened', () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(3, 1)).toBe(0.3333);
  });
});

describe('admin addresses', () => {
  it('reads an exact, comma-separated list, trimmed and case-insensitive', () => {
    const admins = readAdminEmails({
      FLUXRADAR_ADMIN_EMAILS: ' Owner@Example.com, ,second@example.com ',
    });

    expect(isAdminEmail('owner@example.com', admins)).toBe(true);
    expect(isAdminEmail('SECOND@EXAMPLE.COM', admins)).toBe(true);
    expect(isAdminEmail('owner@example.co', admins)).toBe(false);
  });

  it('is nobody when the variable is absent or blank', () => {
    expect(readAdminEmails({}).size).toBe(0);
    expect(readAdminEmails({ FLUXRADAR_ADMIN_EMAILS: ' , ' }).size).toBe(0);
  });
});
