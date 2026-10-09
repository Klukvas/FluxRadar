// The Issue Center and the pricing block, driven in a real browser.
//
// Both are reading problems: a site that sends no Content-Security-Policy sends
// none on any page, so the finding list of a 30-page site carries the same
// sentence thirty times. What the owner needs is one problem, how many pages it
// is on, what differs between them, and what to do about it — with the raw
// headers one fold down — and leaving a problem has to land back on the
// problems. The pricing block answers the same kind of question: "which one is
// right for you?" comes before the three cards it is asked about.
//
// The API is mocked at the network boundary in the shapes `apps/api` returns;
// no request leaves the loopback address.

import { expect, test, type Page, type Route } from '@playwright/test';

const API_URL = 'http://127.0.0.1:3310';
const SCAN_ID = 'scan-issue-center';
const DOMAIN = 'https://shop.example';

const SCAN = {
  id: SCAN_ID,
  profileId: 'profile-shop',
  plan: 'Complete',
  domain: DOMAIN,
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 10, totalModules: 10 },
  startedAt: '2026-10-01T00:00:00.000Z',
  completedAt: '2026-10-01T00:06:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  modules: [],
} as const;

const CSP_PAGES = 30;
const HEADER_PAGES = 30;
/** Pages missing the framing rule as well, so the drilldown has two variants. */
const HEADER_PAGES_MISSING_TWO = 8;
const COOKIES = ['sid', 'cart', 'consent', 'ab'] as const;

interface Finding {
  readonly id: string;
  readonly scanId: string;
  readonly ruleId: string;
  readonly module: string;
  readonly fingerprint: string;
  readonly severity: string;
  readonly category: string;
  readonly status: string;
  readonly targetUrl: string;
  readonly evidenceType: string;
  readonly evidenceRef: string;
  readonly evidenceExcerpt: string;
  readonly recommendation: string;
  readonly confidence: number;
  readonly affectedTargets: number;
  readonly applicableTargets: number;
  readonly rulePenalty: number;
  readonly scoreDelta: number;
  readonly observedAt: string;
}

function finding(
  index: number,
  ruleId: string,
  severity: string,
  targetUrl: string,
  evidenceExcerpt: string,
): Finding {
  return {
    id: `${ruleId}-${index}`,
    scanId: SCAN_ID,
    ruleId,
    module: 'Security',
    fingerprint: `${ruleId}-fp-${index}`,
    severity,
    category: 'http',
    status: 'New',
    targetUrl,
    evidenceType: 'http',
    evidenceRef: `issue/${ruleId}-${index}`,
    evidenceExcerpt,
    recommendation: 'Send the header with your HTML responses.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 1,
    rulePenalty: 2,
    scoreDelta: -0.5,
    observedAt: '2026-10-01T00:05:00.000Z',
  };
}

const FINDINGS: readonly Finding[] = [
  ...Array.from({ length: CSP_PAGES }, (_, index) =>
    finding(
      index,
      'SEC-ASVS-001',
      'Critical',
      `${DOMAIN}/page-${index}`,
      'The HTML response has no Content-Security-Policy',
    ),
  ),
  ...Array.from({ length: HEADER_PAGES }, (_, index) =>
    finding(
      index,
      'SEC-PASSIVE-002',
      'Medium',
      `${DOMAIN}/page-${index}`,
      index < HEADER_PAGES_MISSING_TWO
        ? 'The HTML response is missing security headers (2): X-Frame-Options / CSP frame-ancestors; Referrer-Policy'
        : 'The HTML response is missing security headers (1): Referrer-Policy',
    ),
  ),
  // Four cookies on two pages: one finding per cookie, so the finding count is
  // deliberately not the page count here.
  ...COOKIES.map((cookie, index) =>
    finding(
      index,
      'SEC-PASSIVE-005',
      'Medium',
      `${DOMAIN}/page-${index % 2}`,
      `Set-Cookie "${cookie}" is missing attributes: HttpOnly, SameSite`,
    ),
  ),
];

