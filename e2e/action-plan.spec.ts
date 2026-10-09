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

/**
 * The moment every test reads the report at.
 *
 * The block refuses a generation once the three-day Plan Window has closed, and
 * it judges that against the browser's clock — so a fixture with a fixed
 * `windowEndsAt` silently becomes a "window closed" report the day it passes.
 * The clock is pinned instead of the dates being pushed forward, because the
 * state under test is "the window is open", not "the date is in the future".
 */
const NOW = new Date('2026-09-22T12:05:00.000Z');

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

/**
 * The SEO section's per-rule check list, as the API records it in the module's
 * metadata. A row with affected targets is the one the reader can press to see
 * the findings behind it; the passing row is here so the press is a choice
 * between rows rather than the only thing on screen.
 */
const SEO_RULE_CHECKS = [
  {
    ruleId: 'SEO-TECH-001',
    title: 'robots.txt reachable',
    targetKind: 'site',
    applicableTargets: 1,
    affectedTargets: 1,
  },
  {
    ruleId: 'SEO-TECH-002',
    title: 'sitemap reachable',
    targetKind: 'site',
    applicableTargets: 1,
    affectedTargets: 0,
  },
] as const;

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
    metadata: { ruleChecks: SEO_RULE_CHECKS },
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

/**
 * The GEO answers, with mention signals in the shape the API records them.
 *
 * Not booleans. A question that names the business proves nothing when the
 * answer repeats it, so that signal is `named-in-question` and the report must
 * read it as "not measured" — neither a mention nor a miss. The two discovery
 * answers are the ones that can be counted: they leave the brand and the domain
 * for the model to bring up, so one hit out of two is a real measurement and
 * the group's counts have something to say.
 */
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
    mentions: { brand: 'named-in-question', domain: 'not-mentioned' },
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
    mentions: { brand: 'mentioned', domain: 'mentioned' },
  },
  {
    purpose: 'discovery',
    question: 'Where can I get same-day dental implants in Kyiv?',
    status: 'answered',
    reason: null,
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    answer: 'A few Kyiv clinics advertise same-day implants; ask them directly.',
    citations: [],
    mentions: { brand: 'not-mentioned', domain: 'not-mentioned' },
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

/** One finding of the rule the report's problem row points at. */
const ROBOTS_ISSUE = {
  id: 'issue-robots',
  scanId: SCAN_ID,
  ruleId: 'SEO-TECH-001',
  module: 'SEO',
  fingerprint: 'fp-robots',
  severity: 'Critical',
  category: 'Technical',
  status: 'New',
  targetUrl: 'https://smile.example/robots.txt',
  evidenceType: 'http',
  evidenceRef: 'https://smile.example/robots.txt',
  evidenceExcerpt: '404 Not Found',
  recommendation: 'Publish a robots.txt at the site root.',
  confidence: 1,
  affectedTargets: 1,
  applicableTargets: 1,
  rulePenalty: 8,
  scoreDelta: -8,
  observedAt: '2026-09-22T00:03:00.000Z',
} as const;

function crawlScopeFacts() {
  return {
    entryUrl: 'https://smile.example/',
    maxPages: 50,
    maxDepth: 3,
    includeSubdomains: false,
    queryPolicy: 'ignore',
    urlPatterns: [],
    excludePatterns: [],
    seedUrls: [],
    renderJs: false,
    respectRobots: true,
    userAgent: 'desktop',
    egressLocation: 'ua-kyiv',
    egressLocationView: {
      id: 'ua-kyiv',
      countryCode: 'UA',
      city: 'Kyiv',
      label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
    },
    scopeKey: 'scope-1',
  };
}

const EMPTY_ISSUE_COUNTS = { new: 0, resolved: 0, reopened: 0, stillOpen: 0, settled: 0 } as const;

/**
 * `GET /scans/:id/comparison`, in the shape `isScanComparison` accepts.
 *
 * The panel validates this answer field by field and prints one "could not be
 * loaded" line for anything that fails — which is what an unmocked (aborted)
 * request produces too. So the fixture is the whole contract, and the test
 * below asserts that line is absent: a field dropped from the payload, or added
 * to the checked shape, fails here instead of reaching a reader as a silent
 * missing panel.
 */
const COMPARISON = {
  current: {
    id: SCAN_ID,
    plan: 'Complete',
    completedAt: SCAN.completedAt,
    status: 'Completed',
    pagesRead: 12,
    urlsDiscovered: 14,
    urlsOverLimit: 0,
    scope: crawlScopeFacts(),
    readable: true,
  },
  previous: {
    id: 'scan-action-plan-previous',
    plan: 'Complete',
    completedAt: '2026-09-15T00:04:00.000Z',
    status: 'Completed',
    pagesRead: 12,
    urlsDiscovered: 14,
    urlsOverLimit: 0,
    scope: crawlScopeFacts(),
    readable: true,
  },
  comparable: { ok: true },
  overall: { previousScore: 58, currentScore: 66, delta: 8 },
  modules: [
    {
      module: 'SEO',
      previousScore: 54,
      currentScore: 62,
      delta: 8,
      comparable: { ok: true },
    },
  ],
  pages: {
    comparable: { ok: true },
    identity: 'canonical-document',
    added: 1,
    removed: 0,
    kept: 11,
    currentTotal: 12,
    previousTotal: 11,
    addedSample: ['https://smile.example/implants'],
    removedSample: [],
  },
  issues: {
    ...EMPTY_ISSUE_COUNTS,
    new: 2,
    resolved: 3,
    stillOpen: 6,
    byModule: [{ module: 'SEO', ...EMPTY_ISSUE_COUNTS, new: 2, resolved: 3, stillOpen: 6 }],
    bySeverity: [{ severity: 'Critical', ...EMPTY_ISSUE_COUNTS, new: 2, stillOpen: 2 }],
    newSample: [
      {
        fingerprint: 'fp-robots',
        ruleId: 'SEO-TECH-001',
        module: 'SEO',
        severity: 'Critical',
        normalizedUrl: 'https://smile.example/robots.txt',
      },
    ],
    resolvedSample: [],
    firstChecked: {
      known: true,
      count: 0,
      byModule: [],
      bySeverity: [],
      ruleIds: [],
      sample: [],
    },
    noLongerChecked: [],
  },
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
    // Three days after the scan finished, and two and a half days after NOW:
    // the Plan Window is open in every test that does not say otherwise.
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
  // Every date in these fixtures is read against this moment; timers keep
  // running, so the block's polling and its window timer behave as they do in
  // front of a customer.
  await page.clock.setFixedTime(NOW);
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
      // Scoped exactly as the Issue Center asked: a list that ignored the rule
      // filter would let a broken "open this problem" link still look right.
      const scoped = url.searchParams.get('ruleId') === ROBOTS_ISSUE.ruleId ? [ROBOTS_ISSUE] : [];
      await json(route, scoped, { total: scoped.length });
      return;
    }
    if (path === `/scans/${SCAN_ID}/changes`) {
      await json(route, { previous: null, fixed: 0, appeared: 0, fixedRules: [], newRules: [] });
      return;
    }
    if (path === `/scans/${SCAN_ID}/comparison`) {
      await json(route, COMPARISON);
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
  if (await banner.isVisible()) {
    // Optional storage is suggested on, so refusing it is a switch and a save.
    await banner.getByRole('checkbox', { name: 'All optional storage' }).click();
    await banner.getByRole('button', { name: 'Save choice' }).click();
  }
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

    // A provider group is the block headed by the assistant and its model; the
    // section around it and the visibility block are groups too, and only the
    // per-provider ones carry that heading.
    const groups = page.locator('.module-checks__group:has(> h5.module-checks__subheading)');
    await expect(groups).toHaveCount(2);
    // The assistant customers ask about comes first (D-233).
    await expect(groups.first()).toContainText('ChatGPT · OpenAI');
    await expect(groups.first()).toContainText('gpt-5.6-luna');
    // Both discovery answers could be measured, and one of them mentioned each.
    await expect(groups.first()).toContainText(
      'Brand mentioned in 1 of 2 answers · Official domain referenced in 1 of 2',
    );
    await expect(groups.nth(1)).toContainText('Claude · Anthropic');
    await expect(groups.nth(1)).toContainText('claude-sonnet-5');
    // The direct question named the brand, so the brand signal was not measured
    // — and an unmeasured signal is counted on neither side of the count, which
    // is why this group has no brand sentence at all.
    await expect(groups.nth(1)).not.toContainText('Brand mentioned in');
    await expect(groups.nth(1)).toContainText('Official domain referenced in 0 of 1');
    await expect(groups.nth(1).locator('.geo-observation__signal--unmeasured')).toHaveText(
      'Brand awareness — not measured (named in the question)',
    );
  });

  test('opens the Issue Center on the rule a problem row is about', async ({ page, baseURL }) => {
    const plans = planServer({ en: idleState() });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    await openReport(page, '?lang=en');

    // Exactly the SEO card: "AI SEO / GEO" contains the word too.
    await page
      .locator('.module-grid .module-card')
      .filter({ has: page.getByText('SEO', { exact: true }) })
      .click();
    const checks = page.locator('#module-checks-seo');
    // Only the row with findings behind it is pressable; the passing one is a
    // plain list item, and offering it as a link would lead to an empty list.
    await expect(checks.locator('li', { hasText: 'SEO-TECH-002' }).getByRole('button')).toHaveCount(
      0,
    );

    const issuesRequest = page.waitForRequest(
      (request) =>
        request.url().startsWith(`${API_URL}/scans/${SCAN_ID}/issues?`) &&
        new URL(request.url()).searchParams.get('ruleId') === 'SEO-TECH-001',
    );
    await checks.getByRole('button', { name: /SEO-TECH-001/ }).click();

    await issuesRequest;
    await expect(page).toHaveURL(new RegExp(`/scans/${SCAN_ID}/issues$`));
    await expect(page.locator('.issue-rule-filter')).toContainText(
      'Problem: robots.txt is missing or unreachable',
    );
    await expect(page.getByText('https://smile.example/robots.txt').first()).toBeVisible();
  });

  test('shows the comparison panel instead of its "could not be loaded" line', async ({
    page,
    baseURL,
  }) => {
    const plans = planServer({ en: idleState() });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    await openReport(page, '?lang=en');

    const panel = page.locator('.panel', {
      has: page.getByText('Compared with the previous scan', { exact: true }),
    });
    await expect(panel).toContainText('Against the Complete report of');
    await expect(panel).not.toContainText('could not be loaded');
  });

  test('marks the AI button with an icon the screen reader does not read', async ({
    page,
    baseURL,
  }) => {
    const plans = planServer({ en: idleState() });
    await installReportFixtures(page, plans, new URL(baseURL ?? '').origin);
    await openReport(page, '?lang=en');

    const block = page.locator('section.action-plan');
    // The name is the label alone: the icon marks the button as the one that
    // spends a generation, and reading "✦" out loud says nothing.
    const button = block.getByRole('button', { name: 'Write the Action Plan', exact: true });
    await expect(button).toBeVisible();

    const icon = button.locator('.action-plan__button-icon');
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    // Not a pixel value — only that the icon is not pressed against the label.
    const gap = await icon.evaluate(
      (node) => Number.parseFloat(getComputedStyle(node).marginRight) || 0,
    );
    expect(gap).toBeGreaterThan(0);
  });
});
