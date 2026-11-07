import type { Scan, ScanModule } from '@prisma/client';
import { MODULE_NAMES } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { sortModules } from './module-order.ts';
import { toScanDto } from './scan-dto.ts';

// A scan's module rows come back from Postgres in physical order, which moves
// as rows are rewritten; a Free scan's two rows made that visible (CI: "AI SEO /
// GEO" returned before "SEO"). Every module list leaves the API in the
// canonical registry order instead.

const named = (...names: string[]) => names.map((module, index) => ({ module, index }));

describe('sortModules', () => {
  it('orders modules as the registry lists them', () => {
    const reversed = named(...[...MODULE_NAMES].reverse());
    expect(sortModules(reversed).map((entry) => entry.module)).toEqual([...MODULE_NAMES]);
  });

  it('puts the Free scan’s SEO row before its GEO preview row', () => {
    expect(sortModules(named('AI SEO / GEO', 'SEO')).map((entry) => entry.module)).toEqual([
      'SEO',
      'AI SEO / GEO',
    ]);
  });

  it('puts names outside the registry last, by name', () => {
    const sorted = sortModules(named('Zeta', 'Security', 'Alpha', 'SEO'));
    expect(sorted.map((entry) => entry.module)).toEqual(['SEO', 'Security', 'Alpha', 'Zeta']);
  });

  it('is stable for equal names and leaves its input untouched', () => {
    const input = named('Security', 'SEO', 'Security');
    const sorted = sortModules(input);
    expect(sorted.map((entry) => entry.index)).toEqual([1, 0, 2]);
    expect(input.map((entry) => entry.module)).toEqual(['Security', 'SEO', 'Security']);
  });
});

function row(module: string): ScanModule {
  return {
    id: `module-${module}`,
    scanId: 'scan-1',
    module,
    runtimeStatus: 'Completed',
    exportStatus: null,
    statusReason: null,
    coverage: 1,
    score: module === 'SEO' ? 100 : null,
    applicableChecks: 1,
    completedApplicableChecks: 1,
    metadataJson: '{}',
    usableOutput: true,
  };
}

const FREE_SCAN = {
  id: 'scan-1',
  siteProfileId: 'profile-1',
  plan: 'Free',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scopeJson: '{"includeSubdomains":false}',
  crawlSummaryJson: null,
  profileConfigVersion: 1,
  executionConfigJson: null,
  rulesetVersion: 'rules-v1',
  platformRetryCount: 0,
  moduleRetryCount: 0,
  scannedUrlCount: 1,
  discoveredUrlCount: 1,
  startedAt: new Date('2026-11-07T00:00:00.000Z'),
  completedAt: new Date('2026-11-07T00:01:00.000Z'),
  createdAt: new Date('2026-11-07T00:00:00.000Z'),
} as unknown as Scan;

describe('toScanDto module order', () => {
  it('serializes rows that came back as [GEO, SEO] as [SEO, GEO]', () => {
    const dto = toScanDto(FREE_SCAN, [row('AI SEO / GEO'), row('SEO')]);
    const modules = dto.modules as readonly { module: string; scoreMax?: number }[];
    expect(modules.map((module) => module.module)).toEqual(['SEO', 'AI SEO / GEO']);
    // The Free score view still applies to the right row after sorting.
    expect(modules[0]?.scoreMax).toBe(40);
  });
});
