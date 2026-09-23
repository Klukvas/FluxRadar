// Every state of the AI Action Plan block.
//
// The response shape check matters as much as the states: the report's own test
// mocks answer any `/scans/...` path with a dashboard, and so can a deployment
// that has not shipped this endpoint. Drawing an idle button from one of those
// would offer to spend a generation the scan may not have.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActionPlan } from './ActionPlan';
import { ACTION_PLAN_NOTICE_VERSION } from './ai-processing-notice';
import type { ActionPlanState, Scan } from './api';

const SCAN: Scan = {
  id: 'scan-plan',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-09-22T00:00:00.000Z',
  completedAt: '2026-09-22T00:01:00.000Z',
  createdAt: '2026-09-22T00:00:00.000Z',
  modules: [],
};

function stateOf(overrides: Partial<ActionPlanState> = {}): ActionPlanState {
  return {
    scanId: SCAN.id,
    languages: [],
    running: null,
    lastFailure: null,
    remaining: { successes: 3, attempts: 6 },
    windowEndsAt: '2026-09-25T00:01:00.000Z',
    plan: null,
    ...overrides,
  };
}

const READY_PLAN: NonNullable<ActionPlanState['plan']> = {
  language: 'en',
  overview: 'Search engines cannot read your site’s basic instructions yet.',
  actions: [
    {
      title: 'Publish a robots.txt',
      why: 'Without it, crawlers guess what they may read.',
      steps: ['Create /robots.txt', 'Allow the public pages'],
      effort: 'small',
      ruleIds: ['SEO-TECH-001'],
      openIssues: 2,
      totalIssues: 3,
      settled: false,
    },
    {
      title: 'Fix the canonical tags',
      why: 'Duplicate addresses split the ranking signal.',
      steps: ['Point every duplicate at one address'],
      effort: 'medium',
      ruleIds: ['SEO-TECH-004'],
      openIssues: 0,
      totalIssues: 4,
      settled: true,
    },
  ],
  reach: { share: 0.75, addressedOpenIssues: 6, totalOpenIssues: 8, rules: 2 },
  caveats: ['Performance'],
  generatedAt: '2026-09-22T12:00:00.000Z',
  modelId: 'claude-opus-5',
  noticeVersion: 'core-ai-processing-notice-v4',
};

interface StubOptions {
  readonly state?: unknown;
  readonly onPost?: (body: unknown) => void;
}

