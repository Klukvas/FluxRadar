// Whose problem each module reason is, and whether the owner has to act.
//
// `module-status.ts` answers that per reason code, which is the only place it
// can be answered: a Performance row whose provider was never configured and
// one whose samples were lost ask opposite things of the owner, and the section
// name cannot tell them apart. The map and the sentences it chooses had no test
// at all — so a reason could be added with no answer, or answered wrongly, and
// nothing failed.
//
// Every reason key is listed below with the answer it must give, in both
// languages, and the list is checked against the real set of keys: a new reason
// fails here until somebody decides whose it is.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, Scan, ScanModule } from './api';
import { copy, type Language } from './i18n';
import { moduleResponsibilities, moduleStatusReasons } from './module-status';
import { ResultsScreen } from './Report';

const LANGUAGES: readonly Language[] = ['en', 'uk'];

type ReasonKey = keyof (typeof copy)['en']['report']['moduleReason'];
type Blame = keyof (typeof copy)['en']['report']['moduleResponsibility'];

/** One reason, as the API writes it, and the answer the card owes beside it. */
interface ReasonCase {
  /** The sentence key the reason must resolve to. */
  readonly key: ReasonKey;
  /** The `status_reason` the producing side writes. */
  readonly reason: string;
  /** Whose problem it is, or null where the reason answers for itself. */
  readonly blame: Blame | null;
}

/**
 * Every reason key, with the wire value that produces it.
 *
 * The four keys that are clauses rather than tokens are written in the form
 * that isolates them — empty brackets, or a cause this build has no sentence
 * for — so each row tests one key's answer and not its neighbour's. Their
 * assembled forms are exercised under "a reason made of several causes" below.
 */
const REASONS: readonly ReasonCase[] = [
  // Crawl coverage, shared by every rules module.
  { key: 'noApplicableTargets', reason: 'NoApplicableTargets', blame: 'nothingToMeasure' },
  { key: 'targetsUnreachable', reason: 'TargetsUnreachable', blame: 'theSite' },
  {
    key: 'targetsPartiallyUnreachable',
    reason: 'TargetsPartiallyUnreachable',
    blame: 'theSite',
  },
  { key: 'noDeterministicOracle', reason: 'NoDeterministicOracle', blame: 'notYet' },
  { key: 'platformFailure', reason: 'PlatformFailure', blame: 'oursRetry' },
  { key: 'scanCancelled', reason: 'ScanCancelled', blame: 'yourChoice' },
  // Performance. Only the first of these four is ours alone. A lost sample, a
  // missing score and an Unavailable row can all come from the owner's own page
  // not answering the measurement service — the row is written Unavailable when
  // no sample survived, and a sample is lost on any answer that is not OK — so
  // none of the other three claims a side.
  {
    key: 'performanceNotConfigured',
    reason: 'PerformanceIntegrationNotConfigured',
    blame: 'ours',
  },
  {
    key: 'performanceScoreUnavailable',
    reason: 'PerformanceScoreUnavailable',
    blame: 'eitherSide',
  },
  {
    key: 'performanceSamplesIncomplete',
    reason: 'PerformanceSamplesIncomplete',
    blame: 'eitherSide',
  },
  {
    key: 'performanceProviderUnavailable',
    reason: 'PerformanceProviderUnavailable',
    blame: 'eitherSide',
  },
  // AI SEO / GEO: the refusals that stopped a request before it left.
  { key: 'aiConsentMissing', reason: 'ConsentMissing', blame: 'ours' },
  { key: 'aiRedactionBlocked', reason: 'RedactionBlocked', blame: 'ours' },
  { key: 'aiQuotaExceeded', reason: 'QuotaExceeded', blame: 'byPlan' },
  { key: 'aiProviderUnavailable', reason: 'ProviderUnavailable', blame: 'oursRetry' },
  { key: 'aiProviderContract', reason: 'ProviderContract', blame: 'ours' },
  { key: 'aiEmptyQuestionLibrary', reason: 'EmptyQuestionLibrary', blame: 'ours' },
  // The same refusals met by the AI-assisted UX review.
  { key: 'uxAiConsentMissing', reason: 'UxAiConsentMissing', blame: 'ours' },
  { key: 'uxAiRedactionBlocked', reason: 'UxAiRedactionBlocked', blame: 'ours' },
  { key: 'uxAiQuotaExceeded', reason: 'UxAiQuotaExceeded', blame: 'byPlan' },
  { key: 'uxAiProviderUnavailable', reason: 'UxAiProviderUnavailable', blame: 'oursRetry' },
  { key: 'uxAiProviderContract', reason: 'UxAiProviderContract', blame: 'ours' },
  { key: 'uxAiScanCancelled', reason: 'UxAiScanCancelled', blame: 'yourChoice' },
  { key: 'uxAiUnsupportedClaims', reason: 'UxAiUnsupportedClaims', blame: 'ours' },
  // The counted and composite clauses. A count is not a cause: the causes
  // follow it and carry the answer, so the count itself gives none.
  { key: 'aiPartial', reason: '2 of 12 AI requests unavailable ()', blame: null },
  { key: 'aiCancelled', reason: 'ScanCancelled: 2 of 5 questions answered', blame: 'yourChoice' },
  {
    key: 'aiEvaluationUnavailable',
    reason: 'AnswerEvaluationUnavailable: 1 of 12 ()',
    blame: null,
  },
  {
    key: 'aiQueryGenerationUnavailable',
    reason: 'QueryGenerationUnavailable: NoRefusalThisBuildKnows',
    blame: null,
  },
  {
    key: 'aiQueryGenerationInvalidResponse',
    reason: 'QueryGenerationInvalidResponse: questions[0] is not a string',
    blame: 'ours',
  },
  // Analytics: the only group where the owner is the one who can act.
  { key: 'analyticsNotConnected', reason: 'AnalyticsIntegrationNotConnected', blame: 'yours' },
  { key: 'analyticsPropertyNotSelected', reason: 'AnalyticsPropertyNotSelected', blame: 'yours' },
  {
    key: 'analyticsNeedsReconnect',
    reason: 'AnalyticsIntegrationNeedsReconnect',
    blame: 'yours',
  },
  { key: 'analyticsAccessDenied', reason: 'AnalyticsPropertyAccessDenied', blame: 'yours' },
  { key: 'analyticsNoData', reason: 'AnalyticsNoDataForPeriod', blame: 'nothingToMeasure' },
  {
    key: 'analyticsProviderUnavailable',
    reason: 'AnalyticsProviderUnavailable',
    blame: 'oursRetry',
  },
  // A reason this build has never seen is quoted, and answered for by nobody.
  { key: 'unknown', reason: 'SomethingNoBuildHasEverWritten', blame: null },
];

