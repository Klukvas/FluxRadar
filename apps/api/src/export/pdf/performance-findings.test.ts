// The Performance findings, as the downloadable report says them.
//
// The defect this suite exists for: the document printed the audit's stored
// English — "Time to First Byte is 1.9 s on mobile (good is under 800 ms)." — in
// the Ukrainian report, under Ukrainian headings, with an English `INFO` badge
// above it. The browser report shows none of these findings, so the file a
// customer downloads is the only place they meet them.
//
// The findings here are produced by the real producer rather than hand-written, so
// the evidence the copy reads is the evidence the audit actually stores. The last
// test is the guard: every rule id the module implements has to be covered, in
// both languages, or it fails here instead of shipping in English.

import { describe, expect, it } from 'vitest';

import {
  IMPLEMENTED_PERF_RULE_IDS,
  performanceFindings,
  type FieldResult,
  type MetricSeriesByName,
  type PerformanceFinding,
  type UrlAudit,
} from '../../integrations/performance/index.ts';
import { deviceResult, seriesOf } from '../../test-utils/performance-fixtures.ts';
import { performanceFindingText, storedPerformanceFindings } from './performance-findings.ts';

const ORIGIN = 'https://example.com/';

/** A slow page whose repeated runs also disagreed, so every lab rule fires. */
function slowMetrics(): MetricSeriesByName {
  return {
    ...seriesOf({
      performanceScore: 24,
      clsScore: 0.3,
      unusedJavaScriptBytes: 320_000,
      uncompressedBytes: 210_000,
      unoptimisedImageBytes: 480_000,
      uncachedBytes: 260_000,
      totalBytes: 3_100_000,
      requestCount: 121,
      renderBlockingMs: 900,
    }),
    // Spread wider than INSTABILITY_WARNING_RATIO on all three metrics the
    // unstable-measurement rule looks at.
    lcpMs: { median: 4_500, samples: [2_100, 7_400], instability: 1.17 },
    ttfbMs: { median: 1_900, samples: [900, 2_900], instability: 1.05 },
    tbtMs: { median: 700, samples: [300, 1_100], instability: 1.14 },
  };
}

function slowPage(): readonly UrlAudit[] {
  return [
    {
      url: ORIGIN,
      primary: true,
      devices: [deviceResult('mobile', {}, { requestedSamples: 2, metrics: slowMetrics() })],
    },
  ];
}

const REAL_VISITORS: FieldResult = {
  state: 'available',
  scope: 'origin',
  detail: 'Real-visitor 75th percentiles from the Chrome UX Report.',
  metrics: {
    lcpP75Ms: 5_200,
    inpP75Ms: 640,
    clsP75: 0.04,
    ttfbP75Ms: 1_400,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-28',
  },
};

const NO_REAL_VISITORS: FieldResult = {
  state: 'no_data',
  scope: 'origin',
  detail: 'The Chrome UX Report has no record for this origin.',
  metrics: null,
};

/** Every finding the module can produce, from the two field outcomes. */
function everyFinding(): readonly PerformanceFinding[] {
  return [
    ...performanceFindings(ORIGIN, slowPage(), REAL_VISITORS),
    ...performanceFindings(ORIGIN, slowPage(), NO_REAL_VISITORS),
  ];
}

function storedOf(findings: readonly PerformanceFinding[]) {
  return storedPerformanceFindings(JSON.parse(JSON.stringify(findings)));
}

function findingFor(ruleId: string) {
  const stored = storedOf(everyFinding()).find((finding) => finding.ruleId === ruleId);
  if (stored === undefined) throw new Error(`the fixture produced no ${ruleId} finding`);
  return stored;
}

