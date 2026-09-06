// Report period for the Google section.

import type { DateRange } from './types.ts';

export const REPORT_PERIOD_DAYS = 28;

/**
 * Search Console finalizes a day's data with a two-to-three day lag. Ending the
 * window three days back keeps the last bucket from reading as a traffic drop,
 * and using the same window for GA4 makes the two sections comparable.
 */
export const REPORT_PERIOD_LAG_DAYS = 3;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function reportDateRange(now: Date): DateRange {
  const end = shiftDays(now, -REPORT_PERIOD_LAG_DAYS);
  return {
    startDate: isoDate(shiftDays(end, -(REPORT_PERIOD_DAYS - 1))),
    endDate: isoDate(end),
  };
}
