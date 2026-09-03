import { describe, expect, it } from 'vitest';

import { reportObjectKey } from './s3.ts';

describe('Hetzner report object keys', () => {
  it('keeps artifacts tenant-scoped and format-specific', () => {
    expect(reportObjectKey('account_1', 'scan_2', 'json')).toBe(
      'accounts/account_1/scans/scan_2/report.json',
    );
    expect(reportObjectKey('account_1', 'scan_2', 'csv')).toBe(
      'accounts/account_1/scans/scan_2/report.csv',
    );
  });

  it('rejects path traversal characters in identifiers', () => {
    expect(() => reportObjectKey('../account', 'scan', 'json')).toThrow();
  });
});
