import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResultsScreen } from './Report';
import { PLAN_POLL_INTERVAL_MS, type ActionPlanState } from './action-plan';
import type { Dashboard, IssueSummary, Scan } from './api';
import type { Language } from './i18n';

// The AI Action Plan on a report (D-232): every state the block can be in, the
// "Fix these first" block it replaces only when a plan is ready in the chosen
// language, the locked promise on Basic, and a report whose API answers
// something else entirely.

function scanOf(plan: Scan['plan']): Scan {
  return {
    id: 'scan-plan',
    profileId: 'profile-1',
    plan,
    domain: 'https://clinic.example',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-mvp-0.1',
    progress: { completedModules: 2, totalModules: 2 },
    startedAt: '2026-09-21T10:00:00.000Z',
    completedAt: '2026-09-21T11:00:00.000Z',
    createdAt: '2026-09-21T10:00:00.000Z',
    modules: [],
  } as Scan;
}

function dashboardOf(scan: Scan): Dashboard {
  return {
    scan,
    overall: {
      verdict: 'ok',
      score: 80,
      weightedCoverage: 1,
      moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: [],
    geoObservations: [],
  };
}

const SUMMARY: IssueSummary = {
  total: 4,
  open: 4,
  bySeverity: { Critical: 0, High: 1, Medium: 2, Low: 1 },
  groups: [
    { ruleId: 'SEC-PASSIVE-003', module: 'Security', severity: 'High', issues: 1, openIssues: 1 },
    { ruleId: 'SEO-TECH-004', module: 'SEO', severity: 'Medium', issues: 3, openIssues: 3 },
  ],
};

const CHANGES = {
  previous: null,
  egressLocation: null,
  egressComparison: null,
  introduced: 0,
  fixed: 0,
  persisting: 0,
  introducedByRule: [],
  fixedByRule: [],
};

const PLAN = {
  language: 'en',
  generatedAt: '2026-09-21T12:00:00.000Z',
  modelId: 'claude-opus-5',
  overview: 'The clinic site works, but search engines see mixed signals about its pages.',
  actions: [
    {
      title: 'Point every page at its own address',
      why: 'Search engines index the wrong address for three pages.',
      steps: ['Set the canonical link in the page template.'],
      effort: 'small',
      rules: [{ ruleId: 'SEO-TECH-004', openIssues: 2, totalIssues: 3 }],
      openIssues: 2,
      totalIssues: 3,
      settled: false,
    },
    {
      title: 'Turn on HSTS',
      why: 'Browsers should keep to HTTPS.',
      steps: ['Add the Strict-Transport-Security header.'],
      effort: 'small',
      rules: [{ ruleId: 'SEC-PASSIVE-003', openIssues: 0, totalIssues: 1 }],
      openIssues: 0,
      totalIssues: 1,
      settled: true,
    },
  ],
  reach: { addressed: 2, open: 4, rules: 2 },
  caveats: [{ module: 'Performance', status: 'Partial' }],
};

const RUN = { language: 'en', startedAt: '2026-09-21T12:00:00Z' };

function stateOf(overrides: Partial<ActionPlanState> = {}): ActionPlanState {
  return {
    language: 'en',
    availability: 'available',
    languages: [],
    run: null,
    lastFailure: null,
    remaining: { successes: 3, attempts: 6 },
    windowEndsAt: '2026-09-24T11:00:00.000Z',
    plan: null,
    ...overrides,
  } as ActionPlanState;
}

function envelope(data: unknown, status = 200, code: string | null = null): Response {
  const body =
    status < 400
      ? { success: true, data, error: null }
      : { success: false, data: null, error: { code, message: 'refused' } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface MockOptions {
  readonly plan?: Scan['plan'];
  /** The Action Plan state per requested language; a function may change over time. */
  readonly states?: (language: string) => ActionPlanState;
  /** The whole answer to a GET, for a failure or one that arrives late; wins over `states`. */
  readonly planResponse?: (language: string) => Response | Promise<Response>;
  readonly post?: () => Response | Promise<Response>;
}

function mockApi(options: MockOptions = {}) {
  const scan = scanOf(options.plan ?? 'Complete');
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/dashboard')) return Promise.resolve(envelope(dashboardOf(scan)));
    if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(envelope(SUMMARY));
    if (url.pathname.endsWith('/changes')) return Promise.resolve(envelope(CHANGES));
    if (url.pathname.endsWith('/action-plan') && init?.method === 'POST') {
      return Promise.resolve(options.post?.() ?? envelope({ scanId: scan.id }, 202));
    }
    if (url.pathname.endsWith('/action-plan')) {
      const language = url.searchParams.get('language') ?? '';
      if (options.planResponse !== undefined) {
        return Promise.resolve(options.planResponse(language));
      }
      return Promise.resolve(envelope((options.states ?? (() => stateOf()))(language)));
    }
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { scan, fetchMock };
}

interface RenderOptions {
  readonly language?: Language;
  readonly profileTargetLanguages?: string | null;
  readonly onOpenProblem?: (ruleId: string) => void;
  readonly onUpgrade?: (scan: Scan) => void;
  readonly onPrint?: (scan: Scan, planLanguage: string) => void;
}

async function openReport(scan: Scan, options: RenderOptions = {}): Promise<void> {
  render(
    <ResultsScreen
      scan={scan}
      language={options.language ?? 'en'}
      onScan={() => {}}
      onIssues={() => {}}
      onOpenProblem={options.onOpenProblem}
      onUpgrade={options.onUpgrade}
      onPrint={options.onPrint}
      profileTargetLanguages={options.profileTargetLanguages}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
  await screen.findByText(options.language === 'uk' ? 'Звіт аудиту сайту' : 'Site audit report');
}

function planBlock(): HTMLElement {
  return screen.getByRole('region', { name: 'Action Plan' });
}

function actionPlanRequests(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes('/action-plan'));
}

/** A response the test hands over when it chooses. */
function deferredResponse() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Moves the report's clock past one poll interval, letting the answers in. */
async function nextPoll(): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(PLAN_POLL_INTERVAL_MS));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the Action Plan on a Complete report', () => {
  it('offers to write a plan beside "Fix these first", with the consent line under the button', async () => {
    const { scan } = mockApi();
    await openReport(scan);

    const block = await screen.findByRole('region', { name: 'Action Plan' });
    expect(screen.getByRole('heading', { name: 'Fix these first' })).toBeInTheDocument();
    const button = within(block).getByRole('button', { name: 'Write the Action Plan' });
    expect(button).toHaveAccessibleDescription(
      'Rule names, counts and page addresses from this report are sent to Anthropic.',
    );
    expect(within(block).getByLabelText('Plan language')).toHaveValue('en');
  });

  it('lists the site profile’s own target languages first', async () => {
    const { scan } = mockApi();
    await openReport(scan, { profileTargetLanguages: 'German, Polish' });

    const picker = await within(
      await screen.findByRole('region', { name: 'Action Plan' }),
    ).findByLabelText('Plan language');
    const codes = within(picker)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(codes.slice(0, 3)).toEqual(['de', 'pl', 'en']);
    expect(codes).toContain('ja');
  });

  it('asks for the plan with the language and the notice the button showed', async () => {
    let requested = false;
    const { scan, fetchMock } = mockApi({
      states: () =>
        requested
          ? stateOf({ run: { language: 'en', startedAt: '2026-09-21T12:00:00Z' } })
          : stateOf(),
      post: () => {
        requested = true;
        return envelope({ scanId: 'scan-plan' }, 202);
      },
    });
    await openReport(scan);

    fireEvent.click(
      await within(await screen.findByRole('region', { name: 'Action Plan' })).findByRole(
        'button',
        { name: 'Write the Action Plan' },
      ),
    );

    expect(await screen.findByText(/Writing the plan in English/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      language: 'en',
      noticeVersion: 'action-plan-notice-v1',
    });
  });

  it('replaces "Fix these first" with a ready plan and links each rule to its issues', async () => {
    const onOpenProblem = vi.fn();
    const { scan } = mockApi({
      states: () => stateOf({ languages: ['en'], plan: PLAN as ActionPlanState['plan'] }),
    });
    await openReport(scan, { onOpenProblem });

    expect(await screen.findByText(PLAN.overview)).toBeInTheDocument();
    const block = planBlock();
    expect(screen.queryByRole('heading', { name: 'Fix these first' })).not.toBeInTheDocument();
    expect(within(block).getByText('AI-generated')).toBeInTheDocument();
    expect(within(block).getByRole('note')).toHaveTextContent(
      'Performance was only partly checked — the plan may be incomplete.',
    );
    expect(within(block).getByText('Under an hour · 2 open of 3')).toBeInTheDocument();
    expect(
      within(block).getByText(
        'The plan addresses 50% of this report’s open issues, across 2 rules.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(block).getByRole('button', {
        name: 'Canonical URL is missing or wrong: → 2 of 3 issues',
      }),
    );
    expect(onOpenProblem).toHaveBeenCalledWith('SEO-TECH-004');
    expect(within(block).getByRole('button', { name: 'Regenerate (3 left)' })).toBeInTheDocument();
  });

  it('folds a settled Action away and never calls it fixed', async () => {
    const { scan } = mockApi({
      states: () => stateOf({ languages: ['en'], plan: PLAN as ActionPlanState['plan'] }),
    });
    await openReport(scan);

    const title = await screen.findByText('Turn on HSTS');
    const details = title.closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(within(details as HTMLElement).getByText('Settled')).toBeInTheDocument();
    expect(planBlock()).not.toHaveTextContent(/fixed/i);
  });

  it('keeps "Fix these first" when the plan exists only in another language, and offers to open it', async () => {
    const { scan, fetchMock } = mockApi({
      states: (language) =>
        language === 'uk'
          ? stateOf({ language: 'uk', languages: ['uk'], plan: PLAN as ActionPlanState['plan'] })
          : stateOf({ languages: ['uk'] }),
    });
    await openReport(scan);

    expect(
      await screen.findByText('There is a plan for this report in Ukrainian.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fix these first' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open the plan in Ukrainian' }));

    expect(await screen.findByText(PLAN.overview)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fix these first' })).not.toBeInTheDocument();
    expect(actionPlanRequests(fetchMock).some((url) => url.includes('language=uk'))).toBe(true);
  });

  it('shows a run in flight, asks again once each answer is in, and stops at the plan', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let polls = 0;
    const { scan, fetchMock } = mockApi({
      states: () => {
        polls += 1;
        return polls < 3
          ? stateOf({ run: { language: 'de', startedAt: RUN.startedAt } })
          : stateOf({ languages: ['en'], plan: PLAN as ActionPlanState['plan'] });
      },
    });
    await openReport(scan);

    expect(await screen.findByText(/Writing the plan in German/)).toBeInTheDocument();
    await nextPoll();
    await waitFor(() => expect(actionPlanRequests(fetchMock)).toHaveLength(2));
    await nextPoll();

    expect(await screen.findByText(PLAN.overview)).toBeInTheDocument();
    await nextPoll();
    await nextPoll();
    expect(actionPlanRequests(fetchMock)).toHaveLength(3);
  });

  it('asks again while the scan is not ready, and offers the plan once it is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let ready = false;
    const { scan, fetchMock } = mockApi({
      states: () => stateOf({ availability: ready ? 'available' : 'not_ready' }),
    });
    await openReport(scan);
    await waitFor(() => expect(actionPlanRequests(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Action Plan' })).not.toBeInTheDocument();

    ready = true;
    await nextPoll();

    expect(
      await within(await screen.findByRole('region', { name: 'Action Plan' })).findByRole(
        'button',
        { name: 'Write the Action Plan' },
      ),
    ).toBeInTheDocument();
  });

  it('stops asking once a request fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let polls = 0;
    const { scan, fetchMock } = mockApi({
      planResponse: () => {
        polls += 1;
        return polls === 1 ? envelope(stateOf({ run: RUN })) : envelope(null, 403, 'FORBIDDEN');
      },
    });
    await openReport(scan);
    expect(await screen.findByText(/Writing the plan in English/)).toBeInTheDocument();

    await nextPoll();
    await waitFor(() => expect(errors).toHaveBeenCalled());
    await nextPoll();
    await nextPoll();

    expect(actionPlanRequests(fetchMock)).toHaveLength(2);
    expect(errors).toHaveBeenCalledWith('FluxRadar action plan unavailable', expect.any(Error));
  });

  it('keeps the picker, and its focus, through a language switch', async () => {
    const { scan, fetchMock } = mockApi({ states: (language) => stateOf({ language }) });
    await openReport(scan);
    const block = await screen.findByRole('region', { name: 'Action Plan' });
    const picker = await within(block).findByLabelText('Plan language');
    picker.focus();

    fireEvent.change(picker, { target: { value: 'uk' } });
    await waitFor(() =>
      expect(actionPlanRequests(fetchMock).some((url) => url.includes('language=uk'))).toBe(true),
    );

    expect(screen.getByRole('region', { name: 'Action Plan' })).toBe(block);
    expect(within(block).getByLabelText('Plan language')).toBe(picker);
    expect(picker).toHaveFocus();
    expect(picker).toHaveValue('uk');
  });

  it('asks about the language shown after a click, not the one clicked in', async () => {
    const post = deferredResponse();
    let started = false;
    const { scan, fetchMock } = mockApi({
      states: (language) => stateOf({ language, run: started ? RUN : null }),
      post: () => post.promise,
    });
    await openReport(scan);
    const block = await screen.findByRole('region', { name: 'Action Plan' });
    fireEvent.click(await within(block).findByRole('button', { name: 'Write the Action Plan' }));

    fireEvent.change(within(block).getByLabelText('Plan language'), { target: { value: 'uk' } });
    await waitFor(() =>
      expect(actionPlanRequests(fetchMock).some((url) => url.includes('language=uk'))).toBe(true),
    );
    started = true;
    post.resolve(envelope({ scanId: scan.id }, 202));

    expect(await within(block).findByText(/Writing the plan in English/)).toBeInTheDocument();
    const requests = actionPlanRequests(fetchMock).filter((url) => !url.endsWith('/action-plan'));
    expect(requests.at(-1)).toContain('language=uk');
  });

  it('says so when Claude declined to write the plan', async () => {
    const { scan } = mockApi({
      states: () =>
        stateOf({
          lastFailure: { code: 'refused', language: 'en', at: '2026-09-21T12:00:00Z' },
          remaining: { successes: 3, attempts: 5 },
        }),
    });
    await openReport(scan);

    const block = await screen.findByRole('region', { name: 'Action Plan' });
    expect(within(block).getByRole('note')).toHaveTextContent(
      'Claude declined to write a plan from this report, so none was made.',
    );
  });

  it('offers another try after a failed attempt', async () => {
    const { scan } = mockApi({
      states: () =>
        stateOf({
          lastFailure: { code: 'invalid_output', language: 'en', at: '2026-09-21T12:00:00Z' },
          remaining: { successes: 3, attempts: 5 },
        }),
    });
    await openReport(scan);

    const block = await screen.findByRole('region', { name: 'Action Plan' });
    expect(within(block).getByText('The last attempt did not produce a plan.')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Try again (3 left)' })).toBeInTheDocument();
  });

  it('says why AI is unavailable when the API refuses to start', async () => {
    const { scan } = mockApi({ post: () => envelope(null, 503, 'ACTION_PLAN_BUSY') });
    await openReport(scan);

    fireEvent.click(
      await within(await screen.findByRole('region', { name: 'Action Plan' })).findByRole(
        'button',
        { name: 'Write the Action Plan' },
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AI is temporarily unavailable. Try again later.',
    );
  });

  it.each([
    [
      'the Plan Window closed',
      stateOf({ availability: 'window_closed' }),
      'A plan could be written for this report until 24 September 2026.',
    ],
    ['nothing left to plan', stateOf({ availability: 'nothing_to_plan' }), /left open to plan/],
    [
      'the budget spent',
      stateOf({ availability: 'limit_reached', remaining: { successes: 0, attempts: 2 } }),
      /used all of its Action Plans/,
    ],
  ])('draws no button once %s', async (_case, state, message) => {
    const { scan } = mockApi({ states: () => state });
    await openReport(scan);

    const block = await screen.findByRole('region', { name: 'Action Plan' });
    expect(within(block).getByText(message)).toBeInTheDocument();
    expect(within(block).queryByRole('button')).not.toBeInTheDocument();
  });

  it('draws nothing while the scan is not ready', async () => {
    const { scan } = mockApi({ states: () => stateOf({ availability: 'not_ready' }) });
    await openReport(scan);
    await screen.findByRole('heading', { name: 'Fix these first' });

    expect(screen.queryByRole('region', { name: 'Action Plan' })).not.toBeInTheDocument();
  });

  it('draws nothing when the API answers with something that is not a plan state', async () => {
    const scan = scanOf('Complete');
    // What most workspace mocks do: every path answers with the dashboard.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(envelope(dashboardOf(scan)))),
    );
    await openReport(scan);

    expect(screen.queryByRole('region', { name: 'Action Plan' })).not.toBeInTheDocument();
    expect(screen.queryByText('Write the Action Plan')).not.toBeInTheDocument();
  });

  it('prints with the plan language the report shows', async () => {
    const onPrint = vi.fn();
    const { scan } = mockApi({ states: (language) => stateOf({ language }) });
    await openReport(scan, { onPrint });

    fireEvent.change(
      await within(await screen.findByRole('region', { name: 'Action Plan' })).findByLabelText(
        'Plan language',
      ),
      { target: { value: 'de' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Client report (PDF)' }));

    expect(onPrint).toHaveBeenCalledWith(scan, 'de');
  });
});

describe('the Action Plan on other plans', () => {
  it('promises the plan on a Basic report with open issues, without asking the API', async () => {
    const onUpgrade = vi.fn();
    const { scan, fetchMock } = mockApi({ plan: 'Basic' });
    await openReport(scan, { onUpgrade });

    const locked = await screen.findByRole('region', { name: 'AI Action Plan' });
    fireEvent.click(within(locked).getByRole('button', { name: 'Run Complete for this site' }));

    expect(onUpgrade).toHaveBeenCalledWith(scan);
    expect(actionPlanRequests(fetchMock)).toEqual([]);
  });

  it('names the plan among what a Free report leaves unread', async () => {
    const { scan, fetchMock } = mockApi({ plan: 'Free' });
    await openReport(scan);

    expect(
      await screen.findByText(
        'On Complete, an AI Action Plan: the findings as an ordered list of changes, with an overview for your client',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'AI Action Plan' })).not.toBeInTheDocument();
    await waitFor(() => expect(actionPlanRequests(fetchMock)).toEqual([]));
  });

  it('speaks Ukrainian on a Ukrainian report', async () => {
    const { scan } = mockApi({
      states: (language) =>
        stateOf({
          language,
          languages: [language],
          plan: { ...PLAN, language } as ActionPlanState['plan'],
        }),
    });
    await openReport(scan, { language: 'uk' });

    const block = await screen.findByRole('region', { name: 'План дій' });
    expect(within(block).getByText('Створено ШІ')).toBeInTheDocument();
    expect(within(block).getByText('Закрито')).toBeInTheDocument();
    expect(
      within(block).getByRole('button', { name: 'Скласти заново (лишилося 3)' }),
    ).toBeInTheDocument();
    expect(within(block).getByLabelText('Мова плану')).toHaveValue('uk');
    // Ukrainian for "fixed" is not a word the plan uses either.
    expect(block).not.toHaveTextContent(/виправ/i);
  });
});
