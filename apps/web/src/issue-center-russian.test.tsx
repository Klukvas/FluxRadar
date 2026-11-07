// The Issue Center a Russian reader opens: Russian chrome, Ukrainian findings.
//
// The screen is built from two catalogues at once. Everything the app writes
// around the data — the lead, the view toggle, the column headers, the filters
// and every option in them, the reach of one problem — is interface and is
// Russian. Everything the report says — the problem's name, the evidence, the
// recommendation — is the report's own words and stays Ukrainian
// (`report-language.ts`).
//
// So the two halves are checked by what they may contain: no chrome element
// may hold a letter Russian does not have, and the problem's title must hold
// one, because otherwise the second half of the split is silently gone.
//
// The evidence sentence is the easiest half to lose: the API renders it into a
// map keyed `en | uk`, so reading it with the raw `ru` found nothing and the
// row showed a bare page address.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Issue, IssueSummary, Scan } from './api';
import { problemTitle } from './finding-explainers';
import { findingsCopy } from './findings-copy';
import { copy } from './i18n';
import { IssuesScreen } from './Issues';
import { moduleLabel } from './rule-titles';

/** The four letters Ukrainian has and Russian does not. */
const UKRAINIAN_ONLY = /[іїєґ]/i;

const SCAN = { id: 'scan-ru', domain: 'https://smile.example' } as Scan;
const PAGE_RULE = 'SEO-ONPAGE-002';
const SECURITY_RULE = 'SEC-PASSIVE-005';

/** What the API recorded for one finding: a sentence in the two report languages. */
const RECORDED_UKRAINIAN = 'Заголовок «Головна» повторюється на трьох сторінках.';
const RECORDED_ENGLISH = 'The title “Home” repeats on three pages.';

const SUMMARY: IssueSummary = {
  total: 12,
  open: 12,
  bySeverity: { Medium: 9, Low: 3 },
  groups: [
    { ruleId: PAGE_RULE, module: 'SEO', severity: 'Medium', issues: 9, openIssues: 9 },
    {
      ruleId: SECURITY_RULE,
      module: 'Security',
      severity: 'Low',
      issues: 3,
      openIssues: 3,
      // No message codes, so the row has nothing to build a line from and falls
      // back to the recorded sentence. That map has no `ru` key, by design.
      samples: [
        {
          targetUrl: 'https://smile.example/prices',
          messages: null,
          evidence: { en: RECORDED_ENGLISH, uk: RECORDED_UKRAINIAN },
        },
      ],
    },
  ],
};

function issue(index: number): Issue {
  return {
    id: `issue-${index}`,
    scanId: SCAN.id,
    ruleId: PAGE_RULE,
    module: 'SEO',
    fingerprint: `fp-${index}`,
    severity: 'Medium',
    category: 'on-page',
    status: 'New',
    targetUrl: `https://smile.example/page-${index}`,
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
  };
}

function json(data: unknown, meta?: Record<string, number>): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta ? { meta } : {}) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function stubIssues(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(SUMMARY));
      const page = [issue(1), issue(2), issue(3)];
      return Promise.resolve(json(page, { total: page.length, page: 1, limit: 50 }));
    }),
  );
}

/** The Russian screen, waiting until the problem list has arrived. */
async function openIssueCenter(): Promise<void> {
  stubIssues();
  render(<IssuesScreen scan={SCAN} language="ru" onError={() => {}} />);
  await screen.findAllByRole('row');
}

/** Every element whose text the app itself writes, with nothing of the report in it. */
function chromeElements(): readonly HTMLElement[] {
  return [
    ...screen.getAllByRole('columnheader'),
    ...Array.from(document.querySelectorAll<HTMLElement>('.field__label')),
    ...Array.from(document.querySelectorAll<HTMLElement>('.field__hint')),
    ...Array.from(document.querySelectorAll<HTMLElement>('option')),
    ...Array.from(document.querySelectorAll<HTMLElement>('.segmented__option')),
    ...Array.from(document.querySelectorAll<HTMLElement>('.issue-severity-legend')),
    ...Array.from(document.querySelectorAll<HTMLElement>('.issues-summary-line')),
    ...Array.from(document.querySelectorAll<HTMLElement>('.issues-head p.muted')),
    ...Array.from(document.querySelectorAll<HTMLElement>('.tabular-nums')),
  ];
}

