import { describe, expect, it } from 'vitest';

import { REPORT_PERIOD_DAYS, previousDateRange, reportDateRange } from './date-range.ts';

describe('reportDateRange', () => {
  it('ends three days back so the Search Console tail is finalized', () => {
    expect(reportDateRange(new Date('2026-09-06T12:00:00.000Z')).endDate).toBe('2026-09-03');
  });

  it('spans the full reporting period inclusively', () => {
    const range = reportDateRange(new Date('2026-09-06T12:00:00.000Z'));
    const days =
      (Date.parse(`${range.endDate}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) /
      86_400_000;

    expect(days + 1).toBe(REPORT_PERIOD_DAYS);
  });

  it('crosses a month boundary without producing an invalid date', () => {
    expect(reportDateRange(new Date('2026-01-02T00:30:00.000Z'))).toEqual({
      startDate: '2025-12-03',
      endDate: '2025-12-30',
    });
  });
});

describe('previousDateRange', () => {
  it('is the equally long period that ends the day before the report period', () => {
    expect(previousDateRange({ startDate: '2026-08-07', endDate: '2026-09-03' })).toEqual({
      startDate: '2026-07-10',
      endDate: '2026-08-06',
    });
  });
});
