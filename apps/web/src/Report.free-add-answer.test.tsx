import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_PROCESSING_NOTICE_VERSION } from './ai-processing-notice';
import type { GeoObservation, Scan, ScanModule } from './api';
import { ADD_ANSWER_MAX_POLLS, ADD_ANSWER_POLL_MS } from './FreeAiPreview';
import { freePreviewCopy } from './free-preview-copy';
import { copy, type Language } from './i18n';
import { ResultsScreen } from './Report';

// ─── "Add the AI answer" on a finished Free report (D-236) ──────────────────
//
// A Free check launched with its AI box unticked stores the GEO row as
// Not applicable / ConsentMissing. Its report offers the launch form's own
// disclosure beside a button; the click is the consent. The block then runs
// and shows the answer through the usual Free rendering, or the honest
// unavailable state.
// ─────────────────────────────────────────────────────────────────────────────

const REAL_ANSWER = 'Smile Clinic is a dental practice I know little else about.';
const PATH = '/scans/scan-free/free-ai-preview';

const SCAN = {
  id: 'scan-free',
  profileId: 'profile-1',
  plan: 'Free',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  reportReady: true,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 2, totalModules: 2 },
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
  score: 35,
  scoreMax: 40,
  applicableChecks: 4,
  completedApplicableChecks: 4,
  usableOutput: true,
  metadata: { freeCheck: true, scope: 'homepage only', scoreScope: 'homepage' },
};

function geo(overrides: Partial<ScanModule>): ScanModule {
  return {
    module: 'AI SEO / GEO',
    status: 'Not applicable',
    statusReason: 'ConsentMissing',
    coverage: 0,
    score: null,
    applicableChecks: 0,
    completedApplicableChecks: 0,
    usableOutput: false,
    metadata: { freePreview: true },
    ...overrides,
  };
}

const LEFT_OUT = geo({});
const QUEUED = geo({ status: 'Pending', statusReason: null, metadata: { latePreview: true } });
const ANSWERED_ROW = geo({
  status: 'Completed',
  statusReason: null,
  coverage: 1,
  usableOutput: true,
  metadata: { scoring: 'InformationalOnly', freePreview: true },
});
const UNAVAILABLE = geo({ status: 'Unavailable', statusReason: 'SiteUnreachable' });
/** What a late run that failed after its AI step began leaves behind. */
const FAILED_AFTER_START = geo({
  status: 'Unavailable',
  statusReason: 'PlatformFailure',
  metadata: { freePreview: true, latePreview: true, previewRequested: true },
});
/** A late attempt that never started, handed back with the reason it stopped. */
function released(reason: string, at: string, final = false, remaining?: number): ScanModule {
  return geo({
    metadata: {
      freePreview: true,
      lateAttempt: {
        started: false,
        reason,
        at,
        final,
        ...(remaining === undefined ? {} : { remaining }),
      },
    },
  });
}

const ANSWER: GeoObservation = {
  purpose: 'closed-book',
  question: 'What do you know about Smile Clinic?',
  status: 'answered',
  reason: null,
  provider: 'anthropic',
  modelId: 'claude-sonnet-5',
  answer: REAL_ANSWER,
  citations: [],
  mentions: null,
  evaluation: null,
} as GeoObservation;

