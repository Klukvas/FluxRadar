// What a module row is allowed to say about itself, and why.
//
// Two defects are pinned here. A section the product deliberately does not run
// arrives as `Not applicable`, matched none of the label ladder's rungs and fell
// through to "Waiting" — so a finished report promised work that was never going
// to happen. And every row carries a machine `status_reason` the report never
// showed, so "Unavailable" was the whole explanation an owner got for a
// Performance section with no provider configured or a GEO section blocked on
// consent.

import { describe, expect, it } from 'vitest';

import type { ScanModule } from './api';
import { copy } from './i18n';
import { isNotApplicable, moduleStatusReasons } from './module-status';
import {
  chipStatusFor,
  moduleResultLabel,
  moduleScoreLabel,
  sectionStatusLabel,
} from './scan-status';
import { statusKind } from './status-kind';

function moduleRow(overrides: Partial<ScanModule> = {}): ScanModule {
  return {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: 90,
    applicableChecks: 4,
    completedApplicableChecks: 4,
    usableOutput: true,
    ...overrides,
  };
}

/** A legacy Not applicable row used to pin neutral status rendering. */
const unmeasuredRow = moduleRow({
  module: 'SEO',
  status: 'Not applicable',
  statusReason: 'NoDeterministicOracle',
  coverage: 0,
  score: null,
  applicableChecks: 0,
  completedApplicableChecks: 0,
  usableOutput: false,
});

describe('a section the plan does not measure', () => {
  it('is recognised as not applicable however the API cases it', () => {
    expect(isNotApplicable('Not applicable')).toBe(true);
    expect(isNotApplicable('not applicable')).toBe(true);
    expect(isNotApplicable('Completed')).toBe(false);
    expect(isNotApplicable('Unavailable')).toBe(false);
  });

  // A completed report must not render a terminal Not applicable row as a queue position.
  it('never reads as waiting on the progress window', () => {
    expect(sectionStatusLabel(unmeasuredRow.status, 'en')).toBe(
      copy.en.scanProgress.sectionNotApplicable,
    );
    expect(sectionStatusLabel(unmeasuredRow.status, 'en')).not.toBe(
      copy.en.scanProgress.sectionWaiting,
    );
    expect(sectionStatusLabel(unmeasuredRow.status, 'uk')).toBe(
      copy.uk.scanProgress.sectionNotApplicable,
    );
    expect(sectionStatusLabel(unmeasuredRow.status, 'uk')).not.toBe(
      copy.uk.scanProgress.sectionWaiting,
    );
  });

  // ...and on the report card it is not "Insufficient data" either: nothing was
  // attempted, so there is no shortfall of data to report.
  it('reads as not applicable on the report card, not as missing data', () => {
    expect(moduleResultLabel(unmeasuredRow, 'en')).toBe(copy.en.scanProgress.sectionNotApplicable);
    expect(moduleResultLabel(unmeasuredRow, 'en')).not.toBe(
      copy.en.scanProgress.moduleInsufficient,
    );
    expect(moduleResultLabel(unmeasuredRow, 'uk')).toBe(copy.uk.scanProgress.sectionNotApplicable);
  });

  it('keeps its own chip status rather than borrowing a failure', () => {
    expect(chipStatusFor(unmeasuredRow)).toBe('Not applicable');
    // Neutral, because the design system has no colour for "we did not look" —
    // and an error colour would read as a finding.
    expect(statusKind(chipStatusFor(unmeasuredRow))).toBe('neutral');
  });

  it('explains that it is a gap in the product, not in the site', () => {
    expect(moduleStatusReasons(unmeasuredRow, 'en')).toEqual([
      copy.en.report.moduleReason.noDeterministicOracle,
    ]);
    expect(moduleStatusReasons(unmeasuredRow, 'uk')).toEqual([
      copy.uk.report.moduleReason.noDeterministicOracle,
    ]);
  });
});

