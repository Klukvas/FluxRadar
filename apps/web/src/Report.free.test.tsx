import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResultsScreen } from './Report';
import type { Scan, ScanModule } from './api';

// ─── A report whose plan has no score ────────────────────────────────────────
//
// Free carries no tariff score weights, so the scoring engine answers
// `insufficient_data` with a weighted coverage of 0 — the same verdict a paid
// scan gets when it could not read the site. The report used to print both
// verbatim, next to an SEO section that had completed and a metadata line
// naming structured-data checks the Free run never performs.
//
// These cover the difference the screen now has to keep: a plan that is not
// scored says so, a scan that genuinely read nothing still says that, and a
// paid scan's insufficient-data verdict is left exactly as it was.
// ─────────────────────────────────────────────────────────────────────────────

const FREE_CHECK_TITLES = ['title', 'H1-H6 structure', 'meta description', 'index/noindex'];

function scanOf(plan: Scan['plan']): Scan {
  return {
    id: 'scan-1',
    profileId: 'profile-1',
    plan,
    domain: 'https://jobber-app.com',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 1, totalModules: 1 },
    startedAt: '2026-09-06T00:00:00.000Z',
    completedAt: '2026-09-06T00:01:00.000Z',
    createdAt: '2026-09-06T00:00:00.000Z',
    modules: [],
  } as unknown as Scan;
}

function freeSeoModule(overrides: Partial<ScanModule> = {}): ScanModule {
  return {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: null,
    applicableChecks: 4,
    completedApplicableChecks: 4,
    usableOutput: true,
    metadata: {
      freeCheck: true,
      scope: 'homepage only',
      scoring: 'NotScoredOnFreePlan',
      checks: FREE_CHECK_TITLES.map((title, index) => ({ ruleId: `RULE-${index}`, title })),
    },
    ...overrides,
  };
}