const SUMMARY = {
  total: FINDINGS.length,
  open: FINDINGS.length,
  bySeverity: { Critical: CSP_PAGES, High: 0, Medium: HEADER_PAGES + COOKIES.length, Low: 0 },
  groups: [
    {
      ruleId: 'SEC-ASVS-001',
      module: 'Security',
      severity: 'Critical',
      issues: CSP_PAGES,
      openIssues: CSP_PAGES,
    },
    {
      ruleId: 'SEC-PASSIVE-002',
      module: 'Security',
      severity: 'Medium',
      issues: HEADER_PAGES,
      openIssues: HEADER_PAGES,
    },
    {
      ruleId: 'SEC-PASSIVE-005',
      module: 'Security',
      severity: 'Medium',
      issues: COOKIES.length,
      openIssues: COOKIES.length,
    },
  ],
} as const;

function json(route: Route, data: unknown, meta?: Record<string, number>): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data, error: null, ...(meta ? { meta } : {}) }),
  });
}

function unauthenticated(route: Route): Promise<void> {
  return route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({
      success: false,
      data: null,
      error: { code: 'SESSION_REQUIRED', message: 'session required' },
    }),
  });
}

/** The findings endpoint as the API answers it: filtered, then paged, with a total. */
function findingsPage(route: Route, url: URL): Promise<void> {
  const ruleId = url.searchParams.get('ruleId');
  const search = url.searchParams.get('search');
  const matching = FINDINGS.filter(
    (candidate) =>
      (ruleId === null || candidate.ruleId === ruleId) &&
      (search === null ||
        candidate.targetUrl.includes(search) ||
        candidate.evidenceExcerpt.includes(search)),
  );
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Number(url.searchParams.get('limit') ?? '50');
  return json(route, matching.slice(offset, offset + limit), {
    total: matching.length,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
}

async function installFixtures(
  page: Page,
  appOrigin: string,
  options: { readonly signedIn: boolean },
): Promise<void> {
  // Vite's HMR socket lives on the app's host; every other socket is refused.
  await page.context().routeWebSocket('**/*', async (socket) => {
    if (new URL(socket.url()).host === new URL(appOrigin).host) socket.connectToServer();
    else await socket.close();
  });
  await page.context().route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin && request.method() === 'GET') {
      await route.continue();
      return;
    }
    if (url.origin !== API_URL) {
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname === '/auth/me') {
      if (!options.signedIn) {
        await unauthenticated(route);
        return;
      }
      await json(route, {
        accountId: 'account-e2e',
        email: 'e2e@example.test',
        emailVerified: true,
        onboarding: { status: 'completed' },
      });
      return;
    }
    if (url.pathname === '/profiles') {
      await json(route, [{ id: 'profile-shop', name: 'shop.example', domain: DOMAIN }]);
      return;
    }
    if (url.pathname === `/scans/${SCAN_ID}`) {
      await json(route, SCAN);
      return;
    }
    if (url.pathname === `/scans/${SCAN_ID}/issues/summary`) {
      await json(route, SUMMARY);
      return;
    }
    if (url.pathname === `/scans/${SCAN_ID}/issues`) {
      await findingsPage(route, url);
      return;
    }
    await route.abort('blockedbyclient');
  });
}

async function dismissCookies(page: Page): Promise<void> {
  const banner = page.getByRole('region', { name: 'Cookies & storage' });
  if (await banner.isVisible()) {
    // Optional storage is suggested on, so refusing it is a switch and a save.
    await banner.getByRole('checkbox', { name: 'All optional storage' }).click();
    await banner.getByRole('button', { name: 'Save choice' }).click();
  }
}