describe('why a section is unavailable or partial', () => {
  it('says nothing about a section that simply completed', () => {
    expect(moduleStatusReasons(moduleRow(), 'en')).toEqual([]);
  });

  // The two Performance causes an owner can actually act on differently: one is
  // this deployment's configuration, the other is a provider that went away.
  it('separates a missing performance integration from a provider outage', () => {
    const notConfigured = moduleRow({
      module: 'Performance',
      status: 'Unavailable',
      statusReason: 'PerformanceIntegrationNotConfigured',
      score: null,
      usableOutput: false,
    });
    const outage = moduleRow({ ...notConfigured, statusReason: 'PerformanceProviderUnavailable' });

    expect(moduleStatusReasons(notConfigured, 'en')).toEqual([
      copy.en.report.moduleReason.performanceNotConfigured,
    ]);
    expect(moduleStatusReasons(outage, 'en')).toEqual([
      copy.en.report.moduleReason.performanceProviderUnavailable,
    ]);
    expect(moduleStatusReasons(notConfigured, 'en')).not.toEqual(moduleStatusReasons(outage, 'en'));
  });

  // One failed PageSpeed sample out of the twelve an audit takes is enough to
  // produce this row, so the untranslated token would have been an ordinary
  // sight rather than an exotic one.
  it('explains an audit that measured fewer runs than it asked for', () => {
    const partial = moduleRow({
      module: 'Performance',
      status: 'Partial',
      statusReason: 'PerformanceSamplesIncomplete',
      coverage: 0.5,
      score: 71,
    });

    expect(moduleStatusReasons(partial, 'en')).toEqual([
      copy.en.report.moduleReason.performanceSamplesIncomplete,
    ]);
    expect(moduleStatusReasons(partial, 'uk')).toEqual([
      copy.uk.report.moduleReason.performanceSamplesIncomplete,
    ]);
  });

  it('reports a performance run that produced measurements but no score', () => {
    const partial = moduleRow({
      module: 'Performance',
      status: 'Partial',
      statusReason: 'PerformanceScoreUnavailable',
      coverage: 0.5,
      score: null,
    });
    expect(moduleStatusReasons(partial, 'en')).toEqual([
      copy.en.report.moduleReason.performanceScoreUnavailable,
    ]);
  });

  it('names the AI cause instead of a single generic AI label', () => {
    const consent = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Unavailable',
      statusReason: 'ConsentMissing',
      score: null,
      usableOutput: false,
    });
    const quota = moduleRow({ ...consent, statusReason: 'QuotaExceeded' });
    const redaction = moduleRow({ ...consent, statusReason: 'RedactionBlocked' });

    expect(moduleStatusReasons(consent, 'en')).toEqual([
      copy.en.report.moduleReason.aiConsentMissing,
    ]);
    expect(moduleStatusReasons(quota, 'en')).toEqual([copy.en.report.moduleReason.aiQuotaExceeded]);
    expect(moduleStatusReasons(redaction, 'en')).toEqual([
      copy.en.report.moduleReason.aiRedactionBlocked,
    ]);
  });

  // The GEO module reports a partial run as a free-form English sentence built
  // from the failures it saw. It is read for its numbers and its causes, and
  // every distinct cause is spelled out in full — that is the point.
  it('unpacks the counted sentence a partial GEO run sends', () => {
    const partial = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Partial',
      statusReason: '1 of 2 AI requests unavailable (ProviderUnavailable)',
      coverage: 0.5,
      score: 100,
    });

    expect(moduleStatusReasons(partial, 'en')).toEqual([
      '1 of 2 AI questions could not be asked, so this section covers only the ones that were. Each cause is named below.',
      copy.en.report.moduleReason.aiProviderUnavailable,
    ]);
  });

  it('names every distinct cause of a partial GEO run exactly once', () => {
    const partial = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Partial',
      statusReason:
        '3 of 4 AI requests unavailable (QuotaExceeded, ProviderUnavailable, QuotaExceeded)',
      coverage: 0.25,
      score: 100,
    });

    const reasons = moduleStatusReasons(partial, 'en');
    expect(reasons).toHaveLength(3);
    expect(reasons.slice(1)).toEqual([
      copy.en.report.moduleReason.aiQuotaExceeded,
      copy.en.report.moduleReason.aiProviderUnavailable,
    ]);
  });

  it('translates the Google causes an owner has to act on', () => {
    const cases = [
      ['AnalyticsIntegrationNotConnected', 'analyticsNotConnected'],
      ['AnalyticsPropertyNotSelected', 'analyticsPropertyNotSelected'],
      ['AnalyticsIntegrationNeedsReconnect', 'analyticsNeedsReconnect'],
      ['AnalyticsPropertyAccessDenied', 'analyticsAccessDenied'],
      ['AnalyticsNoDataForPeriod', 'analyticsNoData'],
      ['AnalyticsProviderUnavailable', 'analyticsProviderUnavailable'],
    ] as const;
    for (const [wire, key] of cases) {
      const row = moduleRow({
        module: 'Analytics',
        status: 'Unavailable',
        statusReason: wire,
        score: null,
        usableOutput: false,
      });
      expect(moduleStatusReasons(row, 'uk')).toEqual([copy.uk.report.moduleReason[key]]);
    }
  });

  // A reason this build has never seen is still a fact about the scan. Quoting
  // it beats both silence and a paraphrase nobody can check.
  it('quotes a reason it has no sentence for rather than inventing one', () => {
    const row = moduleRow({
      status: 'Unavailable',
      statusReason: 'SomethingTheApiLearnedLater',
      score: null,
      usableOutput: false,
    });
    expect(moduleStatusReasons(row, 'en')).toEqual([
      'The audit recorded this reason: SomethingTheApiLearnedLater',
    ]);
  });

  it('never leaks a raw machine token as the whole explanation', () => {
    const known = [
      'NoApplicableTargets',
      'TargetsUnreachable',
      'TargetsPartiallyUnreachable',
      'NoDeterministicOracle',
      'PlatformFailure',
      'PerformanceIntegrationNotConfigured',
      'PerformanceScoreUnavailable',
      'PerformanceSamplesIncomplete',
      'PerformanceProviderUnavailable',
      'ConsentMissing',
      'RedactionBlocked',
      'QuotaExceeded',
      'ProviderUnavailable',
      'ProviderContract',
      'EmptyQuestionLibrary',
      'UxAiConsentMissing',
      'UxAiRedactionBlocked',
      'UxAiQuotaExceeded',
      'UxAiProviderUnavailable',
      'UxAiProviderContract',
      'AnalyticsIntegrationNotConnected',
      'AnalyticsPropertyNotSelected',
      'AnalyticsIntegrationNeedsReconnect',
      'AnalyticsPropertyAccessDenied',
      'AnalyticsNoDataForPeriod',
      'AnalyticsProviderUnavailable',
    ];
    for (const reason of known) {
      for (const language of ['en', 'uk'] as const) {
        const sentences = moduleStatusReasons(
          moduleRow({ status: 'Unavailable', statusReason: reason, usableOutput: false }),
          language,
        );
        expect(sentences).toHaveLength(1);
        expect(sentences[0]).not.toContain(reason);
        // A sentence, not a label: this is what "do not hide the cause behind a
        // generic word" has to mean in practice.
        expect((sentences[0] ?? '').length).toBeGreaterThan(40);
      }
    }
  });
});

