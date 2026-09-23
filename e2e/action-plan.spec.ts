// The report's AI Action Plan, driven in a real browser.
//
// Every state of this block costs something when it is wrong: an idle button
// drawn from a response that is not the plan state offers to spend a generation
// the scan may not have, a run that never leaves "writing" reads as money taken
// for nothing, and a plan that fails to replace the "fix these first" list
// leaves two competing answers to "what do I do now".
//
// The API is mocked at the network boundary, in the shapes `apps/api` returns —
// no model is asked anything here, and no request leaves the loopback address.

import { expect, test, type Page, type Route } from '@playwright/test';

import { ACTION_PLAN_NOTICE_VERSION } from '../apps/web/src/ai-processing-notice';

const API_URL = 'http://127.0.0.1:3310';
const SCAN_ID = 'scan-action-plan';

interface PlanAction {
  readonly title: string;
  readonly why: string;
  readonly steps: readonly string[];
  readonly effort: string;
  readonly ruleIds: readonly string[];
  readonly openIssues: number;
  readonly totalIssues: number;
  readonly settled: boolean;
}

interface PlanContent {
  readonly language: string;
  readonly overview: string;
  readonly actions: readonly PlanAction[];
  readonly reach: {
    readonly share: number;
    readonly addressedOpenIssues: number;
    readonly totalOpenIssues: number;
    readonly rules: number;
  } | null;
  readonly caveats: readonly string[];
  readonly generatedAt: string;
  readonly modelId: string;
  readonly noticeVersion: string;
}

interface PlanState {
  readonly scanId: string;
  readonly languages: readonly string[];
  readonly running: { readonly language: string | null; readonly startedAt: string | null } | null;
  readonly lastFailure: { readonly code: string | null; readonly language: string } | null;
  readonly remaining: { readonly successes: number; readonly attempts: number };
  readonly windowEndsAt: string | null;
  readonly plan: PlanContent | null;
}

const SCAN = {
  id: SCAN_ID,
  profileId: 'profile-clinic',
  plan: 'Complete',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 2, totalModules: 2 },
  startedAt: '2026-09-22T00:00:00.000Z',
  completedAt: '2026-09-22T00:04:00.000Z',
  createdAt: '2026-09-22T00:00:00.000Z',
  modules: [],
} as const;

const MODULES = [
  {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: 62,
    applicableChecks: 12,
    completedApplicableChecks: 12,
    usableOutput: true,
    metadata: {},
  },
  {
    module: 'AI SEO / GEO',
    status: 'Partial',
    statusReason: null,
    coverage: 1,
    score: 70,
    applicableChecks: 4,
    completedApplicableChecks: 3,
    usableOutput: true,
    metadata: {},
  },
] as const;

const GEO_OBSERVATIONS = [
  {
    purpose: 'awareness',
    question: 'What is Smile Clinic?',
    status: 'answered',
    reason: null,
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    answer: 'Smile Clinic is a dental clinic in Kyiv.',
    citations: [],
    mentions: { brand: true, domain: false },
  },
  {
    purpose: 'discovery',
    question: 'Which dental clinics offer implants in Kyiv?',
    status: 'answered',
    reason: null,
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    answer: 'Several clinics do, including Smile Clinic (smile.example).',
    citations: ['https://smile.example/implants'],
    mentions: { brand: true, domain: true },
  },
] as const;

const DASHBOARD = {
  scan: SCAN,
  overall: {
    verdict: 'attention',
    score: 66,
    weightedCoverage: 1,
    moduleWeights: [
      { module: 'SEO', tariffWeight: 1, effectiveWeight: 1 },
      { module: 'AI SEO / GEO', tariffWeight: 1, effectiveWeight: 1 },
    ],
  },
  modules: MODULES,
  geoObservations: GEO_OBSERVATIONS,
} as const;