test.describe('the Issue Center on a report full of header findings', () => {
  test('opens on one row per problem and explains each in plain language', async ({
    page,
    baseURL,
  }) => {
    await installFixtures(page, new URL(baseURL ?? '').origin, { signedIn: true });
    await page.goto(`/scans/${SCAN_ID}/issues`);
    await dismissCookies(page);

    await expect(page.getByText('64 open findings across 3 problems.')).toBeVisible();
    // Three problems, sixty-four findings: three rows, and not one page address.
    await expect(page.getByRole('row')).toHaveCount(4);
    await expect(page.getByText(`${DOMAIN}/page-7`)).toHaveCount(0);

    // Headlined in the owner's words; the technical title, the only place the
    // header is named now, stays on the line under it.
    const csp = page
      .getByRole('row')
      .filter({ hasText: 'Content-Security-Policy is missing or weak' });
    await expect(csp).toContainText('Pages do not limit where they load content from');
    await expect(csp).toContainText(`On ${CSP_PAGES} pages`);
    const explanation = csp.getByText(/do not tell the browser which outside sources/);
    // Folded by default — a row that opens itself is a row per problem in name only.
    await expect(explanation).toBeHidden();
    await csp.getByText('What this means in plain language').click();
    await expect(explanation).toBeVisible();
    await expect(
      csp.getByText(/nothing was attacked, logged into or tested for whether it can be exploited/),
    ).toBeVisible();
    await expect(csp.getByText('One finding for each page where it is not set.')).toBeVisible();
  });

  test('opens a problem onto its pages, then returns to the problems', async ({
    page,
    baseURL,
  }) => {
    await installFixtures(page, new URL(baseURL ?? '').origin, { signedIn: true });
    await page.goto(`/scans/${SCAN_ID}/issues`);
    await dismissCookies(page);

    await page
      .getByRole('button', { name: 'Show findings: Some browser protection settings are off' })
      .click();

    await expect(page.getByText('These findings are on 30 pages.')).toBeVisible();
    await expect(page.getByText('What differs between pages')).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: '(1): Referrer-Policy' }),
    ).toContainText('22 findings');
    await expect(
      page.getByRole('listitem').filter({ hasText: '(2): X-Frame-Options' }),
    ).toContainText('8 findings');
    // Still per page underneath: every finding keeps its address and its status.
    await expect(page.getByText(`${DOMAIN}/page-7`)).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Status: Some browser protection settings are off' }),
    ).toHaveCount(30);
    // One message for the developer, for the whole problem.
    await expect(
      page.getByRole('button', {
        name: 'Copy task for developer: Some browser protection settings are off',
      }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Show every problem' }).click();

    // Regression: this used to drop the rule filter and stay in the flat list,
    // which is every finding of every rule — one row per page.
    await expect(page.getByRole('row')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Problems' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText(`${DOMAIN}/page-7`)).toHaveCount(0);
  });

  test('counts the cookie findings as cookies, and says so', async ({ page, baseURL }) => {
    await installFixtures(page, new URL(baseURL ?? '').origin, { signedIn: true });
    await page.goto(`/scans/${SCAN_ID}/issues`);
    await dismissCookies(page);

    await page
      .getByRole('button', { name: 'Show findings: Cookies without all the usual safety limits' })
      .click();

    // Four findings, two pages: the breakdown counts the pages, and the
    // disclosure in the detail says one finding is one cookie.
    await expect(page.getByText('These findings are on 2 pages.')).toBeVisible();
    await page.getByRole('button', { name: 'Details' }).first().click();
    await expect(page.getByText(/One finding for each cookie on each page/)).toBeVisible();

    // The raw attribute names are still reachable — one fold down, for whoever
    // will do the work.
    const detail = page.locator('.issue-detail');
    const evidence = detail.getByText('Set-Cookie "sid" is missing attributes: HttpOnly, SameSite');
    await expect(evidence).toBeHidden();
    // The scoring fields are folded with it, after the explanation.
    await expect(detail.getByText('Impact')).toBeHidden();
    await detail.getByText('Technical details for your developer').click();
    await expect(evidence).toBeVisible();
    await expect(detail.getByText('Impact')).toBeVisible();
    await expect(detail.getByText('SEC-PASSIVE-005')).toBeVisible();
  });
});

test.describe('the pricing block on the home page', () => {
  test('answers "which one is right for you?" above the three cards', async ({ page, baseURL }) => {
    await installFixtures(page, new URL(baseURL ?? '').origin, { signedIn: false });
    await page.goto('/');
    await dismissCookies(page);

    const comparison = page.getByRole('table', { name: /The three packages side by side/ });
    const basicCard = page.getByRole('heading', { name: 'Basic', level: 3 });
    await comparison.scrollIntoViewIfNeeded();
    const comparisonBox = await comparison.boundingBox();
    const cardBox = await basicCard.boundingBox();
    if (comparisonBox === null || cardBox === null) throw new Error('expected both blocks drawn');

    expect(comparisonBox.y).toBeLessThan(cardBox.y);
    // And the answers are the proof-read ones: Basic's column names every
    // module it does not run.
    const notIncluded = page.getByRole('row').filter({ hasText: 'What is not included' });
    await expect(notIncluded).toContainText('UX/Conversion and Analytics');
  });
});