function stubFetch(options: StubOptions): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      options.onPost?.(JSON.parse(String(init.body)));
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: {}, error: null }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    void input;
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: options.state ?? null, error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPlan(props: Partial<Parameters<typeof ActionPlan>[0]> = {}) {
  return render(
    <ActionPlan
      scan={SCAN}
      language="en"
      onOpenProblem={() => {}}
      onUpgrade={() => {}}
      hasOpenIssues
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Action Plan block', () => {
  it('offers to write one, with the language picker and the consent line', async () => {
    stubFetch({ state: stateOf() });
    renderPlan();

    expect(await screen.findByRole('button', { name: 'Write the Action Plan' })).toBeTruthy();
    expect(screen.getByLabelText('Plan language')).toBeTruthy();
    expect(
      screen.getByText(/sends this report’s rule names, severities, open counts/i),
    ).toBeTruthy();
    expect(screen.getByText(/never sends evidence excerpts/i)).toBeTruthy();
  });

  it('posts the chosen language and the notice on screen, and shows the run in flight', async () => {
    const posted: unknown[] = [];
    // Idle until the POST lands, exactly as the server behaves.
    let current = stateOf();
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posted.push(JSON.parse(String(init.body)));
          current = stateOf({ running: { language: 'en', startedAt: '2026-09-22T12:00:00.000Z' } });
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data: {}, error: null }), {
              status: 202,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: current, error: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    renderPlan();

    fireEvent.click(await screen.findByRole('button', { name: 'Write the Action Plan' }));

    // The click names the disclosure printed under the button, so the attempt
    // the server stores records what the owner was actually reading.
    await waitFor(() =>
      expect(posted).toEqual([{ language: 'en', noticeVersion: ACTION_PLAN_NOTICE_VERSION }]),
    );
    // While a run is in flight the button is gone: a second press would be a
    // second attempt against a scan that has six in total.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Claude is writing/i));
    expect(screen.queryByRole('button', { name: 'Write the Action Plan' })).toBeNull();
  });

  it('renders a ready plan with its live counts, Reach, caveats and AI label', async () => {
    stubFetch({ state: stateOf({ languages: ['en'], plan: READY_PLAN }) });
    renderPlan();

    expect(await screen.findByText(READY_PLAN.overview)).toBeTruthy();
    expect(screen.getByText('AI-generated')).toBeTruthy();
    expect(screen.getByText('2 open of 3')).toBeTruthy();
    expect(
      screen.getByText('Performance was only partly checked — the plan may be incomplete.'),
    ).toBeTruthy();
    expect(
      screen.getByText('This plan addresses 75% of the open findings, across 2 rules.'),
    ).toBeTruthy();
    expect(screen.getByText(/Written .* by claude-opus-5\./)).toBeTruthy();
    // A settled Action is not called fixed; inside one scan only triage moves it.
    expect(screen.getByText(/No open issue is left on this Action’s rules/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rewrite the plan (3 left)' })).toBeTruthy();
  });

  it('opens the Issue Center on the rule behind an Action', async () => {
    const opened: string[] = [];
    stubFetch({ state: stateOf({ languages: ['en'], plan: READY_PLAN }) });
    renderPlan({ onOpenProblem: (ruleId: string) => opened.push(ruleId) });

    fireEvent.click(
      await screen.findByRole('button', { name: 'robots.txt is missing or unreachable' }),
    );

    expect(opened).toEqual(['SEO-TECH-001']);
  });

  it('says the attempts are used up instead of offering another one', async () => {
    stubFetch({ state: stateOf({ remaining: { successes: 0, attempts: 0 } }) });
    renderPlan();

    expect(
      await screen.findByText('This scan has used all of its Action Plan attempts.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Write the Action Plan' })).toBeDisabled();
  });

  it('reports a failed attempt and still offers a retry while attempts remain', async () => {
    stubFetch({
      state: stateOf({ lastFailure: { code: 'ProviderContract', language: 'en' } }),
    });
    renderPlan();

    expect(await screen.findByText('The plan could not be written this time.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeDisabled();
  });

  it('says the window has closed instead of offering a generation the server refuses', async () => {
    // Past `windowEndsAt` the API answers 409 ACTION_PLAN_WINDOW_CLOSED to
    // every start, so the button would be a dead end with a paid look to it.
    stubFetch({ state: stateOf({ windowEndsAt: '2026-09-20T00:01:00.000Z' }) });
    renderPlan();

    expect(
      await screen.findByText(/The three-day window for asking for an Action Plan has closed/i),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write the Action Plan' })).toBeNull();
    expect(screen.queryByLabelText('Plan language')).toBeNull();
  });

  // Nothing polls an idle report, so without a timer the boundary would only be
  // noticed by an unrelated re-render — and the button would stay on screen for
  // a reader who left the report open across it.
  it('withdraws the offer when the window closes under an open report', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubFetch({
        state: stateOf({ windowEndsAt: new Date(Date.now() + 5_000).toISOString() }),
      });
      renderPlan();

      expect(await screen.findByRole('button', { name: 'Write the Action Plan' })).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });

      expect(screen.queryByRole('button', { name: 'Write the Action Plan' })).toBeNull();
      expect(screen.getByText(/window for asking for an Action Plan has closed/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a plan written before the window closed readable, without the rewrite offer', async () => {
    stubFetch({
      state: stateOf({
        languages: ['en'],
        plan: READY_PLAN,
        windowEndsAt: '2026-09-20T00:01:00.000Z',
      }),
    });
    renderPlan();

    expect(await screen.findByText(READY_PLAN.overview)).toBeTruthy();
    expect(screen.getByText(/window for asking for an Action Plan has closed/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rewrite the plan/ })).toBeNull();
  });

  it('says there is nothing to plan when the report has no open finding left', async () => {
    stubFetch({ state: stateOf() });
    renderPlan({ hasOpenIssues: false });

    expect(
      await screen.findByText(
        'No open finding on this report can go into a plan — findings in the Analytics section come from your own Google data and are never part of one.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write the Action Plan' })).toBeNull();
  });

  it('offers nothing while the report does not yet know what is open', async () => {
    // `hasOpenIssues` is null until the issue summary lands. Announcing
    // "nothing to plan" and then replacing it with a button is worse than
    // waiting a moment for the answer.
    stubFetch({ state: stateOf() });
    renderPlan({ hasOpenIssues: null });

    expect(await screen.findByRole('button', { name: 'Write the Action Plan' })).toBeTruthy();
    expect(screen.queryByText(/can go into a plan/i)).toBeNull();
  });

  it('renders nothing when the response is not the Action Plan state', async () => {
    // Exactly what a report test mock (or an older deployment) answers.
    stubFetch({ state: { scan: SCAN, overall: {}, modules: [], geoObservations: [] } });
    const { container } = renderPlan();

    await waitFor(() => expect(container.querySelector('.action-plan')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Write the Action Plan' })).toBeNull();
  });

  it('goes quiet on a stored plan whose Actions lost their shape', async () => {
    // A plan is a document kept for months. One written by an older release —
    // here with `steps` as a sentence instead of a list — must not take the
    // report down with it, and must not be half-drawn either.
    const legacyAction = {
      title: 'Publish a robots.txt',
      why: 'Without it, crawlers guess what they may read.',
      steps: 'Create /robots.txt, then allow the public pages',
      effort: 'small',
      ruleIds: ['SEO-TECH-001'],
      openIssues: 2,
      totalIssues: 3,
      settled: false,
    };
    stubFetch({ state: { ...stateOf(), plan: { ...READY_PLAN, actions: [legacyAction] } } });
    const { container } = renderPlan();

    await waitFor(() => expect(container.querySelector('.action-plan')).toBeNull());
    expect(screen.queryByText(READY_PLAN.overview)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Write the Action Plan' })).toBeNull();
  });

  it('locks a Basic report with open findings behind a Complete scan, and asks for no AI', async () => {
    const fetchMock = stubFetch({ state: stateOf() });
    renderPlan({ scan: { ...SCAN, plan: 'Basic' } });

    expect(
      await screen.findByText('An AI Action Plan is written from a Complete scan of this site.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run a Complete scan' })).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false);
  });

  it('shows nothing at all on a Free report', async () => {
    stubFetch({ state: stateOf() });
    const { container } = renderPlan({ scan: { ...SCAN, plan: 'Free' } });

    await waitFor(() => expect(container.querySelector('.report-block')).toBeNull());
  });
});