function renderDashboard(dashboard: unknown, scan: Scan) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: dashboard, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  render(
    <ResultsScreen
      scan={scan}
      language="en"
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a report on a plan that is not scored', () => {
  it('says the plan is not scored instead of claiming insufficient data', async () => {
    const scan = scanOf('Free');
    renderDashboard(
      {
        scan,
        overall: {
          verdict: 'insufficient_data',
          score: null,
          weightedCoverage: 0,
          moduleWeights: [],
        },
        modules: [freeSeoModule()],
      },
      scan,
    );

    // Twice: the overall dial, and the SEO card whose own score slot used to
    // read a bare "No score" beside a Completed chip and a full coverage bar.
    expect((await screen.findAllByText('Not scored on this plan')).length).toBe(2);
    expect(screen.queryByText('No score')).toBeNull();
    // The two sentences the owner read as a failed scan.
    expect(screen.queryByText('Insufficient data')).toBeNull();
    expect(screen.queryByText(/coverage 0%/)).toBeNull();
    // What actually ran, counted rather than expressed as a 0% share of a score
    // this plan never computes. Two elements carry it — the dial and the
    // breadcrumb — so the two cannot drift into disagreeing about the run. The
    // matcher is a pattern because the breadcrumb surrounds the line with the
    // scan id and the ruleset version.
    expect(screen.getAllByText(/4\/4 checks completed/).length).toBe(2);
  });

  it('leaves the section unscored rather than inventing a number for it', async () => {
    const scan = scanOf('Free');
    renderDashboard(
      {
        scan,
        overall: {
          verdict: 'insufficient_data',
          score: null,
          weightedCoverage: 0,
          moduleWeights: [],
        },
        modules: [freeSeoModule()],
      },
      scan,
    );

    await screen.findAllByText('Not scored on this plan');
    // A completed check with no score must not acquire one — not a zero, and
    // not the 100 a run without findings could be mistaken for.
    expect(screen.queryByText('0.00')).toBeNull();
    expect(screen.queryByText('100.00')).toBeNull();
    // The coverage bar still reports the checks that actually ran.
    expect(screen.getByRole('meter', { name: 'SEO coverage' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  it('does not blame the plan for a section that produced nothing to score', async () => {
    const scan = scanOf('Free');
    renderDashboard(
      {
        scan,
        overall: {
          verdict: 'insufficient_data',
          score: null,
          weightedCoverage: 0,
          moduleWeights: [],
        },
        // The Free row always carries the plan's scoring reason, but an
        // unreadable section would carry no score on Basic or Complete either.
        // Naming the plan there would explain the wrong thing; its own status
        // is the specific truth, and the card already shows it.
        modules: [
          freeSeoModule({
            status: 'Unavailable',
            statusReason: 'TargetsUnreachable',
            coverage: 0,
            completedApplicableChecks: 0,
            usableOutput: false,
          }),
        ],
      },
      scan,
    );

    expect(await screen.findByText('No score')).toBeTruthy();
    // Once only: the dial, not the card.
    expect(screen.getAllByText('Not scored on this plan').length).toBe(1);
  });

  it('names the checks the free run performed, not the paid module ones', async () => {
    const scan = scanOf('Free');
    renderDashboard(
      {
        scan,
        overall: {
          verdict: 'insufficient_data',
          score: null,
          weightedCoverage: 0,
          moduleWeights: [],
        },
        modules: [freeSeoModule()],
      },
      scan,
    );

    expect(await screen.findByText(FREE_CHECK_TITLES.join(' · '))).toBeTruthy();
    expect(screen.queryByText('JSON-LD · Open Graph · Twitter Cards')).toBeNull();
  });

  it('counts both halves of the checks line over the modules that produced results', async () => {
    const scan = scanOf('Free');
    renderDashboard(
      {
        scan,
        overall: {
          verdict: 'insufficient_data',
          score: null,
          weightedCoverage: 0,
          moduleWeights: [],
        },
        modules: [
          freeSeoModule(),
          // A module that returned nothing carries applicable checks of its own.
          // They belong to a result the report is not showing, so they cannot
          // sit in the denominator of the checks that did complete.
          {
            module: 'AI SEO / GEO',
            status: 'Unavailable',
            statusReason: 'TargetsUnreachable',
            coverage: null,
            score: null,
            applicableChecks: 6,
            completedApplicableChecks: 0,
            usableOutput: false,
            metadata: {},
          },
        ],
      },
      scan,
    );

    expect((await screen.findAllByText('4/4 checks completed')).length).toBeGreaterThan(0);
    expect(screen.queryByText('4/10 checks completed')).toBeNull();
  });

  it('keeps saying so when the homepage itself could not be read', async () => {
    const scan = scanOf('Free');
    renderDashboard(
      {
        scan,
        overall: {
          verdict: 'insufficient_data',
          score: null,
          weightedCoverage: 0,
          moduleWeights: [],
        },
        modules: [
          freeSeoModule({
            status: 'Unavailable',
            statusReason: 'TargetsUnreachable',
            coverage: 0,
            completedApplicableChecks: 0,
            usableOutput: false,
          }),
        ],
      },
      scan,
    );

    expect(await screen.findByText('Not scored on this plan')).toBeTruthy();
    // A completed-checks count would be the invented part here; there is none.
    // The dial and the breadcrumb say the same thing, from the same line.
    expect(screen.getAllByText(/homepage could not be read/).length).toBe(2);
    expect(screen.queryByText(/checks completed/)).toBeNull();
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });
});

describe('a paid report that genuinely could not be measured', () => {
  it('still reports insufficient data and its real coverage', async () => {
    const scan = scanOf('Basic');
    renderDashboard(
      {
        scan,
        overall: {
          verdict: 'insufficient_data',
          score: null,
          weightedCoverage: 0.2,
          moduleWeights: [
            { module: 'SEO', tariffWeight: 0.6, effectiveWeight: 0.12 },
            { module: 'AI SEO / GEO', tariffWeight: 0.4, effectiveWeight: 0 },
          ],
        },
        modules: [
          {
            module: 'SEO',
            status: 'Partial',
            statusReason: 'TargetsPartiallyUnreachable',
            coverage: 0.2,
            score: null,
            applicableChecks: 10,
            completedApplicableChecks: 2,
            usableOutput: false,
            metadata: {},
          },
        ],
      },
      scan,
    );

    expect((await screen.findAllByText('Insufficient data')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/coverage 20%/).length).toBe(2); // the dial and the breadcrumb
    expect(screen.queryByText('Not scored on this plan')).toBeNull();
    // A paid section with no readable result reports the absence and no reason
    // for it; the plan is not what deprived this one of a number.
    expect(screen.getByText('No score')).toBeTruthy();
  });
});