function ukrainianChrome(): readonly string[] {
  return chromeElements()
    .map((element) => element.textContent ?? '')
    .filter((text) => UKRAINIAN_ONLY.test(text));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Issue Center a Russian reader opens', () => {
  it('writes its lead, its toggle and its problem table in Russian', async () => {
    await openIssueCenter();
    const f = findingsCopy.ru.issues;

    expect(screen.getByText(f.lead)).toBeTruthy();
    expect(screen.getByRole('button', { name: f.viewProblems })).toBeTruthy();
    expect(screen.getByRole('button', { name: f.viewAll })).toBeTruthy();
    expect(screen.getByText(f.summaryLine(12, 2))).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      copy.ru.issues.columnSeverity,
      f.columnProblem,
      f.columnPages,
      copy.ru.issues.columnAction,
    ]);
    // One problem's reach, which is a sentence about a number and a noun form.
    expect(screen.getByText(f.groupCount(9, 9, true))).toBeTruthy();
    // The section name beside the problem: chrome, not the rule's own words.
    expect(screen.getByText(moduleLabel('Security', 'ru'), { exact: false })).toBeTruthy();
    expect(ukrainianChrome()).toEqual([]);
  });

  it('writes the filters and every option in them in Russian', async () => {
    await openIssueCenter();
    const f = findingsCopy.ru.issues;

    fireEvent.click(screen.getByRole('button', { name: f.viewAll }));
    await screen.findByText(f.searchLabel);

    const labels = Array.from(document.querySelectorAll('.field__label')).map(
      (one) => one.textContent,
    );
    expect(labels).toEqual([f.searchLabel, f.severityFilter, f.moduleFilter, f.statusFilter]);
    const options = Array.from(document.querySelectorAll('option')).map((one) => one.textContent);
    expect(options).toContain(f.any);
    expect(options).toContain(findingsCopy.ru.severity.Critical);
    expect(options).toContain(findingsCopy.ru.status.New);
    expect(options).toContain(moduleLabel('SEO', 'ru'));
    expect(options).toContain(moduleLabel('Security', 'ru'));
    expect(ukrainianChrome()).toEqual([]);
  });

  it('counts the findings it shows in Russian', async () => {
    await openIssueCenter();
    const f = findingsCopy.ru.issues;

    fireEvent.click(screen.getByRole('button', { name: f.viewAll }));
    expect(await screen.findByText(f.showing(3, 3))).toBeTruthy();
    expect(ukrainianChrome()).toEqual([]);
  });

  it('falls back to the Ukrainian evidence sentence, never to nothing', async () => {
    await openIssueCenter();

    // The sentence the API recorded, shown as it was written: `ru` is not one
    // of the languages it exists in (`report-language.ts`).
    expect(screen.getByText(RECORDED_UKRAINIAN)).toBeTruthy();
    expect(screen.queryByText(RECORDED_ENGLISH)).toBeNull();
    // And it is in the row, beside the address, rather than replacing it.
    const item = screen.getByText(RECORDED_UKRAINIAN).closest('.problem-evidence__item');
    expect(item?.textContent ?? '').toContain('/prices');
  });

  // The legend builds «word: meaning» for every language: a dash carrying the
  // sentence is what the Russian copy rules refuse, and the example report's
  // severity line already reads with a colon.
  it('joins each severity word to its meaning with a colon', async () => {
    await openIssueCenter();

    const legend = document.querySelector('.issue-severity-legend');
    expect(legend).not.toBeNull();
    const text = legend?.textContent ?? '';
    expect(text).not.toContain(' — ');
    expect(text).not.toContain(' – ');
    expect(text).toContain(
      `${findingsCopy.ru.severity.Critical}: ${findingsCopy.ru.severityMeaning.Critical}`,
    );
  });

  it('keeps the problem’s own name in the report’s language', async () => {
    await openIssueCenter();

    // The same title the Ukrainian interface shows, letters and all: a title
    // that stopped being Ukrainian would pass every check above.
    const title = problemTitle(PAGE_RULE, 'ru');
    expect(title).toBe(problemTitle(PAGE_RULE, 'uk'));
    expect(title).toMatch(UKRAINIAN_ONLY);
    const row = screen.getByText(title).closest('tr');
    expect(row).not.toBeNull();
    // And the words beside it — the evidence and the plain-language
    // explanation — which the report writes too.
    expect((row?.textContent ?? '').replace(title, '')).toMatch(UKRAINIAN_ONLY);
  });
});