describe('what a section puts where its score would go', () => {
  it('an informational section says so instead of showing a number it did not measure', () => {
    const geo = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Completed',
      score: null,
      usableOutput: true,
      metadata: { scoring: 'InformationalOnly' },
    });
    for (const language of ['en', 'uk'] as const) {
      expect(moduleScoreLabel(geo, language)).toBe(copy[language].report.informationalLabel);
      // Not the Free-plan sentence: the plan is not why this row has no number.
      expect(moduleScoreLabel(geo, language)).not.toBe(copy[language].report.unscoredLabel);
    }
  });

  it('a section that produced nothing still reports the plain absence', () => {
    const unavailable = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Unavailable',
      statusReason: 'ConsentMissing',
      score: null,
      usableOutput: false,
      metadata: { scoring: 'InformationalOnly' },
    });
    expect(moduleScoreLabel(unavailable, 'en')).toBe(copy.en.report.noScore);
  });

  it('a measured section still shows its number', () => {
    expect(moduleScoreLabel(moduleRow({ score: 90 }), 'en')).toBe('90.00');
  });
});

describe('a section stopped by the owner', () => {
  it('is explained as a cancellation, not as a platform failure or a site fault', () => {
    const cancelled = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Unavailable',
      statusReason: 'ScanCancelled',
      score: null,
      usableOutput: false,
    });
    for (const language of ['en', 'uk'] as const) {
      const sentences = moduleStatusReasons(cancelled, language);
      expect(sentences).toEqual([copy[language].report.moduleReason.scanCancelled]);
      // Not the raw token, and not the platform-failure sentence.
      expect(sentences[0]).not.toContain('ScanCancelled');
      expect(sentences[0]).not.toBe(copy[language].report.moduleReason.platformFailure);
    }
  });

  it('a partly answered GEO section reports how much of it was answered', () => {
    // The run keeps the answers it already received, so the reader is owed the
    // numbers rather than the raw English sentence the API assembled.
    const partlyAnswered = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Partial',
      statusReason: 'ScanCancelled: 2 of 5 questions answered',
      score: null,
      usableOutput: true,
    });
    for (const language of ['en', 'uk'] as const) {
      const sentences = moduleStatusReasons(partlyAnswered, language);
      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toContain('2');
      expect(sentences[0]).toContain('5');
      expect(sentences[0]).not.toContain('ScanCancelled');
    }
  });

  it('a composite GEO reason is read clause by clause, not quoted in English', () => {
    // A cancel that lands after question generation already failed produces two
    // clauses in one string. It matches no single token, and the whole sentence
    // used to fall through to the "the audit recorded this reason: …" quote —
    // with the English original inside a Ukrainian report.
    const composite = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Partial',
      statusReason:
        'ScanCancelled: 1 of 2 questions answered; QueryGenerationUnavailable: ConsentMissing',
      score: null,
      usableOutput: true,
    });
    for (const language of ['en', 'uk'] as const) {
      const t = copy[language].report.moduleReason;
      const sentences = moduleStatusReasons(composite, language);
      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toContain('1');
      expect(sentences[0]).toContain('2');
      expect(sentences[1]).toBe(t.aiQueryGenerationUnavailable);
      expect(sentences[2]).toBe(t.aiConsentMissing);
      for (const sentence of sentences) {
        expect(sentence).not.toContain('QueryGeneration');
        expect(sentence).not.toContain('ConsentMissing');
      }
    }
  });

  it('a generation failure on its own is a sentence, and its developer detail is not quoted', () => {
    const invalid = moduleRow({
      module: 'AI SEO / GEO',
      status: 'Partial',
      statusReason:
        'QueryGenerationInvalidResponse: [{"code":"invalid_type","path":["questions"]}]',
      score: null,
      usableOutput: true,
    });
    for (const language of ['en', 'uk'] as const) {
      const sentences = moduleStatusReasons(invalid, language);
      expect(sentences).toEqual([
        copy[language].report.moduleReason.aiQueryGenerationInvalidResponse,
      ]);
      expect(sentences[0]).not.toContain('invalid_type');
    }
  });

  it('an interrupted UX review says the static checks still ran', () => {
    const uxPartial = moduleRow({
      module: 'UX/Conversion',
      status: 'Partial',
      statusReason: 'UxAiScanCancelled',
      score: 80,
      usableOutput: true,
    });
    for (const language of ['en', 'uk'] as const) {
      expect(moduleStatusReasons(uxPartial, language)).toEqual([
        copy[language].report.moduleReason.uxAiScanCancelled,
      ]);
    }
  });
});