const ISSUE_SUMMARY = {
  total: 10,
  open: 8,
  bySeverity: { Critical: 2, Major: 4, Minor: 2 },
  groups: [
    { ruleId: 'SEO-TECH-001', module: 'SEO', severity: 'Critical', issues: 3, openIssues: 3 },
    { ruleId: 'SEO-ONPAGE-001', module: 'SEO', severity: 'Major', issues: 4, openIssues: 3 },
    { ruleId: 'SEO-TECH-004', module: 'SEO', severity: 'Minor', issues: 3, openIssues: 2 },
  ],
} as const;

const PLAN_EN: PlanContent = {
  language: 'en',
  overview: 'Three fixes clear most of what this report found on smile.example.',
  actions: [
    {
      title: 'Publish a robots.txt the crawlers can read',
      why: 'Without it, search engines guess which pages they may read.',
      steps: ['Create /robots.txt', 'Allow the public pages', 'Link the sitemap from it'],
      effort: 'small',
      ruleIds: ['SEO-TECH-001'],
      openIssues: 3,
      totalIssues: 3,
      settled: false,
    },
    {
      title: 'Give every page its own title',
      why: 'Shared titles make the pages compete with each other in the results.',
      steps: ['List the pages sharing a title', 'Write one title per page'],
      effort: 'medium',
      ruleIds: ['SEO-ONPAGE-001', 'SEO-TECH-004'],
      openIssues: 3,
      totalIssues: 7,
      settled: false,
    },
  ],
  reach: { share: 0.6, addressedOpenIssues: 6, totalOpenIssues: 10, rules: 4 },
  caveats: ['Performance'],
  generatedAt: '2026-09-22T12:00:00.000Z',
  modelId: 'claude-opus-5',
  noticeVersion: ACTION_PLAN_NOTICE_VERSION,
};

const PLAN_UK: PlanContent = {
  ...PLAN_EN,
  language: 'uk',
  overview: 'Три правки закривають більшість того, що знайшов цей звіт.',
  actions: [
    {
      ...PLAN_EN.actions[0],
      title: 'Опублікувати robots.txt, який прочитають пошуковики',
      why: 'Без нього пошукові системи вгадують, які сторінки їм можна читати.',
      steps: ['Створити /robots.txt', 'Дозволити публічні сторінки'],
    } as PlanAction,
  ],
};

function idleState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    scanId: SCAN_ID,
    languages: [],
    running: null,
    lastFailure: null,
    remaining: { successes: 3, attempts: 6 },
    windowEndsAt: '2026-09-25T00:04:00.000Z',
    plan: null,
    ...overrides,
  };
}

interface PlanPost {
  readonly language: string;
  readonly noticeVersion: string;
}

/**
 * The Action Plan endpoints as a small state machine.
 *
 * A generation is asked for once and then polled, so the fixture answers the
 * poll that follows the click with "still writing" before it answers with a
 * plan: a block that only ever sees the final state proves nothing about the
 * one a customer actually watches.
 */
function planServer(initial: Readonly<Record<string, PlanState>>) {
  const states = new Map<string, PlanState>(Object.entries(initial));
  const posts: PlanPost[] = [];
  let writing: { language: string; pollsLeft: number } | null = null;

  const stateFor = (language: string): PlanState =>
    states.get(language) ?? idleState({ languages: [...states.keys()] });

  return {
    posts,
    get(language: string): PlanState {
      if (writing !== null && writing.language === language) {
        if (writing.pollsLeft > 0) {
          writing = { ...writing, pollsLeft: writing.pollsLeft - 1 };
          return {
            ...stateFor(language),
            running: { language, startedAt: '2026-09-22T12:00:00.000Z' },
          };
        }
        const written = language === 'uk' ? PLAN_UK : PLAN_EN;
        states.set(language, {
          ...stateFor(language),
          languages: [language],
          running: null,
          lastFailure: null,
          remaining: { successes: 2, attempts: 5 },
          plan: written,
        });
        writing = null;
      }
      return stateFor(language);
    },
    post(body: PlanPost): void {
      posts.push(body);
      // One poll answers "still writing", the next one carries the plan.
      writing = { language: body.language, pollsLeft: 1 };
    },
  };
}

function json(route: Route, data: unknown, meta?: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data,
      error: null,
      ...(meta === undefined ? {} : { meta }),
    }),
  });
}

