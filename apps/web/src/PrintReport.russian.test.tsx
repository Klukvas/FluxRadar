// The printable client report is one document, in one language.
//
// A Russian reader gets a Russian interface around a Ukrainian report
// (`report-language.ts`), and the printable page is the report. The toolbar
// above it is interface chrome; everything inside the article is the document,
// so every date, section result, score word and plan name in it has to come
// from the report's language and not from the reader's. Four helpers used to
// be handed the interface language instead, which printed «2 октября 2026 г.»,
// «Архивный тариф» and Russian section results inside Ukrainian pages.
//
// The Action Plan chapter is part of that document, so the plan it asks the API
// for is the document's: a Russian reader who wrote only a Ukrainian plan used
// to get the Ukrainian pages with the paid chapter missing from them.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionPlanState, Dashboard, Scan } from './api';
import { PrintReport } from './PrintReport';
import { findingsCopy } from './findings-copy';
import { findingsDocumentCopy } from './findings-document-copy';
import { copy } from './i18n';

const SCAN: Scan = {
  id: 'scan-ru-print',
  profileId: 'profile-1',
  // A retired plan, so the cover's plan fact goes through `planName`, whose
  // Russian branch says «Архивный тариф».
  plan: 'Legacy',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 2, totalModules: 2 },
  startedAt: '2026-10-02T00:00:00.000Z',
  completedAt: '2026-10-02T00:01:00.000Z',
  createdAt: '2026-10-02T00:00:00.000Z',
  modules: [],
};

