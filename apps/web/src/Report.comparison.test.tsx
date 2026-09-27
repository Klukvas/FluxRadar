// The "compared with the previous scan" panel, in every state it can be in.
//
// The states are the point. A panel that renders nothing when the read fails
// looks exactly like a site where nothing changed, and this feature exists to
// stop the report from making claims it cannot support — so each of these tests
// checks that the reason is on screen, in the reader's language, rather than a
// number standing in for it.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, Scan, ScanChanges, ScanModule } from './api';
import type { ScanComparison } from './comparison-api';
import type { Language } from './i18n';
import { ResultsScreen } from './Report';

function scanOf(plan: Scan['plan'] = 'Complete'): Scan {
  return {
    id: 'scan-2',
    profileId: 'profile-1',
    plan,
    domain: 'https://shop.example',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-mvp-0.1',
    progress: { completedModules: 1, totalModules: 1 },
    startedAt: '2026-09-20T00:00:00.000Z',
    completedAt: '2026-09-20T00:01:00.000Z',
    createdAt: '2026-09-20T00:00:00.000Z',
    modules: [],
  } as unknown as Scan;
}

function moduleOf(overrides: Partial<ScanModule> = {}): ScanModule {
  return {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: 82.5,
    applicableChecks: 12,
    completedApplicableChecks: 12,
    usableOutput: true,
    metadata: {},
    ...overrides,
  };
}

function dashboardOf(plan: Scan['plan'] = 'Complete'): Dashboard {
  return {
    scan: scanOf(plan),
    overall: {
      verdict: 'ok',
      score: 74,
      weightedCoverage: 0.9,
      moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: [moduleOf()],
  };
}

function scope(): ScanComparison['current']['scope'] {
  return {
    entryUrl: 'https://shop.example',
    maxPages: 500,
    maxDepth: 5,
    includeSubdomains: false,
    queryPolicy: 'ignore',
    urlPatterns: [],
    excludePatterns: [],
    seedUrls: [],
    renderJs: false,
    respectRobots: true,
    userAgent: 'desktop',
    egressLocation: 'ua',
    scopeKey: 'scope-v3:same',
  };
}

function comparisonOf(overrides: Partial<ScanComparison> = {}): ScanComparison {
  return {
    current: {
      id: 'scan-2',
      plan: 'Complete',
      status: 'Completed',
      completedAt: '2026-09-20T00:01:00.000Z',
      pagesRead: 42,
      urlsDiscovered: 42,
      urlsOverLimit: 0,
      scope: scope(),
      readable: true,
    },
    previous: {
      id: 'scan-1',
      plan: 'Complete',
      status: 'Completed',
      completedAt: '2026-09-06T00:01:00.000Z',
      pagesRead: 40,
      urlsDiscovered: 40,
      urlsOverLimit: 0,
      scope: scope(),
      readable: true,
    },
    comparable: { ok: true },
    overall: { previousScore: 70, currentScore: 74.5, delta: 4.5 },
    modules: [
      {
        module: 'SEO',
        previousScore: 60,
        currentScore: 72.25,
        delta: 12.25,
        comparable: { ok: true },
      },
      {
        module: 'Analytics',
        previousScore: null,
        currentScore: 40,
        delta: null,
        comparable: { ok: false, reason: 'module-absent-previously' },
      },
    ],
    pages: {
      comparable: { ok: true },
      identity: 'canonical-document',
      added: 3,
      removed: 1,
      kept: 39,
      currentTotal: 42,
      previousTotal: 40,
      addedSample: ['https://shop.example/new-product'],
      removedSample: ['https://shop.example/retired'],
    },
    issues: {
      new: 2,
      resolved: 5,
      reopened: 1,
      stillOpen: 8,
      settled: 0,
      byModule: [{ module: 'SEO', new: 2, resolved: 5, reopened: 1, stillOpen: 8, settled: 0 }],
      bySeverity: [
        { severity: 'High', new: 2, resolved: 5, reopened: 1, stillOpen: 8, settled: 0 },
      ],
      newSample: [
        {
          fingerprint: 'fp-new',
          ruleId: 'SEO-ONPAGE-001',
          module: 'SEO',
          severity: 'High',
          normalizedUrl: 'https://shop.example/new-product',
        },
      ],
      resolvedSample: [
        {
          fingerprint: 'fp-old',
          ruleId: 'SEO-ONPAGE-002',
          module: 'SEO',
          severity: 'High',
          normalizedUrl: 'https://shop.example/retired',
        },
      ],
      firstChecked: { count: 0, byModule: [], bySeverity: [], ruleIds: [], sample: [] },
      noLongerChecked: [],
    },
    ...overrides,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Answers each path with its own payload, and every unknown path with the
 * dashboard — which is exactly what the workspace test mocks do, and what a
 * deployment without this endpoint effectively does too.
 */
/** What the older `GET /scans/:id/changes` block would have to draw. */
function scanChangesOf(): ScanChanges {
  return {
    previous: { id: 'scan-1', plan: 'Complete', completedAt: '2026-09-06T00:01:00.000Z' },
    egressComparison: 'same',
    introduced: 2,
    fixed: 5,
    persisting: 8,
    introducedByRule: [],
    fixedByRule: [],
  };
}

async function openReport(
  options: {
    readonly dashboard?: Dashboard;
    readonly comparison?: ScanComparison | 'generic';
    readonly language?: Language;
    readonly onOpenScan?: (scanId: string) => void;
  } = {},
): Promise<void> {
  const dashboard = options.dashboard ?? dashboardOf();
  const language = options.language ?? 'en';
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input.includes('/comparison') && options.comparison !== undefined) {
        return Promise.resolve(
          jsonResponse(options.comparison === 'generic' ? dashboard : options.comparison),
        );
      }
      // The older "since last scan" block only draws itself on a real payload,
      // so the mock has to offer one: a test that proves it is absent has to be
      // able to fail.
      if (input.includes('/changes')) return Promise.resolve(jsonResponse(scanChangesOf()));
      return Promise.resolve(jsonResponse(dashboard));
    }),
  );
  render(
    <ResultsScreen
      scan={dashboard.scan}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
      {...(options.onOpenScan === undefined ? {} : { onOpenScan: options.onOpenScan })}
    />,
  );
  await screen.findByText(language === 'uk' ? 'Звіт аудиту сайту' : 'Site audit report');
}

