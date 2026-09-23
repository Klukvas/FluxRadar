// The report period for the Bing section, and the one date format Bing speaks.
//
// Bing's JSON protocol serialises DateTime in the ASP.NET form
// `/Date(1316156400000-0700)/` — milliseconds since the Unix epoch, followed by
// the originating timezone offset (learn.microsoft.com/en-us/dotnet/api/
// microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats, "JSON
// response sample"). The milliseconds are already UTC; the offset describes the
// timezone the value was authored in and must NOT be added again, which is the
// classic way this format produces days that are one off.
//
// The window matches the Google section's (integrations/google/date-range.ts) so
// a report can put the two search engines beside each other without comparing
// different months. It carries no lag: unlike Search Console, Bing's traffic
// stats are described as updated daily, and this code takes only the days Bing
// actually returned.

import type { BingDateRange, BingTotals, BingTrafficDay } from './types.ts';

export const BING_REPORT_PERIOD_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;
const ASP_NET_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * The ISO date of one Bing timestamp, or null for anything unrecognised.
 *
 * A plain ISO string is accepted alongside the ASP.NET form: the POX protocol
 * states dates that way, and a value we can read is better than a row dropped
 * because the transport changed shape.
 */
export function parseBingDate(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const aspNet = ASP_NET_DATE.exec(value);
  if (aspNet !== null) {
    const milliseconds = Number(aspNet[1]);
    return Number.isFinite(milliseconds) ? isoDate(new Date(milliseconds)) : null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : isoDate(parsed);
}

export function bingReportDateRange(now: Date): BingDateRange {
  return {
    startDate: isoDate(shiftDays(now, -(BING_REPORT_PERIOD_DAYS - 1))),
    endDate: isoDate(now),
  };
}

/** The period of the same length ending the day before `range` starts. */
export function previousBingDateRange(range: BingDateRange): BingDateRange {
  const end = shiftDays(new Date(`${range.startDate}T00:00:00.000Z`), -1);
  return {
    startDate: isoDate(shiftDays(end, -(BING_REPORT_PERIOD_DAYS - 1))),
    endDate: isoDate(end),
  };
}

export function isWithin(range: BingDateRange, date: string): boolean {
  return date >= range.startDate && date <= range.endDate;
}

export function daysWithin(
  days: readonly BingTrafficDay[],
  range: BingDateRange,
): readonly BingTrafficDay[] {
  return days.filter((day) => isWithin(range, day.date));
}

/**
 * Period totals over the days Bing reported. `days` is the count of reported
 * days, not the length of the window: a site Bing has only tracked for a week
 * must not read as three weeks of zeroes.
 */
export function totalsFor(days: readonly BingTrafficDay[]): BingTotals {
  const clicks = days.reduce((sum, day) => sum + day.clicks, 0);
  const impressions = days.reduce((sum, day) => sum + day.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions === 0 ? 0 : clicks / impressions,
    days: days.length,
  };
}