function dashboard(row: ScanModule, observations: readonly GeoObservation[] = []) {
  return {
    scan: SCAN,
    overall: {
      verdict: 'normal',
      score: 35,
      scoreMax: 40,
      weightedCoverage: 1,
      moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: [SEO, row],
    geoObservations: observations,
    geoEvidence: null,
    geoVisibilitySummary: null,
  };
}

function envelope(data: unknown, status = 200): Response {
  const body =
    status < 400
      ? { success: true, data, error: null }
      : { success: false, data: null, error: data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The API as this block sees it: each dashboard read returns the next step of
 * `reads` (the last one repeats), and the add request answers `addAnswer`.
 */
function serve(
  reads: readonly unknown[],
  addAnswer: () => Response | Promise<Response> = () => envelope({}, 202),
) {
  let served = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === PATH && init?.method === 'POST') return Promise.resolve().then(addAnswer);
    const read = reads[Math.min(served, reads.length - 1)];
    if (path.endsWith('/dashboard')) served += 1;
    return Promise.resolve(envelope(read));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderReport(language: Language = 'en') {
  render(
    <ResultsScreen
      scan={SCAN}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
}

async function aiBlock(language: Language = 'en') {
  return screen.findByRole('region', { name: freePreviewCopy[language].preview.heading });
}

function dashboardReads(fetchMock: ReturnType<typeof serve>): number {
  return fetchMock.mock.calls.filter(([input]) =>
    new URL(String(input)).pathname.endsWith('/dashboard'),
  ).length;
}

function addCalls(fetchMock: ReturnType<typeof serve>) {
  return fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === PATH);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a Free report whose AI answer was left out at launch', () => {
  it('shows the launch disclosure open beside the button', async () => {
    serve([dashboard(LEFT_OUT)]);
    renderReport();
    const block = await aiBlock();
    const c = freePreviewCopy.en;
    const button = within(block).getByRole('button', { name: c.addAnswer.button });
    expect(within(block).getByText(c.preview.notRunConsent)).toBeVisible();
    expect(within(block).getByText(c.addAnswer.lead)).toBeVisible();
    // The click is the consent: the disclosure is plain, visible text, and the
    // button points at it.
    expect(button).toHaveAccessibleDescription(expect.stringContaining(c.consent.body));
    expect(within(block).getByText(/No other AI provider receives anything/)).toBeVisible();
    expect(block.querySelector('details')).toBeNull();
    expect(within(block).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(within(block).getByRole('link', { name: 'Terms of service' })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  it.each([
    ['uk', 'Додати відповідь ШІ'],
    ['ru', 'Добавить ответ ИИ'],
  ] as const)('names the button in %s', async (language, label) => {
    serve([dashboard(LEFT_OUT)]);
    renderReport(language);
    const block = await aiBlock(language);
    expect(within(block).getByRole('button', { name: label })).toBeVisible();
    expect(within(block).getByText(freePreviewCopy[language].addAnswer.lead)).toBeVisible();
  });

  it.each([
    ['an allowlisted origin', geo({ statusReason: 'FreePreviewAllowlistedOrigin' })],
    ['an earlier request', geo({ statusReason: 'FreePreviewAlreadyRequested' })],
    ['an unavailable answer', UNAVAILABLE],
  ])('offers no button for %s', async (_name, row) => {
    serve([dashboard(row)]);
    renderReport();
    const block = await aiBlock();
    expect(within(block).queryByRole('button')).toBeNull();
    expect(within(block).queryByText(freePreviewCopy.en.addAnswer.lead)).toBeNull();
  });

  it('says what will make it work when robots.txt kept the homepage closed', async () => {
    serve([dashboard(released('SiteBlockedByRobots', '2026-11-17T09:00:00.000Z'))]);
    renderReport();
    const block = await aiBlock();
    const c = freePreviewCopy.en.addAnswer;
    expect(within(block).getByText(c.lastAttemptRobots)).toBeVisible();
    expect(within(block).queryByText(c.lastAttemptSiteUnread)).toBeNull();
    expect(within(block).getByRole('button', { name: c.button })).toBeEnabled();
  });

  it.each(['en', 'uk', 'ru'] as const)(
    'says one attempt is left when the next press is the last (%s)',
    async (language) => {
      serve([dashboard(released('SiteUnreachable', '2026-11-17T09:00:00.000Z', false, 1))]);
      renderReport(language);
      const block = await aiBlock(language);
      const c = freePreviewCopy[language].addAnswer;
      expect(
        within(block).getByText(`${c.lastAttemptSiteUnread} ${c.oneAttemptLeft}`),
      ).toBeVisible();
      expect(within(block).getByRole('button', { name: c.button })).toBeEnabled();
    },
  );

  it.each(['en', 'uk', 'ru'] as const)(
    'with one attempt left and robots.txt closed, says to fix robots.txt first (%s)',
    async (language) => {
      serve([dashboard(released('SiteBlockedByRobots', '2026-11-17T09:00:00.000Z', false, 1))]);
      renderReport(language);
      const block = await aiBlock(language);
      const c = freePreviewCopy[language].addAnswer;
      expect(
        within(block).getByText(`${c.lastAttemptRobots} ${c.oneAttemptLeftRobots}`),
      ).toBeVisible();
    },
  );

  it('says nothing about a limit while more than one attempt is left', async () => {
    serve([dashboard(released('SiteUnreachable', '2026-11-17T09:00:00.000Z', false, 2))]);
    renderReport();
    const block = await aiBlock();
    const c = freePreviewCopy.en.addAnswer;
    expect(within(block).getByText(c.lastAttemptSiteUnread)).toBeVisible();
    expect(block).not.toHaveTextContent(c.oneAttemptLeft);
  });

  it.each(['en', 'uk', 'ru'] as const)(
    'after the last allowed attempt, says so for good and offers no button (%s)',
    async (language) => {
      serve([dashboard(released('SiteUnreachable', '2026-11-17T09:00:00.000Z', true))]);
      renderReport(language);
      const block = await aiBlock(language);
      const c = freePreviewCopy[language].addAnswer;
      expect(within(block).getByRole('note')).toHaveTextContent(c.attemptsExhausted);
      expect(within(block).queryByRole('button')).toBeNull();
      expect(within(block).queryByText(c.lead)).toBeNull();
    },
  );

  it('offers no button once the answer is there', async () => {
    serve([dashboard(ANSWERED_ROW, [ANSWER])]);
    renderReport();
    const block = await aiBlock();
    expect(within(block).getByText(REAL_ANSWER)).toBeVisible();
    expect(within(block).queryByRole('button', { name: /Add the AI answer/ })).toBeNull();
  });
});

describe('pressing "Add the AI answer"', () => {
  it('posts the Free consent, shows the running state, then the answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = serve([
      dashboard(LEFT_OUT),
      dashboard(QUEUED),
      dashboard(geo({ status: 'Running', statusReason: null, metadata: { latePreview: true } })),
      dashboard(ANSWERED_ROW, [ANSWER]),
    ]);
    renderReport();
    const block = await aiBlock();
    fireEvent.click(within(block).getByRole('button', { name: 'Add the AI answer' }));

    await waitFor(() => expect(addCalls(fetchMock)).toHaveLength(1));
    const [, init] = addCalls(fetchMock)[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      aiConsent: { providers: ['anthropic'], noticeVersion: AI_PROCESSING_NOTICE_VERSION },
    });
    const running = await within(block).findByRole('status');
    expect(running).toHaveTextContent(freePreviewCopy.en.addAnswer.running);
    expect(within(block).queryByRole('button')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS));
    expect(await within(await aiBlock()).findByText(REAL_ANSWER)).toBeVisible();
    expect(screen.queryByText(freePreviewCopy.en.addAnswer.running)).toBeNull();
    // Settled: the report stops asking.
    const reads = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS * 3));
    expect(fetchMock.mock.calls.length).toBe(reads);
    expect(addCalls(fetchMock)).toHaveLength(1);
  });

  it('shows the honest unavailable state when the run produced no answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve([dashboard(LEFT_OUT), dashboard(QUEUED), dashboard(FAILED_AFTER_START)]);
    renderReport();
    fireEvent.click(within(await aiBlock()).getByRole('button', { name: 'Add the AI answer' }));
    expect(await screen.findByText(freePreviewCopy.en.addAnswer.running)).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS));
    const block = await aiBlock();
    expect(await within(block).findByRole('note')).toHaveTextContent(
      freePreviewCopy.en.preview.notRunOther,
    );
    expect(within(block).queryByRole('button')).toBeNull();
  });

  it('a permanent refusal drops the button and re-reads the report', async () => {
    const fetchMock = serve([dashboard(LEFT_OUT)], () =>
      envelope({ code: 'FREE_AI_PREVIEW_ALREADY_ADDED', message: 'already' }, 409),
    );
    renderReport();
    const block = await aiBlock();
    const readsBefore = dashboardReads(fetchMock);
    fireEvent.click(within(block).getByRole('button', { name: 'Add the AI answer' }));
    expect(await within(block).findByRole('alert')).toHaveTextContent(
      freePreviewCopy.en.addAnswer.refused,
    );
    expect(within(block).queryByRole('button', { name: 'Add the AI answer' })).toBeNull();
    await waitFor(() => expect(dashboardReads(fetchMock)).toBe(readsBefore + 1));
    expect(addCalls(fetchMock)).toHaveLength(1);
  });

  it.each([
    ['a rate limit', () => envelope({ code: 'RATE_LIMITED', message: 'slow down' }, 429)],
    ['a lost request', () => Promise.reject(new TypeError('network'))],
  ] as const)('after %s it says to try again shortly and keeps the button', async (_n, answer) => {
    const fetchMock = serve([dashboard(LEFT_OUT)], answer);
    renderReport();
    const block = await aiBlock();
    fireEvent.click(within(block).getByRole('button', { name: 'Add the AI answer' }));
    expect(await within(block).findByRole('alert')).toHaveTextContent(
      freePreviewCopy.en.addAnswer.retryShortly,
    );
    expect(within(block).getByRole('button', { name: 'Add the AI answer' })).toBeEnabled();
    expect(addCalls(fetchMock)).toHaveLength(1);
  });

  it('brings the button back, with the reason, when the attempt never started', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = serve([
      dashboard(LEFT_OUT),
      dashboard(QUEUED),
      dashboard(released('SiteUnreachable', '2026-11-17T10:00:00.000Z')),
    ]);
    renderReport();
    fireEvent.click(within(await aiBlock()).getByRole('button', { name: 'Add the AI answer' }));
    expect(await screen.findByText(freePreviewCopy.en.addAnswer.running)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS));

    const block = await aiBlock();
    expect(
      await within(block).findByText(freePreviewCopy.en.addAnswer.lastAttemptSiteUnread),
    ).toBeVisible();
    expect(within(block).getByRole('button', { name: 'Add the AI answer' })).toBeEnabled();
    // Settled back: the report stops asking.
    const reads = dashboardReads(fetchMock);
    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS * 3));
    expect(dashboardReads(fetchMock)).toBe(reads);
  });

  it('keeps waiting when a released attempt had already been shown before the press', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const earlier = released('PlatformFailure', '2026-11-17T09:00:00.000Z');
    serve([dashboard(earlier), dashboard(earlier), dashboard(QUEUED)]);
    renderReport();
    const block = await aiBlock();
    expect(within(block).getByText(freePreviewCopy.en.addAnswer.lastAttemptPlatform)).toBeVisible();
    fireEvent.click(within(block).getByRole('button', { name: 'Add the AI answer' }));
    // The first re-read still shows the old note: the press is not over yet.
    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS));
    expect(within(await aiBlock()).getByRole('status')).toHaveTextContent(
      freePreviewCopy.en.addAnswer.running,
    );
  });

  it('stops re-reading after its bound and says to reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = serve([dashboard(QUEUED)]);
    renderReport();
    await aiBlock();
    for (let tick = 0; tick < ADD_ANSWER_MAX_POLLS; tick += 1) {
      await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS));
    }
    expect(within(await aiBlock()).getByRole('status')).toHaveTextContent(
      freePreviewCopy.en.addAnswer.slow,
    );
    const reads = dashboardReads(fetchMock);
    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS * 5));
    expect(dashboardReads(fetchMock)).toBe(reads);
  });

  it('a report reopened while the answer runs says so and waits for it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve([dashboard(QUEUED), dashboard(ANSWERED_ROW, [ANSWER])]);
    renderReport();
    const block = await aiBlock();
    expect(within(block).getByRole('status')).toHaveTextContent(
      freePreviewCopy.en.addAnswer.running,
    );
    await act(() => vi.advanceTimersByTimeAsync(ADD_ANSWER_POLL_MS));
    expect(await within(await aiBlock()).findByText(REAL_ANSWER)).toBeVisible();
  });
});

