// What each plan runs, and the export the one exporting plan writes.
//
// Kept from the Website Audit suite when that plan was removed: these pinned
// Basic and Complete while a third package sat between them, and still state
// what the two remaining paid plans are.

import { describe, expect, it } from 'vitest';
import { PLANS } from '@fluxradar/contracts';
import { validateExportRecords } from '@fluxradar/export';

import { buildExportRecords, type ExportScan } from '../export/build-records.ts';
import { modulePlanFor } from './module-plan.ts';

describe('module plan per tariff', () => {
  it('has a module plan for every plan there is', () => {
    for (const plan of PLANS) expect(modulePlanFor(plan)).toBeDefined();
  });

  it('runs SEO and GEO alone on Basic', () => {
    expect(modulePlanFor('Basic')).toEqual({
      runnable: ['SEO'],
      external: [],
      geo: true,
      ux: false,
      stubs: [],
    });
  });

  it('runs every section on Complete', () => {
    expect(modulePlanFor('Complete')).toEqual({
      runnable: ['SEO', 'Security', 'Accessibility', 'Reliability', 'Content Quality', 'Privacy'],
      external: ['Performance'],
      geo: true,
      ux: true,
      stubs: [],
    });
  });
});

describe('the Complete export', () => {
  const completeScan = {
    id: 'scan_complete1',
    accountId: 'account_1',
    siteProfileId: 'profile_1',
    plan: 'Complete',
    domain: 'https://example.com',
    status: 'Completed',
    statusReason: null,
    rulesetVersion: '1',
    startedAt: new Date('2026-09-05T01:00:00Z'),
    completedAt: new Date('2026-09-05T01:05:00Z'),
    createdAt: new Date('2026-09-05T00:59:00Z'),
    modules: [],
    issues: [],
    aiResponses: [],
  } as unknown as ExportScan;

  // 1.0 was defined as Complete-only, so a Complete export is still the file
  // it always was.
  it('is written on schema 1.0, labelled Complete Scan, and validates', () => {
    const records = buildExportRecords(completeScan);
    expect(records.every((record) => record.schema_version === '1.0')).toBe(true);
    expect(records.every((record) => record.plan === 'Complete Scan')).toBe(true);
    expect(validateExportRecords(records).ok).toBe(true);
  });
});
