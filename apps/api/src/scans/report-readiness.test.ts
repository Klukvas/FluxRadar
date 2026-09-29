import { describe, expect, it } from 'vitest';

import { isReportSnapshotReady } from './report-readiness.ts';

describe('report snapshot readiness', () => {
  it('holds a successful terminal scan until its job has persisted Analytics', () => {
    expect(isReportSnapshotReady({ status: 'Completed' }, { status: 'Claimed' })).toBe(false);
    expect(isReportSnapshotReady({ status: 'Partial' }, { status: 'Pending' })).toBe(false);
    expect(isReportSnapshotReady({ status: 'Completed' }, { status: 'Done' })).toBe(true);
  });

  it('keeps terminal reports pending while a retry or settlement job remains', () => {
    expect(isReportSnapshotReady({ status: 'Failed' }, { status: 'Claimed' })).toBe(false);
    expect(isReportSnapshotReady({ status: 'Cancelled' }, { status: 'Pending' })).toBe(false);
  });

  it('keeps legacy terminal reports readable when no job exists', () => {
    expect(isReportSnapshotReady({ status: 'Completed' }, null)).toBe(true);
  });
});
