import { describe, expect, it } from 'vitest';

import type { ScanModule } from '@prisma/client';

import { scanWithModules } from '../../test-utils/pdf-report-fixtures.ts';
import { structureColour } from './document-graphics.ts';
import { computeStoredScanOverallScore } from '@fluxradar/scoring';

import {
  clampScore,
  reportOverallScore,
  scoringRefuses,
  storedTimestamp,
  type ModuleSummary,
} from './report-format.ts';
import { segmentWidths } from './summary-tiles.ts';

describe('the agency colour on structure', () => {
  it('keeps a dark accent and falls back to the text colour for a pale one', () => {
    expect(structureColour('#145e62', '#14161a')).toBe('#145e62');
    expect(structureColour('#ffe680', '#14161a')).toBe('#14161a');
    expect(structureColour('garbage', '#14161a')).toBe('#14161a');
  });
});

describe('segmentWidths', () => {
  it('fills the bar exactly and never draws a segment too thin to see', () => {
    const widths = segmentWidths([1, 999], 200);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(200, 6);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(3);
  });
});

describe('reportOverallScore', () => {
  const complete = [
    'SEO',
    'AI SEO / GEO',
    'Security',
    'Performance',
    'Accessibility',
    'Reliability',
    'Content Quality',
    'Privacy',
  ].map((module) => ({ module, score: 70, coverage: 1 }));

  it('scores a fully covered Complete scan', () => {
    const scan = scanWithModules(complete);
    expect(reportOverallScore(scan.plan, scan.modules)).toEqual({ verdict: 'normal', score: 70 });
  });

  it('keeps a provisional score, marked as provisional', () => {
    const scan = scanWithModules(complete.map((module) => ({ ...module, coverage: 0.6 })));
    expect(reportOverallScore(scan.plan, scan.modules)).toEqual({
      verdict: 'provisional',
      score: 70,
    });
  });

  it('says there is not enough data when too few checks ran', () => {
    const scan = scanWithModules([{ module: 'SEO', score: 54 }]);
    expect(reportOverallScore(scan.plan, scan.modules).verdict).toBe('insufficient');
  });

  it('states the module sets the scoring package refuses as insufficient, not as a crash', () => {
    const duplicate = scanWithModules([{ module: 'SEO' }, { module: 'SEO' }]);
    expect(reportOverallScore(duplicate.plan, duplicate.modules)).toEqual({
      verdict: 'insufficient',
      score: null,
    });
    const outOfRange = scanWithModules(complete.map((module) => ({ ...module, score: 140 })));
    expect(reportOverallScore(outOfRange.plan, outOfRange.modules).score).toBeNull();
    const notANumber = scanWithModules(complete.map((module) => ({ ...module, score: NaN })));
    expect(reportOverallScore(notANumber.plan, notANumber.modules).score).toBeNull();
  });

  it('rounds a section score and drops one outside 0..100 instead of inventing it', () => {
    expect(clampScore(54.4)).toBe(54);
    expect(clampScore(100)).toBe(100);
    expect(clampScore(140)).toBeNull();
    expect(clampScore(-3)).toBeNull();
    expect(clampScore(Number.NaN)).toBeNull();
    expect(clampScore(null)).toBeNull();
  });

  it('reads a retired plan without throwing', () => {
    const modules = scanWithModules(complete).modules as ScanModule[];
    expect(() => reportOverallScore('WebsiteAudit', modules)).not.toThrow();
  });

  it('formats a stored ISO moment like every other moment in the document', () => {
    expect(storedTimestamp('2026-09-22T11:30:00.000Z')).toBe('2026-09-22 11:30');
    expect(storedTimestamp('yesterday')).toBe('yesterday');
    expect(storedTimestamp(null)).toBeNull();
  });
});

// The report refuses a module set by its own checks rather than by catching
// what the scoring package throws. This pins the two together: every set the
// report refuses, the package throws for, and every set it accepts, the
// package scores. If the package's validation drifts, this fails.
describe('scoringRefuses matches the scoring package', () => {
  const summary = (overrides: Partial<ModuleSummary> = {}): ModuleSummary => ({
    module: 'SEO',
    moduleStatus: 'Completed',
    coverage: 1,
    score: 70,
    usableOutput: true,
    ...overrides,
  });
  const cases: readonly (readonly [string, 'Complete' | 'Basic', readonly ModuleSummary[]])[] = [
    ['an ordinary set', 'Complete', [summary(), summary({ module: 'Security' })]],
    ['a side-score section', 'Complete', [summary(), summary({ module: 'Analytics' })]],
    ['a duplicate row', 'Complete', [summary(), summary()]],
    ['a score above 100', 'Complete', [summary({ score: 140 })]],
    ['a negative score', 'Complete', [summary({ score: -1 })]],
    ['a score that is not a number', 'Complete', [summary({ score: Number.NaN })]],
    ['a coverage above 1', 'Complete', [summary({ coverage: 1.5 })]],
    ['a section the plan does not weigh', 'Basic', [summary({ module: 'Privacy' })]],
  ];
  it.each(cases)('agrees on %s', (_, plan, summaries) => {
    const refused = scoringRefuses(plan, summaries);
    const throws = (() => {
      try {
        computeStoredScanOverallScore(plan, summaries);
        return false;
      } catch {
        return true;
      }
    })();
    expect(refused).toBe(throws);
  });
});