function moduleRow(statusReason: string | null, module = 'SEO'): ScanModule {
  return {
    module,
    status: 'Partial',
    statusReason,
    coverage: 0.5,
    score: 60,
    applicableChecks: 4,
    completedApplicableChecks: 2,
    usableOutput: true,
    metadata: {},
  };
}

/**
 * The longest stretch of a sentence with no placeholder in it.
 *
 * The counted reasons are filled with numbers before they are shown, so they
 * cannot be compared whole. This is the part of them that is still the
 * product's own words, which is what proves the row reached the key it names
 * rather than falling through to the quoted-reason fallback.
 */
function distinctive(sentence: string): string {
  return sentence
    .split(/\{[a-zA-Z]+\}/)
    .reduce((longest, part) => (part.length > longest.length ? part : longest), '');
}

describe('whose problem each module reason is', () => {
  it('has a row for every reason the product can send', () => {
    // The guard that makes the table above worth having: a reason added to
    // `i18n.ts` with no answer chosen for it fails here.
    expect(REASONS.map((entry) => entry.key).sort()).toEqual(
      Object.keys(copy.en.report.moduleReason).sort(),
    );
    // No key listed twice, so no row can be hiding another's absence.
    expect(new Set(REASONS.map((entry) => entry.key)).size).toBe(REASONS.length);
  });

  for (const entry of REASONS) {
    it.each(LANGUAGES)(`answers ${entry.key} with ${entry.blame ?? 'nothing'} (%s)`, (language) => {
      const t = copy[language].report;
      const row = moduleRow(entry.reason);

      // The reason resolved to the key the row names — not to the fallback
      // that quotes an unrecognised reason, which would answer nothing.
      const words = distinctive(t.moduleReason[entry.key]);
      expect(words.length).toBeGreaterThan(10);
      expect(moduleStatusReasons(row, language).join('\n')).toContain(words);

      expect(moduleResponsibilities(row, language)).toEqual(
        entry.blame === null ? [] : [t.moduleResponsibility[entry.blame]],
      );
    });
  }

  it('says nothing at all for a section that simply finished', () => {
    for (const language of LANGUAGES) {
      expect(moduleResponsibilities(moduleRow(null), language)).toEqual([]);
      expect(moduleResponsibilities(moduleRow('   '), language)).toEqual([]);
    }
  });

  it('answers in the reader’s language, and not in the other one', () => {
    const row = moduleRow('PerformanceSamplesIncomplete');
    expect(moduleResponsibilities(row, 'en')).toEqual([
      copy.en.report.moduleResponsibility.eitherSide,
    ]);
    expect(moduleResponsibilities(row, 'uk')).toEqual([
      copy.uk.report.moduleResponsibility.eitherSide,
    ]);
    expect(copy.uk.report.moduleResponsibility.eitherSide).not.toBe(
      copy.en.report.moduleResponsibility.eitherSide,
    );
  });

  // The sentence must survive being read beside a chip that says the section
  // was checked: it may not blame the owner for something they cannot change,
  // and it may not promise that anything will be different next time.
  it('promises nothing and blames nobody it should not', () => {
    for (const language of LANGUAGES) {
      for (const sentence of Object.values(copy[language].report.moduleResponsibility)) {
        expect(sentence.trim()).not.toBe('');
        expect(sentence).toMatch(/[.!]$/);
        expect(sentence).not.toMatch(/will fix|guarantee|гарант|виправить це/i);
      }
      // Only the two answers that really are the owner's say so.
      const owned: readonly string[] = [
        copy[language].report.moduleResponsibility.yours,
        copy[language].report.moduleResponsibility.yourChoice,
      ];
      for (const [name, sentence] of Object.entries(copy[language].report.moduleResponsibility)) {
        if (owned.includes(sentence)) continue;
        expect({
          name,
          blamesYou: /you (did|forgot|must)|ви (забули|мусите)/i.test(sentence),
        }).toEqual({
          name,
          blamesYou: false,
        });
      }
    }
  });
});