async function installReportFixtures(
  page: Page,
  plans: ReturnType<typeof planServer>,
  appOrigin: string,
): Promise<void> {
  // Vite's HMR socket lives on the app's host under a ws:// scheme.
  await page.context().routeWebSocket('**/*', async (socket) => {
    if (new URL(socket.url()).host === new URL(appOrigin).host) {
      socket.connectToServer();
      return;
    }
    await socket.close();
  });
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (url.origin === appOrigin && request.method() === 'GET') {
      await route.continue();
      return;
    }
    if (url.origin !== API_URL) {
      await route.abort('blockedbyclient');
      return;
    }

    if (path === '/auth/me') {
      await json(route, {
        accountId: 'account-e2e',
        email: 'e2e@example.test',
        emailVerified: true,
        onboarding: { status: 'completed' },
      });
      return;
    }
    if (path === '/profiles') {
      await json(route, [
        {
          id: 'profile-clinic',
          name: 'smile.example',
          domain: 'https://smile.example',
          targetLanguages: 'uk, en',
        },
      ]);
      return;
    }
    if (path === `/scans/${SCAN_ID}`) {
      await json(route, SCAN);
      return;
    }
    if (path === `/scans/${SCAN_ID}/dashboard`) {
      await json(route, DASHBOARD);
      return;
    }
    if (path === `/scans/${SCAN_ID}/issues/summary`) {
      await json(route, ISSUE_SUMMARY);
      return;
    }
    if (path === `/scans/${SCAN_ID}/issues`) {
      await json(route, [], { total: 0 });
      return;
    }
    if (path === `/scans/${SCAN_ID}/changes`) {
      await json(route, { previous: null, fixed: 0, appeared: 0, fixedRules: [], newRules: [] });
      return;
    }
    if (path === `/scans/${SCAN_ID}/action-plan`) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as PlanPost;
        plans.post(body);
        await json(route, { started: true });
        return;
      }
      await json(route, plans.get(url.searchParams.get('language') ?? 'en'));
      return;
    }
    await route.abort('blockedbyclient');
  });
}

async function openReport(page: Page, search = ''): Promise<void> {
  await page.goto(`/scans/${SCAN_ID}${search}`);
  const banner = page.getByRole('region', { name: 'Cookies & storage' });
  if (await banner.isVisible())
    await banner.getByRole('button', { name: 'Only necessary' }).click();
}