describe('the GEO card of a late answer that failed after its AI step began', () => {
  it.each(['en', 'uk', 'ru'] as const)(
    'never advises running the check again (%s)',
    async (language) => {
      serve([dashboard(FAILED_AFTER_START)]);
      renderReport(language);
      await aiBlock(language);
      const t = copy[language].report;
      expect(screen.getByText(t.moduleReason.aiFreePreviewPlatformFailure)).toBeVisible();
      expect(screen.queryByText(t.moduleReason.platformFailure)).toBeNull();
      expect(screen.queryByText(t.moduleResponsibility.oursRetry)).toBeNull();
      expect(document.body).not.toHaveTextContent(
        /run the check again|Run the check again|Запустіть перевірку ще раз|Запустите проверку ещё раз/,
      );
    },
  );

  it('reads an evaluation that failed with ProviderUnavailable as the Free sentence', async () => {
    serve([
      dashboard(
        geo({
          status: 'Partial',
          statusReason: 'AnswerEvaluationUnavailable: 1 of 1 (ProviderUnavailable)',
          coverage: 0.5,
          usableOutput: true,
          metadata: { freePreview: true, latePreview: true, previewRequested: true },
        }),
      ),
    ]);
    renderReport();
    await aiBlock();
    const t = copy.en.report;
    expect(screen.getByText(t.moduleReason.aiFreePreviewProviderUnavailable)).toBeVisible();
    expect(screen.queryByText(t.moduleReason.aiProviderUnavailable)).toBeNull();
    expect(screen.queryByText(t.moduleResponsibility.oursRetry)).toBeNull();
  });
});