/**
 * The panel by its label, once it has arrived.
 *
 * Awaited, because the comparison is a second request: querying synchronously
 * after the dashboard renders is a race, and a panel that is merely late must not
 * read as a panel that is absent.
 */
async function panel(heading: string): Promise<HTMLElement> {
  const labels = await screen.findAllByText(heading);
  const label = labels.find((node) => node.className === 'panel__label');
  if (label === undefined) throw new Error(`no panel is labelled "${heading}"`);
  return label.closest('.panel') as HTMLElement;
}

/** The same lookup for the cases that assert there is no panel at all. */
function panelOrNull(heading: string): HTMLElement | null {
  const label = screen.queryAllByText(heading).find((node) => node.className === 'panel__label');
  return (label?.closest('.panel') as HTMLElement | null) ?? null;
}

/** One stat tile of the panel, by its label — never the table header of the same word. */
function stat(block: HTMLElement, label: string): HTMLElement {
  const tiles = [...block.querySelectorAll('.comparison-grid .changes-stat')];
  const tile = tiles.find((node) => node.textContent?.includes(label));
  if (tile === undefined) throw new Error(`no stat tile is labelled "${label}"`);
  return tile as HTMLElement;
}

const EN_HEADING = 'Compared with the previous scan';
const UK_HEADING = 'Порівняння з попередньою перевіркою';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the comparison panel', () => {
  it('says the comparison is unavailable when the answer is not one', async () => {
    // The generic payload every unknown path answers with. Rendering it as a
    // comparison would print deltas made of whatever fields happened to match.
    await openReport({ comparison: 'generic' });

    expect(
      await screen.findByText(/comparison with your previous scan could not be loaded/i),
    ).toBeInTheDocument();
    expect(await panel(EN_HEADING)).not.toBeNull();
  });

  it('tells the owner of a first report what the next one will show', async () => {
    await openReport({
      comparison: comparisonOf({
        previous: null,
        comparable: { ok: false, reason: 'no-previous-scan' },
        overall: { previousScore: null, currentScore: 74, delta: null },
        modules: [],
      }),
    });

    expect(await screen.findByText(/first Complete report for this site/i)).toBeInTheDocument();
    // No numbers at all: there is nothing to compare, and a zero would read as
    // "nothing changed".
    expect(screen.queryByText('Appeared')).not.toBeInTheDocument();
  });

  it('names the reason, and which settings moved, instead of showing deltas', async () => {
    await openReport({
      comparison: comparisonOf({
        comparable: { ok: false, reason: 'scope-changed' },
        overall: { previousScore: 70, currentScore: 74.5, delta: null },
        modules: [],
        previous: {
          ...comparisonOf().previous!,
          scope: { ...scope(), maxPages: 50, excludePatterns: ['/blog'] },
        },
      }),
    });

    const block = await panel(EN_HEADING);
    expect(within(block).getByText(/not asked for the same pages/i)).toBeInTheDocument();
    expect(within(block).getByText('Page limit: 50 → 500')).toBeInTheDocument();
    expect(within(block).getByText('Exclude patterns: /blog → none')).toBeInTheDocument();
    // The findings block is not rendered at all: no number may stand beside a
    // refusal to compare.
    expect(block.querySelector('.comparison-grid')).toBeNull();
  });

  it('shows score direction, page counts and finding counts when the two compare', async () => {
    await openReport({ comparison: comparisonOf() });

    const block = await panel(EN_HEADING);
    expect(
      within(block).getByText(/Against the Complete report of 6 September 2026/),
    ).toBeInTheDocument();
    expect(within(block).getByText('70.00 → 74.50')).toBeInTheDocument();
    expect(within(block).getByText('up 4.50')).toBeInTheDocument();
    expect(within(block).getByText('up 12.25')).toBeInTheDocument();
    // A module that ran for the first time carries its reason, never a delta.
    expect(within(block).getByText('ran for the first time in this scan')).toBeInTheDocument();
    expect(stat(block, 'Appeared').textContent).toContain('3');
    expect(stat(block, 'Resolved').textContent).toContain('5');
    expect(stat(block, 'Reopened').textContent).toContain('1');
    expect(within(block).getByText(/two addresses of one page count once/i)).toBeInTheDocument();
    expect(
      within(block).getByText(/counted among the ones that were not in the previous report/i),
    ).toBeInTheDocument();
  });

  it('keeps the address and finding samples behind a control', async () => {
    await openReport({ comparison: comparisonOf() });

    const block = await panel(EN_HEADING);
    expect(within(block).queryByText('https://shop.example/new-product')).not.toBeInTheDocument();
    fireEvent.click(within(block).getByRole('button', { name: 'Show addresses · Appeared' }));
    expect(within(block).getByText('https://shop.example/new-product')).toBeInTheDocument();
    expect(within(block).getByText('First 1 of 3, in alphabetical order.')).toBeInTheDocument();

    fireEvent.click(
      within(block).getByRole('button', {
        name: /Show findings · Resolved since the previous report/,
      }),
    );
    // The row names the check that found it and the page it was found on.
    const resolvedRow = within(block).getByText('https://shop.example/retired');
    expect(resolvedRow.closest('li')?.textContent).toContain('High');
  });

  it('says the pages are not compared, with the reason, while still comparing findings', async () => {
    await openReport({
      comparison: comparisonOf({
        pages: {
          comparable: { ok: false, reason: 'page-evidence-missing' },
          identity: null,
          added: 0,
          removed: 0,
          kept: 0,
          currentTotal: 0,
          previousTotal: 0,
          addedSample: [],
          removedSample: [],
        },
      }),
    });

    const block = await panel(EN_HEADING);
    expect(within(block).getByText(/no longer stored/i)).toBeInTheDocument();
    expect(within(block).queryByText('Appeared')).not.toBeInTheDocument();
    // The findings half is unaffected: those rows are durable.
    expect(stat(block, 'Resolved').textContent).toContain('5');
  });

  it('opens the previous report through the app rather than a page load', async () => {
    const opened: string[] = [];
    await openReport({ comparison: comparisonOf(), onOpenScan: (id) => opened.push(id) });

    fireEvent.click(await screen.findByRole('button', { name: 'Open the previous report' }));

    expect(opened).toEqual(['scan-1']);
  });

  it('renders the whole panel in Ukrainian', async () => {
    await openReport({ comparison: comparisonOf(), language: 'uk', onOpenScan: () => {} });

    const block = await panel(UK_HEADING);
    expect(within(block).getByText(/Проти звіту Complete від 6 вересня 2026/)).toBeInTheDocument();
    expect(within(block).getByText('вище на 4.50')).toBeInTheDocument();
    expect(stat(block, 'З’явилися').textContent).toContain('3');
    expect(stat(block, 'Виправлені').textContent).toContain('5');
    expect(
      within(block).getByRole('button', { name: 'Відкрити попередній звіт' }),
    ).toBeInTheDocument();
  });

  it('says the reason in Ukrainian too', async () => {
    await openReport({
      language: 'uk',
      comparison: comparisonOf({
        comparable: { ok: false, reason: 'current-crawl-truncated' },
        modules: [],
      }),
    });

    expect(await screen.findByText(/зупинилася на своєму лім/i)).toBeInTheDocument();
  });

  it.each(['Free', 'Basic'] as const)(
    'offers nothing new on %s, which buys no history',
    async (plan) => {
      await openReport({ dashboard: dashboardOf(plan), comparison: comparisonOf() });

      expect(panelOrNull(EN_HEADING)).toBeNull();
      expect(screen.queryByText(EN_HEADING)).not.toBeInTheDocument();
    },
  );

  it('names a blank setting the way that setting reads, never as "whole plan"', async () => {
    // Both of these were rendered as "whole plan": a crawl location nobody chose
    // read as "Crawl location: whole plan → ua", and a click depth nobody set
    // read as "Click depth: whole plan".
    await openReport({
      comparison: comparisonOf({
        comparable: { ok: false, reason: 'scope-changed' },
        modules: [],
        previous: {
          ...comparisonOf().previous!,
          scope: { ...scope(), egressLocation: null, maxDepth: null },
        },
      }),
    });

    const block = await panel(EN_HEADING);
    expect(
      within(block).getByText('Crawl location: the default location → ua'),
    ).toBeInTheDocument();
    expect(within(block).getByText('Click depth: no limit → 5')).toBeInTheDocument();
    expect(within(block).queryByText(/whole plan/)).not.toBeInTheDocument();
  });

  it('treats a reason it has no sentence for as no comparison at all', async () => {
    // The panel indexes its copy by the reason, so an unrecognised one used to
    // render an empty paragraph where the explanation belongs.
    await openReport({
      comparison: comparisonOf({
        comparable: { ok: false, reason: 'because-i-said-so' } as never,
        modules: [],
      }),
    });

    expect(
      await screen.findByText(/comparison with your previous scan could not be loaded/i),
    ).toBeInTheDocument();
  });

  it('holds first-checked findings apart from the new ones, and names the checks', async () => {
    await openReport({
      comparison: comparisonOf({
        issues: {
          ...comparisonOf().issues,
          new: 1,
          firstChecked: {
            count: 10,
            byModule: [{ module: 'SEO', count: 10 }],
            bySeverity: [{ severity: 'High', count: 10 }],
            ruleIds: ['SEO-TECH-010'],
            sample: [
              {
                fingerprint: 'fp-first',
                ruleId: 'SEO-TECH-010',
                module: 'SEO',
                severity: 'High',
                normalizedUrl: 'https://shop.example/deep',
              },
            ],
          },
          noLongerChecked: ['SEO-TECH-013'],
        },
      }),
    });

    const block = await panel(EN_HEADING);
    expect(stat(block, 'New').textContent).toContain('1');
    expect(within(block).getByText(/not problems you introduced/i)).toBeInTheDocument();
    expect(within(block).getByText(/Some checks did not run in this scan/i)).toBeInTheDocument();
    expect(
      within(block).getByRole('button', { name: /Show findings · Checked for the first time/ }),
    ).toBeInTheDocument();
  });

  it('counts a finding the owner settled apart from the ones still open', async () => {
    await openReport({
      comparison: comparisonOf({
        issues: { ...comparisonOf().issues, stillOpen: 6, settled: 2 },
      }),
    });

    const block = await panel(EN_HEADING);
    expect(stat(block, 'Still open').textContent).toContain('6');
    expect(stat(block, 'Settled by you').textContent).toContain('2');
    expect(within(block).getByText(/ignored or a false positive/i)).toBeInTheDocument();
  });

  it('names a previous report the account may no longer open, without offering it', async () => {
    const opened: string[] = [];
    await openReport({
      comparison: comparisonOf({
        previous: { ...comparisonOf().previous!, readable: false },
      }),
      onOpenScan: (id) => opened.push(id),
    });

    const block = await panel(EN_HEADING);
    // Still named — the numbers are drawn against it — and not linked.
    expect(within(block).getByText(/Against the Complete report of/)).toBeInTheDocument();
    expect(
      within(block).queryByRole('button', { name: 'Open the previous report' }),
    ).not.toBeInTheDocument();
    expect(opened).toEqual([]);
  });

  it('leaves exactly one "since last scan" block on a report that has the panel', async () => {
    // Two blocks answering the same question with two different numbers: the
    // panel counts a finding resolved only where the §14 proof says the run
    // re-checked it, while the older block calls every absence a fix. Whichever
    // number the reader believes, the report contradicts itself.
    await openReport({ comparison: comparisonOf() });

    await panel(EN_HEADING);
    expect(screen.queryByText('Since your last scan')).not.toBeInTheDocument();
    expect(
      (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((call) => String(call[0]))
        .some((path) => path.includes('/changes')),
    ).toBe(false);
  });

  it('keeps the older block on Basic, which has no panel to replace it', async () => {
    await openReport({ dashboard: dashboardOf('Basic') });

    expect(await screen.findByText('Since your last scan')).toBeInTheDocument();
    expect(panelOrNull(EN_HEADING)).toBeNull();
  });

  it('asks for the comparison only on a plan that includes it', async () => {
    await openReport({ dashboard: dashboardOf('Basic'), comparison: comparisonOf() });

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const paths = calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.includes('/comparison'))).toBe(false);
  });
});