describe('performanceFindingText', () => {
  it('rebuilds a lab metric sentence from its evidence, in both languages', () => {
    const finding = findingFor('PERF-LAB-TTFB');

    expect(performanceFindingText(finding, 'en').summary).toBe(
      'Time to First Byte is 1.9 s on mobile (good is under 800 ms).',
    );
    expect(performanceFindingText(finding, 'uk').summary).toBe(
      'Час до першого байта (TTFB) — 1.9 с на мобільному (добре — до 800 мс).',
    );
  });

  it('writes the units in the reader’s language, not the provider’s', () => {
    const uk = performanceFindingText(findingFor('PERF-LAB-LCP'), 'uk');

    expect(uk.summary).toContain(' с ');
    expect(uk.summary).not.toContain(' s ');
    expect(uk.summary).not.toContain(' ms');
  });

  it('states a byte saving in the reader’s language', () => {
    const uk = performanceFindingText(findingFor('PERF-RES-UNUSED-JS'), 'uk');

    expect(uk.summary).toContain('кБ JavaScript');
    expect(uk.summary).not.toContain('never used');
  });

  // The absence of INP is itself a finding, and its advice is the state CrUX
  // reported — which the audit stored as an English sentence.
  it('explains an unmeasurable INP from the field state rather than quoting it', () => {
    const finding = findingFor('PERF-FIELD-INP');
    const unavailable = storedOf(performanceFindings(ORIGIN, slowPage(), NO_REAL_VISITORS)).find(
      (entry) => entry.ruleId === 'PERF-FIELD-INP',
    );

    expect(finding.severity).not.toBe('');
    expect(unavailable?.evidence.fieldState).toBe('no_data');
    const uk = performanceFindingText(unavailable ?? finding, 'uk');
    expect(uk.summary).toBe('Затримку реакції на дію (INP) для цього сайту виміряти не вдалося.');
    expect(uk.recommendation).toContain('Chrome UX Report не має запису');
    expect(uk.recommendation).not.toContain('has no record');
  });

  it('names which metrics the repeated runs disagreed on, as their own acronyms', () => {
    const uk = performanceFindingText(findingFor('PERF-MEASUREMENT-UNSTABLE'), 'uk');

    expect(uk.summary).toContain('LCP, TTFB, TBT');
    expect(uk.summary).not.toContain('lcpMs');
  });

  it('keeps the stored sentence for a rule this build has no copy for', () => {
    const later = {
      ruleId: 'PERF-SOMETHING-LATER',
      severity: 'medium',
      url: ORIGIN,
      strategy: 'mobile' as const,
      summary: 'A finding this build has never seen.',
      recommendation: 'Do the thing it recommends.',
      evidence: {},
    };

    expect(performanceFindingText(later, 'uk')).toEqual({
      summary: later.summary,
      recommendation: later.recommendation,
    });
  });

  it('keeps the stored sentence when the evidence does not carry what it states', () => {
    const withoutEvidence = { ...findingFor('PERF-LAB-LCP'), evidence: {} };

    expect(performanceFindingText(withoutEvidence, 'uk').summary).toBe(withoutEvidence.summary);
  });
});

describe('storedPerformanceFindings', () => {
  it('reads nothing out of a row that carries no findings', () => {
    expect(storedPerformanceFindings(undefined)).toEqual([]);
    expect(storedPerformanceFindings([{ severity: 'high' }])).toEqual([]);
  });

  it('keeps only a device this build knows', () => {
    const [read] = storedPerformanceFindings([
      { ruleId: 'PERF-LAB-LCP', strategy: 'watch', evidence: { median: 1 } },
    ]);

    expect(read?.strategy).toBeNull();
  });
});

describe('the producer’s rule vocabulary', () => {
  const produced = storedOf(everyFinding());

  it('produces every rule the module implements, so the guard below is complete', () => {
    expect([...new Set(produced.map((finding) => finding.ruleId))].sort()).toEqual(
      [...IMPLEMENTED_PERF_RULE_IDS].sort(),
    );
  });

  it.each(IMPLEMENTED_PERF_RULE_IDS)('says %s in Ukrainian, not in the API’s English', (ruleId) => {
    const finding = produced.find((entry) => entry.ruleId === ruleId);
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    const uk = performanceFindingText(finding, 'uk');

    expect(uk.summary).not.toBe('');
    expect(uk.summary).not.toBe(finding.summary);
    expect(uk.recommendation).not.toBe('');
    expect(uk.recommendation).not.toBe(finding.recommendation);
  });
});
