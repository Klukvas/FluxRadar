import { computeStoredScanOverallScore } from '@fluxradar/scoring';
import type { ModuleScoreSummary } from '@fluxradar/scoring';
import type { ScanModule } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { moduleScoreView, overallScoreView } from './free-score-view.ts';
import { toModuleDto } from './scan-dto.ts';

// D-237: a Free check is shown out of 40 (a quick homepage check); a paid one
// out of 100. The stored module score is never altered; the dashboard's overall
// and each module DTO carry the shown number and its `scoreMax`. No database:
// the dashboard route builds
// `overall` from `computeStoredScanOverallScore` and wraps it in
// `overallScoreView`, which is what these call directly.

function seoSummary(score: number | null): ModuleScoreSummary {
  return {
    module: 'SEO',
    moduleStatus: 'Completed',
    coverage: 1,
    score,
    usableOutput: score !== null,
  };
}

function storedModule(overrides: Partial<ScanModule>): ScanModule {
  return {
    id: 'module-1',
    scanId: 'scan-1',
    module: 'SEO',
    runtimeStatus: 'Completed',
    exportStatus: null,
    statusReason: null,
    coverage: 1,
    score: 100,
    applicableChecks: 6,
    completedApplicableChecks: 6,
    metadataJson: '{}',
    usableOutput: true,
    ...overrides,
  };
}

function freeDashboardOverall(storedSeoScore: number | null) {
  return overallScoreView(
    'Free',
    computeStoredScanOverallScore('Free', [seoSummary(storedSeoScore)]),
  );
}

describe('the Free dashboard overall score', () => {
  it('is shown out of 40: a stored 100 is 40 / 40, a stored 98 is 39 / 40', () => {
    const perfect = freeDashboardOverall(100);
    expect(perfect.score).toBe(40);
    expect(perfect.scoreMax).toBe(40);
    expect(perfect).not.toHaveProperty('scoreCeiling');
    expect(freeDashboardOverall(98)).toMatchObject({ score: 39, scoreMax: 40 });
  });

  it('scales a stored 87.5 to 35 and a stored 79 to 32', () => {
    expect(freeDashboardOverall(87.5).score).toBe(35);
    expect(freeDashboardOverall(79).score).toBe(32);
  });

  it('keeps the verdict, coverage and weights it was computed with', () => {
    const stored = computeStoredScanOverallScore('Free', [seoSummary(87.5)]);
    const shown = overallScoreView('Free', stored);
    expect(shown.verdict).toBe(stored.verdict);
    expect(shown.weightedCoverage).toBe(stored.weightedCoverage);
    expect(shown.moduleWeights).toEqual(stored.moduleWeights);
  });

  it('keeps a legacy NotScoredOnFreePlan row unscored', () => {
    const overall = freeDashboardOverall(null);
    expect(overall.score).toBeNull();
    expect(overall.scoreMax).toBe(40);
  });
});

describe('paid dashboards', () => {
  it.each(['Basic', 'Complete', 'WebsiteAudit'])(
    '%s keeps its 0–100 numbers and gains scoreMax 100',
    (plan) => {
      const stored = { verdict: 'normal', score: 87.5, weightedCoverage: 1, moduleWeights: [] };
      expect(overallScoreView(plan, stored)).toEqual({ ...stored, scoreMax: 100 });
      expect(moduleScoreView(plan, 'SEO', 87.5)).toEqual({ score: 87.5, scoreMax: 100 });
    },
  );
});

describe('the module DTO', () => {
  it('shows a Free SEO module stored at 100 as 40 / 40, leaving the row untouched', () => {
    const row = storedModule({ score: 100 });
    const dto = toModuleDto(row, 'Free');
    expect(dto.score).toBe(40);
    expect(dto.scoreMax).toBe(40);
    expect(dto).not.toHaveProperty('scoreCeiling');
    expect(row.score).toBe(100);
  });

  it('leaves the Free GEO preview unscored, on the default scale', () => {
    const dto = toModuleDto(storedModule({ module: 'AI SEO / GEO', score: null }), 'Free');
    expect(dto.score).toBeNull();
    expect(dto.scoreMax).toBe(100);
  });

  it('keeps a legacy unscored Free SEO row null', () => {
    const dto = toModuleDto(
      storedModule({ score: null, metadataJson: '{"scoring":"NotScoredOnFreePlan"}' }),
      'Free',
    );
    expect(dto.score).toBeNull();
    expect(dto.metadata).toEqual({ scoring: 'NotScoredOnFreePlan' });
  });

  it('is identical for a paid module apart from the scoreMax key', () => {
    const dto = toModuleDto(storedModule({ score: 87.5 }), 'Basic');
    expect(dto.score).toBe(87.5);
    expect(Object.keys(dto)).toEqual([
      'module',
      'status',
      'statusReason',
      'coverage',
      'score',
      'scoreMax',
      'applicableChecks',
      'completedApplicableChecks',
      'usableOutput',
      'metadata',
    ]);
  });
});