const DASHBOARD: Dashboard = {
  scan: SCAN,
  overall: { verdict: 'ok', score: 90, weightedCoverage: 1, moduleWeights: [] },
  modules: [
    // One section with a score and one without, so both `moduleResultLabel`
    // and `moduleScoreLabel` are exercised.
    {
      module: 'SEO',
      status: 'Completed',
      statusReason: null,
      coverage: 1,
      score: 88,
      applicableChecks: 10,
      completedApplicableChecks: 10,
      usableOutput: true,
    },
    {
      module: 'Security',
      status: 'Completed',
      statusReason: null,
      coverage: 1,
      score: null,
      applicableChecks: 4,
      completedApplicableChecks: 4,
      usableOutput: true,
      metadata: { scoring: 'InformationalOnly' },
    },
  ],
  geoObservations: [],
};

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...(meta ?? {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A plan this scan has, written in Ukrainian and in no other language. */
const UKRAINIAN_PLAN: ActionPlanState = {
  scanId: SCAN.id,
  languages: ['uk'],
  running: null,
  lastFailure: null,
  remaining: { successes: 2, attempts: 5 },
  windowEndsAt: null,
  plan: {
    language: 'uk',
    overview: 'Пошукові системи ще не читають базові інструкції сайту.',
    actions: [
      {
        title: 'Опублікувати robots.txt',
        why: 'Без нього сканери самі вирішують, що їм можна читати.',
        steps: ['Створіть /robots.txt'],
        effort: 'small',
        ruleIds: ['SEO-TECH-001'],
        openIssues: 2,
        totalIssues: 3,
        settled: false,
      },
    ],
    reach: null,
    caveats: [],
    generatedAt: '2026-10-02T12:00:00.000Z',
    modelId: 'claude-opus-5',
    noticeVersion: 'core-ai-processing-notice-v6',
  },
};

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown) => {
    const path = String(input);
    if (path.includes('/action-plan')) return Promise.resolve(envelope(DASHBOARD));
    if (path.includes('/issues/summary')) {
      return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
    }
    if (path.includes('/issues')) {
      return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
    }
    return Promise.resolve(envelope(DASHBOARD));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * The same stub, but the Action Plan endpoint answers like the real one: a plan
 * for `?language=uk`, and an empty state for every other language.
 */
function stubFetchWithUkrainianPlan(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: unknown) => {
    const path = String(input);
    if (path.includes('/action-plan')) {
      const language = new URL(path, 'https://local.test').searchParams.get('language');
      return Promise.resolve(
        envelope(language === 'uk' ? UKRAINIAN_PLAN : { ...UKRAINIAN_PLAN, plan: null }),
      );
    }
    if (path.includes('/issues/summary')) {
      return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
    }
    if (path.includes('/issues')) {
      return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
    }
    return Promise.resolve(envelope(DASHBOARD));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The document itself, without the toolbar that sits above it. */
async function documentText(language: 'ru' | 'uk'): Promise<string> {
  stubFetch();
  const { unmount } = render(
    <PrintReport scanId={SCAN.id} language={language} onBack={() => {}} onError={() => {}} />,
  );
  const article = await screen.findByRole('article');
  const text = article.textContent ?? '';
  unmount();
  vi.unstubAllGlobals();
  return text;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the printable report a Russian reader prints', () => {
  it('is the same document the Ukrainian interface prints', async () => {
    expect(await documentText('ru')).toBe(await documentText('uk'));
  });

  it('dates the document in Ukrainian, never in Russian', async () => {
    const text = await documentText('ru');
    const russianMonths = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ];
    expect(russianMonths.filter((month) => text.includes(month))).toEqual([]);
    // The scan ran on 2026-10-02, so the Ukrainian month has to be there: an
    // empty document would pass the check above for the wrong reason.
    expect(text).toContain('жовтня 2026');
  });

  it('names the sections and the plan in the report’s words', async () => {
    const text = await documentText('ru');
    // Only the labels Russian actually words differently: one that happens to
    // be spelled the same in both languages proves nothing either way.
    const ukrainianProgress: Record<string, unknown> = copy.uk.scanProgress;
    const russianOnly = Object.entries<unknown>(copy.ru.scanProgress).flatMap(([key, value]) =>
      typeof value === 'string' && value !== ukrainianProgress[key] ? [{ key, value }] : [],
    );
    expect(russianOnly.filter((label) => text.includes(label.value))).toEqual([]);
    expect(text).not.toContain('Архивный тариф');
    expect(text).toContain('Архівний тариф');
  });

  it('includes the Ukrainian Action Plan and never asks for a Russian one', async () => {
    const fetchMock = stubFetchWithUkrainianPlan();
    render(<PrintReport scanId={SCAN.id} language="ru" onBack={() => {}} onError={() => {}} />);
    const article = await screen.findByRole('article');

    // The chapter the reader paid for is in the document they printed.
    const plan = findingsDocumentCopy.uk;
    expect(article.textContent ?? '').toContain(UKRAINIAN_PLAN.plan?.actions[0]?.title ?? '');
    // And the name the browser offers for the saved file is the document's,
    // which is what a Russian interface around a Ukrainian report must not
    // change. Read off `document.title` rather than off the catalogue: the
    // catalogue containing its own Ukrainian words proves nothing.
    expect(document.title).toBe(plan.print.documentTitle('smile.example'));

    const planRequests = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((path) => path.includes('/action-plan'));
    expect(planRequests.length).toBeGreaterThan(0);
    expect(planRequests.every((path) => path.includes('language=uk'))).toBe(true);
    expect(planRequests.some((path) => path.includes('language=ru'))).toBe(false);
  });
});

describe('the toolbar above that document', () => {
  // The other half of the split: the window around the document is the app
  // speaking, so it is translated, and nothing Ukrainian may leak into it.
  it('is Russian, with no Ukrainian letter in it', () => {
    const ukrainianOnly = /[іїєґ]/i;
    const toolbar = findingsCopy.ru.print.toolbar;
    expect(Object.values(toolbar)).toHaveLength(6);
    for (const [key, value] of Object.entries(toolbar)) {
      expect(value, key).not.toMatch(ukrainianOnly);
      expect(value, key).not.toBe((findingsCopy.uk.print.toolbar as Record<string, string>)[key]);
    }
  });

  it('draws its buttons from the reader’s language, not the document’s', async () => {
    stubFetch();
    render(<PrintReport scanId={SCAN.id} language="ru" onBack={() => {}} onError={() => {}} />);
    await screen.findByRole('article');

    const toolbar = findingsCopy.ru.print.toolbar;
    expect(screen.getByRole('toolbar', { name: toolbar.windowTitle })).toBeTruthy();
    expect(screen.getByRole('button', { name: toolbar.back })).toBeTruthy();
    expect(screen.getByRole('button', { name: toolbar.print })).toBeTruthy();
  });
});