describe('a reason made of several causes', () => {
  it('names each distinct answer once, in the order the causes are read', () => {
    // A partial GEO run reports how many requests failed and why. Two of these
    // three causes are ours and one is the plan's: the card says each answer
    // once, not "this is on our side" twice.
    const row = moduleRow(
      '3 of 12 AI requests unavailable (ProviderContract, RedactionBlocked, QuotaExceeded)',
      'AI SEO / GEO',
    );
    for (const language of LANGUAGES) {
      const t = copy[language].report.moduleResponsibility;
      expect(moduleResponsibilities(row, language)).toEqual([t.ours, t.byPlan]);
      // Four sentences above them: the count, and one per cause.
      expect(moduleStatusReasons(row, language)).toHaveLength(4);
    }
  });

  it('lets the causes of an unchecked answer speak, not the count', () => {
    const row = moduleRow(
      'AnswerEvaluationUnavailable: 1 of 12 (ProviderContract)',
      'AI SEO / GEO',
    );
    for (const language of LANGUAGES) {
      expect(moduleResponsibilities(row, language)).toEqual([
        copy[language].report.moduleResponsibility.ours,
      ]);
    }
  });

  it('reads a cancel that landed after the questions failed as both', () => {
    const row = moduleRow(
      'ScanCancelled: 1 of 2 questions answered; QueryGenerationUnavailable: QuotaExceeded',
      'AI SEO / GEO',
    );
    for (const language of LANGUAGES) {
      const t = copy[language].report.moduleResponsibility;
      expect(moduleResponsibilities(row, language)).toEqual([t.yourChoice, t.byPlan]);
    }
  });

  it('answers for the half it recognises when the other half is new', () => {
    const row = moduleRow('QuotaExceeded; AnswerEvaluationUnavailable: 1 of 3 (SomethingNew)');
    for (const language of LANGUAGES) {
      expect(moduleResponsibilities(row, language)).toEqual([
        copy[language].report.moduleResponsibility.byPlan,
      ]);
    }
  });
});

const SCAN: Scan = {
  id: 'scan-responsibility-1',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://bloom-nails.example',
  status: 'Completed',
  reportReady: true,
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 1, totalModules: 1, scannedUrls: 4 },
  startedAt: '2026-10-02T09:14:00.000Z',
  completedAt: '2026-10-02T09:21:00.000Z',
  createdAt: '2026-10-02T09:14:00.000Z',
  modules: [],
};

function dashboardOf(modules: readonly ScanModule[]): Dashboard {
  return {
    scan: { ...SCAN, modules: [] },
    overall: { verdict: 'normal', score: 60, weightedCoverage: 0.9, moduleWeights: [] },
    modules,
    geoObservations: [],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('on the report itself', () => {
  it('puts the responsibility line after the reason, on the same card', async () => {
    const dashboard = dashboardOf([moduleRow('PerformanceSamplesIncomplete', 'Performance')]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, data: dashboard, error: null }), {
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    render(
      <ResultsScreen
        scan={dashboard.scan}
        language="en"
        onScan={() => {}}
        onIssues={() => {}}
        onReports={() => {}}
        onError={() => {}}
      />,
    );
    await screen.findByText(copy.en.report.signalHeading);

    const block = document.querySelector('.module-card__reason');
    if (block === null) throw new Error('expected the section card to explain itself');
    const lines = Array.from(block.querySelectorAll('p'), (line) => line.textContent ?? '');
    // The reason first, then whose it is: the reason says what happened, and
    // the owner reading it beside a "Checked with limits" chip had no way to
    // tell whether their site was at fault or whether they were meant to act.
    expect(lines).toEqual([
      copy.en.report.moduleReason.performanceSamplesIncomplete,
      copy.en.report.moduleResponsibility.eitherSide,
    ]);
    expect(block.querySelector('p:last-of-type')?.className).toBe('module-card__responsibility');
  });
});
