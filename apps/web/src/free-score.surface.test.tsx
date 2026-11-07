import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IssueTable } from './IssueTable';
import { NextStep } from './NextStep';
import { PrintReport } from './PrintReport';
import { ResultsScreen } from './Report';
import type { Dashboard, Issue, Scan, ScanModule, SiteProfile } from './api';
import { FREE_CHECK_COUNT, FREE_SCORE_UPGRADE_PLAN, freeScoreCopy } from './free-score-copy';
import { copy, type Language } from './i18n';
import { moduleScoreLabel } from './scan-status';

// D-237: a Free check is a quick check shown out of 40. Its stored score stays
// 0–100; the API sends it converted, with `scoreMax: 40` (apps/api
// free-score-view.test.ts proves a stored 100 arrives as 40 / 40). This
// dashboard is what the API sends for a Free homepage whose STORED score is
// 100. No surface that prints the number — the report dial, the SEO card, the
// report help, the printable report and the dashboard step — may show a value
// above 40, or a Free score over 100. 100 may appear only inside the exact
// sentences that name the full audit's scale.

const SCAN: Scan = {
  id: 'scan-free-40',
  profileId: 'profile-1',
  plan: 'Free',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-11-06T00:00:00.000Z',
  completedAt: '2026-11-06T00:01:00.000Z',
  createdAt: '2026-11-06T00:00:00.000Z',
  modules: [],
} as unknown as Scan;

const SEO: ScanModule = {
  module: 'SEO',
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  score: 40,
  scoreMax: 40,
  applicableChecks: FREE_CHECK_COUNT,
  completedApplicableChecks: FREE_CHECK_COUNT,
  usableOutput: true,
  metadata: {
    freeCheck: true,
    scope: 'homepage only',
    scoreScope: 'homepage',
    checks: Array.from({ length: FREE_CHECK_COUNT }, (_, index) => ({
      ruleId: `RULE-${index}`,
      title: `check ${index}`,
    })),
  },
};

const DASHBOARD: Dashboard = {
  scan: SCAN,
  overall: {
    verdict: 'normal',
    score: 40,
    scoreMax: 40,
    weightedCoverage: 1,
    moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
  },
  modules: [SEO],
  geoObservations: [],
};

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...(meta ?? {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes('/action-plan')) return Promise.resolve(envelope(null));
      if (path.includes('/issues/summary')) {
        return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
      }
      if (path.includes('/issues')) {
        return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
      }
      return Promise.resolve(envelope(DASHBOARD));
    }),
  );
}

/**
 * Every 100 in `text` that is not inside one of the exact sanctioned sentences:
 * the disclosure, the help's rule and the call to action (each names the full
 * audit's scale), and the coverage line (which measures how much ran, not the
 * score). A "/ 100" denominator is not sanctioned on a Free report.
 */
function hundredsAsValues(text: string, language: Language): readonly string[] {
  const t = freeScoreCopy[language];
  const sanctioned = [
    t.capRule(FREE_CHECK_COUNT, 40, 100),
    t.upgrade(100),
    copy[language].report.coverageValue.replace('{percent}', '100'),
  ];
  const stripped = sanctioned.reduce((rest, sentence) => rest.replaceAll(sentence, ' '), text);
  return stripped.match(/.{0,30}\b100\b.{0,30}/g) ?? [];
}

/**
 * Every "value / max" printed with a value above 40 or a max other than 40. Text
 * nodes are joined with spaces, so a date next to the dial ("2026") never runs
 * into the number.
 */
function scoresOffTheFreeScale(): readonly string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    parts.push(node.textContent ?? '');
  }
  return stringScoresOffTheFreeScale(parts.join(' '));
}

/** The same check on a plain string. */
function stringScoresOffTheFreeScale(text: string): readonly string[] {
  return [...text.matchAll(/(\d+)\s*\/\s*(\d+)/g)]
    .filter((match) => Number(match[1]) > 40 || Number(match[2]) !== 40)
    .map((match) => match[0]);
}

