// Three pins a QA pass found missing on the Issue Center.
//
//  · the hint beside "Copy task for developer" names a number, and the message
//    it copies names one too — they are computed by two different branches, so
//    nothing stopped them disagreeing;
//  · the "Problems" tab, pressed while one problem was open, has to leave that
//    problem behind rather than show the list filtered to it;
//  · the banner's "Hide until my next visit" promises a duration, in Ukrainian
//    as well as in English.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { accountCopy } from './account-copy';
import type { Issue, IssueSummary, Scan } from './api';
import { developerTaskText, taskPageCount, type DeveloperTaskInput } from './developer-task';
import { findingCountsPages } from './finding-explainers';
import { findingsCopy } from './findings-copy';
import type { Language } from './i18n';
import { IssuesScreen } from './Issues';

const SCAN = { id: 'scan-1', domain: 'https://bloom-nails.example' } as Scan;
const LANGUAGES: readonly Language[] = ['en', 'uk'];

/** A rule whose findings are one per page, and one whose findings are not. */
const PAGE_RULE = 'SEO-ONPAGE-002';
const PER_FINDING_RULE = 'SEC-PASSIVE-005';

function issue(index: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id: `issue-${index}`,
    scanId: SCAN.id,
    ruleId: PAGE_RULE,
    module: 'SEO',
    fingerprint: `fp-${index}`,
    severity: 'Medium',
    category: 'on-page',
    status: 'New',
    targetUrl: `https://bloom-nails.example/page-${index}`,
    evidenceType: 'dom',
    evidenceRef: `issue/issue-${index}`,
    evidenceExcerpt: 'no description',
    recommendation: 'Describe the page.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 1,
    rulePenalty: 0,
    scoreDelta: 0,
    observedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ─── (b) the hint and the message have to agree about the number ────────────
//
// `taskPageCount` and `whereLine` are two branch trees over the same facts:
// what is loaded, whether the summary knows more, and whether one finding of
// this rule is one page. A number in the hint that the copied message does not
// contain means the owner reads one reach and sends another.

interface LoadState {
  readonly name: string;
  readonly ruleId: string;
  readonly issues: readonly Issue[];
  readonly allLoaded: boolean;
  readonly openFindings: number | null;
}

const LOAD_STATES: readonly LoadState[] = [
  // Everything loaded; one finding per page, so findings and pages agree.
  {
    name: 'complete, one finding per page',
    ruleId: PAGE_RULE,
    issues: [issue(1), issue(2), issue(3)],
    allLoaded: true,
    openFindings: 3,
  },
  // Everything loaded; several findings on one page (`whereComplete`'s other arm).
  {
    name: 'complete, several findings on one page',
    ruleId: PER_FINDING_RULE,
    issues: [
      issue(1, { ruleId: PER_FINDING_RULE, targetUrl: 'https://bloom-nails.example/' }),
      issue(2, { ruleId: PER_FINDING_RULE, targetUrl: 'https://bloom-nails.example/' }),
    ],
    allLoaded: true,
    openFindings: 2,
  },
  // Part loaded, summary present, one finding per page: the summary's count is
  // the page count (`wherePages`).
  {
    name: 'partly loaded, page-counting rule',
    ruleId: PAGE_RULE,
    issues: [issue(1), issue(2)],
    allLoaded: false,
    openFindings: 40,
  },
  // Part loaded, summary present, NOT a page-counting rule: the branch the QA
  // pass found unpinned (`wherePartial`).
  {
    name: 'partly loaded, non-page rule, summary present (wherePartial)',
    ruleId: PER_FINDING_RULE,
    issues: [
      issue(1, { ruleId: PER_FINDING_RULE }),
      issue(2, { ruleId: PER_FINDING_RULE, targetUrl: 'https://bloom-nails.example/book' }),
    ],
    allLoaded: false,
    openFindings: 11,
  },
  // Part loaded, no summary: the loaded findings are a lower bound.
  {
    name: 'partly loaded, no summary',
    ruleId: PER_FINDING_RULE,
    issues: [issue(1, { ruleId: PER_FINDING_RULE })],
    allLoaded: false,
    openFindings: null,
  },
  // Open findings exist, none of them loaded.
  {
    name: 'nothing loaded is open',
    ruleId: PAGE_RULE,
    issues: [issue(1, { status: 'Ignored' })],
    allLoaded: false,
    openFindings: 9,
  },
  // A summary that lags a reopen: never fewer open than are loaded.
  {
    name: 'summary behind the page',
    ruleId: PAGE_RULE,
    issues: [issue(1), issue(2), issue(3)],
    allLoaded: false,
    openFindings: 1,
  },
];

/** The number the hint beside the button prints, for one load state. */
function hintNumber(input: DeveloperTaskInput): number {
  const reach = taskPageCount(input);
  return findingCountsPages(input.ruleId) ? reach.pages : reach.findings;
}

describe('the “Copy task for developer” hint and the message it copies', () => {
  for (const state of LOAD_STATES) {
    for (const language of LANGUAGES) {
      it(`agree about the number — ${state.name} (${language})`, () => {
        const input: DeveloperTaskInput = {
          ruleId: state.ruleId,
          language,
          issues: state.issues,
          allLoaded: state.allLoaded,
          openFindings: state.openFindings,
        };
        const text = developerTaskText(input);
        if (text === null) throw new Error('expected a task for this state');
        const number = hintNumber(input);
        expect(number).toBeGreaterThan(0);
        // The message's own "where" line, which is the second line of it.
        const whereLine = text.split('\n')[2] ?? '';
        expect(whereLine).toMatch(new RegExp(`\\b${number}\\b`));
        // And every number the hint prints is in the message, so the hint can
        // never claim a reach the message does not state.
        const t = findingsCopy[language].task;
        const hint = findingCountsPages(state.ruleId)
          ? taskPageCount(input).atLeast
            ? t.explainsAtLeast('x', number)
            : t.explains('x', number)
          : t.explainsCount('x', number);
        for (const printed of hint.match(/\d+/g) ?? []) {
          expect(whereLine).toMatch(new RegExp(`\\b${printed}\\b`));
        }
      });
    }
  }

  // The guard that makes the loop above worth running: `wherePartial` prints
  // three numbers, and only one of them is the reach the hint names.
  it('covers the branch that prints three numbers', () => {
    const input: DeveloperTaskInput = {
      ruleId: PER_FINDING_RULE,
      language: 'en',
      issues: [
        issue(1, { ruleId: PER_FINDING_RULE }),
        issue(2, { ruleId: PER_FINDING_RULE, targetUrl: 'https://bloom-nails.example/book' }),
      ],
      allLoaded: false,
      openFindings: 11,
    };
    const whereLine = (developerTaskText(input) ?? '').split('\n')[2] ?? '';
    expect(whereLine).toBe(findingsCopy.en.task.wherePartial(11, 2, 2));
    expect(hintNumber(input)).toBe(11);
  });
});

// ─── (c) the Problems tab clears the problem that is open ──────────────────

const SUMMARY: IssueSummary = {
  total: 12,
  open: 12,
  bySeverity: { Medium: 12 },
  groups: [
    { ruleId: PAGE_RULE, module: 'SEO', severity: 'Medium', issues: 9, openIssues: 9 },
    { ruleId: PER_FINDING_RULE, module: 'Security', severity: 'Low', issues: 3, openIssues: 3 },
  ],
};

function json(data: unknown, meta?: Record<string, number>): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta ? { meta } : {}) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function stubIssues(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(SUMMARY));
    const ruleId = url.searchParams.get('ruleId');
    const page = (ruleId === null ? [issue(1), issue(2), issue(3)] : [issue(1), issue(2)]).map(
      (entry) => (ruleId === null ? entry : { ...entry, ruleId }),
    );
    return Promise.resolve(json(page, { total: page.length, page: 1, limit: 50 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the Problems tab, pressed while one problem is open', () => {
  it('clears the problem and shows the list of problems again', async () => {
    stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    // Open one problem from the problem list.
    const problems = await screen.findAllByRole('row');
    fireEvent.click(
      within(problems[1] as HTMLElement).getByRole('button', { name: /^Show findings/ }),
    );
    expect(await screen.findByText(findingsCopy.en.issues.problemFilter)).toBeTruthy();

    // The tab, not the "Show all problems" button beside the filter.
    fireEvent.click(screen.getByRole('button', { name: findingsCopy.en.issues.viewProblems }));

    // No filter block, and the problem list is back with both problems on it.
    expect(screen.queryByText(findingsCopy.en.issues.problemFilter)).toBeNull();
    expect(
      screen.getByRole('button', { name: findingsCopy.en.issues.viewProblems }),
    ).toHaveAttribute('aria-pressed', 'true');
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(SUMMARY.groups.length + 1);
  });

  it('does the same from the Every finding tab', async () => {
    stubIssues();
    render(<IssuesScreen scan={SCAN} language="en" onError={() => {}} />);

    const problems = await screen.findAllByRole('row');
    fireEvent.click(
      within(problems[1] as HTMLElement).getByRole('button', { name: /^Show findings/ }),
    );
    await screen.findByText(findingsCopy.en.issues.problemFilter);

    fireEvent.click(screen.getByRole('button', { name: findingsCopy.en.issues.viewAll }));

    expect(screen.queryByText(findingsCopy.en.issues.problemFilter)).toBeNull();
  });
});

// ─── (d) the banner says how long "Hide" lasts, in both languages ──────────

describe('“Hide until my next visit”', () => {
  it('promises a duration in English and in Ukrainian', () => {
    expect(accountCopy.en.banner.dismissSession).toMatch(/next visit/);
    // The Ukrainian half was never pinned: a label that promised nothing would
    // make a banner that comes back on the next visit read as a bug.
    expect(accountCopy.uk.banner.dismissSession).toMatch(/до наступного візиту/);
    expect(accountCopy.uk.banner.dismissSession).not.toBe(accountCopy.en.banner.dismissSession);
    // And it is a different promise from the plain "Hide" beside it.
    expect(accountCopy.uk.banner.dismissSession).not.toBe(accountCopy.uk.banner.dismiss);
  });
});