test.describe('AI Action Plan on a Complete report', () => {
  test('writes a plan on request and takes the place of "fix these first"', async ({
    page,
    baseURL,
  }) => {
    const plans = planServer({ en: idleState() });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    await openReport(page, '?lang=en');

    const block = page.locator('section.action-plan');
    await expect(block.getByRole('heading', { name: 'AI Action Plan' })).toBeVisible();
    await expect(block.getByRole('combobox', { name: 'Plan language' })).toHaveValue('en');
    // The disclosure is on screen before the button is pressed, not after.
    await expect(block.locator('.action-plan__consent')).toContainText('to Anthropic');
    await expect(block.locator('.action-plan__consent')).toContainText(
      'never sends evidence excerpts, screenshots or anything from the Analytics section',
    );
    await expect(page.getByRole('heading', { name: 'Fix these first' })).toBeVisible();

    await block.getByRole('button', { name: 'Write the Action Plan' }).click();

    await expect(block.locator('.action-plan__running')).toHaveText(
      'Claude is writing the plan. This usually takes a minute or two.',
    );
    expect(plans.posts).toEqual([{ language: 'en', noticeVersion: ACTION_PLAN_NOTICE_VERSION }]);

    // Only the poll brings the plan; nothing else on the page is touched.
    await expect(block.locator('.action-plan__overview')).toHaveText(PLAN_EN.overview);
    await expect(block.locator('.action-plan__running')).toHaveCount(0);
    await expect(block.locator('.action-plan__actions > li')).toHaveCount(2);
    await expect(block.locator('.action-plan__actions > li').first()).toContainText(
      'Publish a robots.txt the crawlers can read',
    );
    await expect(block.locator('.action-plan__actions > li').first()).toContainText('Small effort');
    await expect(
      block.getByRole('button', { name: 'robots.txt is missing or unreachable' }),
    ).toBeVisible();
    await expect(block.locator('.action-plan__reach')).toHaveText(
      'This plan addresses 60% of the open findings, across 4 rules.',
    );
    await expect(block.locator('.action-plan__caveat')).toHaveText(
      'Performance was only partly checked — the plan may be incomplete.',
    );
    await expect(block.locator('.action-plan__meta')).toContainText('claude-opus-5');
    await expect(block.getByRole('button', { name: 'Rewrite the plan (2 left)' })).toBeVisible();
    // Two "start here" lists would compete; the written one wins.
    await expect(page.getByRole('heading', { name: 'Fix these first' })).toHaveCount(0);
  });

  test('says a run failed instead of drawing a half-written plan', async ({ page, baseURL }) => {
    const plans = planServer({
      en: idleState({
        lastFailure: { code: 'ProviderUnavailable', language: 'en' },
        remaining: { successes: 2, attempts: 5 },
      }),
    });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    await openReport(page, '?lang=en');

    const block = page.locator('section.action-plan');
    await expect(block.locator('.action-plan__failed')).toHaveText(
      'The plan could not be written this time.',
    );
    await expect(block.locator('.action-plan__overview')).toHaveCount(0);
    // A failure the customer did not cause still leaves the attempt they paid
    // for, and the button says what pressing it now means.
    await expect(block.getByRole('button', { name: 'Try again' })).toBeEnabled();
    // The report keeps its own answer to "what now" while no plan exists.
    await expect(page.getByRole('heading', { name: 'Fix these first' })).toBeVisible();
  });

  test('offers no generation once the scan has spent them', async ({ page, baseURL }) => {
    const plans = planServer({ en: idleState({ remaining: { successes: 0, attempts: 2 } }) });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    await openReport(page, '?lang=en');

    const block = page.locator('section.action-plan');
    await expect(block.getByRole('button', { name: 'Write the Action Plan' })).toBeDisabled();
    await expect(block.locator('.action-plan__consent')).toHaveText(
      'This scan has used all of its Action Plan attempts.',
    );
    expect(plans.posts).toEqual([]);
  });

  test('prints the plan the shared link asked for, in that plan language', async ({
    page,
    baseURL,
  }) => {
    const plans = planServer({
      en: idleState({ languages: ['uk'], plan: null }),
      uk: idleState({ languages: ['uk'], plan: PLAN_UK }),
    });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    const planRequest = page.waitForRequest(
      (request) =>
        request.url().startsWith(`${API_URL}/scans/${SCAN_ID}/action-plan`) &&
        request.method() === 'GET',
    );
    await page.goto(`/scans/${SCAN_ID}/report?plan=uk&lang=en`);

    expect(new URL((await planRequest).url()).searchParams.get('language')).toBe('uk');
    const printed = page.locator('.print-action-plan');
    await expect(printed).toContainText(PLAN_UK.overview);
    await expect(printed).toContainText('Опублікувати robots.txt');
    // The document's own language is the reader's; only the plan is Ukrainian.
    await expect(printed.getByRole('heading', { name: 'AI Action Plan' })).toBeVisible();
  });

  test('groups the GEO answers by the provider that was asked', async ({ page, baseURL }) => {
    const plans = planServer({ en: idleState() });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    await openReport(page, '?lang=en');

    await page.locator('.module-grid .module-card', { hasText: 'AI SEO / GEO' }).first().click();

    const groups = page.locator('.geo-observations__provider');
    await expect(groups).toHaveCount(2);
    await expect(groups.first()).toContainText('ChatGPT · OpenAI');
    await expect(groups.first()).toContainText('gpt-5.6-luna');
    await expect(groups.first()).toContainText(
      'Brand mentioned in 1 of 1 answers · official domain referenced in 1 of 1.',
    );
    await expect(groups.nth(1)).toContainText('Claude · Anthropic');
    await expect(groups.nth(1)).toContainText('claude-sonnet-5');
  });
});