/** The page text, with the module cards' coverage bars ("100%") left out. */
function pageText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const bar of clone.querySelectorAll('.progress__value')) bar.remove();
  return clone.textContent ?? '';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a Free report whose stored homepage score is 100', () => {
  it.each<[Language, string, string, string]>([
    [
      'en',
      'Homepage score',
      '40 of 40',
      'Quick check: 6 light checks on the homepage only. Not everything is checked.',
    ],
    [
      'uk',
      'Оцінка головної сторінки',
      '40 з 40',
      'Швидка перевірка: 6 легких перевірок лише головної сторінки. Перевірено не все.',
    ],
  ])(
    'shows 40 / 40 with the quick-check note beside the dial (%s)',
    async (language, label, spoken, rule) => {
      stubFetch();
      const onUpgrade = vi.fn();
      render(
        <ResultsScreen
          scan={SCAN}
          language={language}
          onScan={() => {}}
          onIssues={() => {}}
          onReports={() => {}}
          onError={() => {}}
          onUpgrade={onUpgrade}
        />,
      );
      const meter = await screen.findByRole('meter', { name: label });
      expect(meter).toHaveAttribute('aria-valuemin', '0');
      expect(meter).toHaveAttribute('aria-valuemax', '40');
      expect(meter).toHaveAttribute('aria-valuenow', '40');
      expect(meter).toHaveAttribute('aria-valuetext', spoken);
      expect(meter).toHaveTextContent('40 / 40');
      // The quick-check note sits in the dial itself, not only in the folded help.
      const dial = meter.closest('.score-dial');
      if (!(dial instanceof HTMLElement)) throw new Error('no score dial');
      const note = within(dial).getByText((text) => text.includes(rule));
      // Exactly the one short line: the long statement must not come back
      // into the dial (owner decision, D-237).
      expect(note.textContent).toBe(rule);
      expect(dial.textContent).not.toMatch(/full audit|Повний аудит|scored out of|з оцінкою з/);
      // The SEO card prints the same number the same way.
      expect(screen.getAllByText('40 / 40').length).toBeGreaterThan(0);
      expect(hundredsAsValues(pageText(), language)).toEqual([]);
      expect(scoresOffTheFreeScale()).toEqual([]);

      // The call to action under the dial carries the full-audit promise, so
      // it is a primary button now (owner decision, D-237).
      const scoreButton = screen.getByRole('button', {
        name: freeScoreCopy[language].upgrade(100),
      });
      expect(scoreButton).toHaveClass('button--primary');
      expect(scoreButton).not.toHaveClass('button--default');
      fireEvent.click(scoreButton);
      expect(onUpgrade).toHaveBeenCalledWith(SCAN, FREE_SCORE_UPGRADE_PLAN);
    },
  );

  it('prints 40 / 40 on the printable report, with the note and no other 100', async () => {
    stubFetch();
    render(<PrintReport scanId={SCAN.id} language="en" onBack={() => {}} onError={() => {}} />);
    await screen.findByRole('heading', { level: 1 });
    expect((await screen.findAllByText('40 / 40')).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Quick check: 6 light checks on the homepage only. Not everything is checked.',
      ),
    ).toBeInTheDocument();
    // No call to action on paper.
    expect(screen.queryByText(freeScoreCopy.en.upgrade(100))).toBeNull();
    expect(hundredsAsValues(pageText(), 'en')).toEqual([]);
    expect(scoresOffTheFreeScale()).toEqual([]);
  });

  it('labels the SEO card score out of 40', () => {
    expect(moduleScoreLabel(SEO, 'en')).toBe('40 / 40');
    expect(moduleScoreLabel({ ...SEO, score: 39 }, 'uk')).toBe('39 / 40');
  });

  it('shows no 100 on the dashboard step for the finished Free check', () => {
    const profile: SiteProfile = { id: 'profile-1', name: 'Smile', domain: SCAN.domain };
    render(
      <NextStep
        language="en"
        locked={false}
        kind="freeDone"
        profiles={[profile]}
        latest={SCAN}
        onAddSite={() => {}}
        onNewScan={() => {}}
        onOpenScan={() => {}}
        onRetryScan={async () => undefined}
      />,
    );
    expect(hundredsAsValues(pageText(), 'en')).toEqual([]);
    expect(scoresOffTheFreeScale()).toEqual([]);
  });

  it('would catch a Free score printed out of 100', () => {
    expect(stringScoresOffTheFreeScale('Homepage score 40 / 100')).toEqual(['40 / 100']);
    expect(hundredsAsValues('Homepage score 40 / 100', 'en')).not.toEqual([]);
  });

  it('would catch the paid score help leaking onto a Free report', () => {
    for (const language of ['en', 'uk'] as const) {
      expect(hundredsAsValues(copy[language].report.helpScoreBody, language)).not.toEqual([]);
    }
  });
});

describe('a finding on a Free report', () => {
  const ISSUE: Issue = {
    id: 'issue-1',
    scanId: SCAN.id,
    ruleId: 'SEO-ONPAGE-005',
    module: 'SEO',
    fingerprint: 'fp-1',
    severity: 'Low',
    category: 'on-page',
    status: 'New',
    targetUrl: 'https://smile.example/',
    evidenceType: 'dom',
    evidenceRef: 'img',
    evidenceExcerpt: null,
    recommendation: 'Add alt text.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 1,
    rulePenalty: 6.25,
    scoreDelta: -6.25,
    observedAt: '2026-11-06T00:00:00.000Z',
  };

  function openFinding(plan: string): void {
    render(
      <IssueTable
        issues={[ISSUE]}
        language="en"
        soleRuleId={null}
        plan={plan}
        selectedIssue={ISSUE}
        onSelect={() => {}}
        onStatus={() => {}}
      />,
    );
  }

  it('does not print the stored penalty the Free score would not add up to', () => {
    openFinding('Free');
    expect(screen.queryByText(copy.en.issues.scoreEffect)).toBeNull();
    expect(screen.queryByText(/Lowers this section’s score by/)).toBeNull();
  });

  it('keeps the penalty on a paid report', () => {
    openFinding('Complete');
    expect(screen.getByText('Lowers this section’s score by 6.25')).toBeInTheDocument();
  });
});

describe('paid reports keep their 0–100 numbers', () => {
  it('labels a paid card score as before', () => {
    const paid: ScanModule = { ...SEO, score: 87.5, scoreMax: 100 };
    expect(moduleScoreLabel(paid, 'en')).toBe('87.50');
  });
});
