import { saveCookieConsent } from './browser-consent';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// What the new-scan form is allowed to offer on the Free plan.
//
// Free is the fixed homepage check: the crawler reads one page, follows no
// links, leaves subdomains alone and obeys robots.txt, whatever the request
// says (apps/api/src/orchestrator/run-attempt.ts). The form used to collect
// "include subdomains" and a robots.txt override on that plan anyway, so the
// owner set two things that were silently discarded and had no way to find out.
//
// The controls a plan does not reach are therefore not shown on it, and the
// screen says in words what the free check does instead. Nothing about the paid
// plans changes — the second half of this file is what proves that.

const account = { accountId: 'account-1', email: 'operator@example.com' };
const internalAccount = { ...account, internalFreeAccess: true };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

const scan = {
  id: 'scan-1',
  profileId: profile.id,
  plan: 'Free' as const,
  domain: profile.domain,
  status: 'Running',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 0, totalModules: 1 },
  startedAt: null,
  completedAt: null,
  createdAt: '2026-09-08T00:00:00.000Z',
  modules: [],
};

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

function renderNewScan(
  acct: object,
  language: 'en' | 'uk' = 'en',
  // The saved profiles the workspace opens on. Only the tests about a stored
  // configuration pass their own; everything else runs on the bare profile.
  profiles: readonly object[] = [profile],
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    if (path === '/auth/me') return Promise.resolve(envelope(acct));
    if (path === '/profiles') return Promise.resolve(envelope(profiles));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === '/profiles/profile-1/scans') return Promise.resolve(envelope([]));
    if (path.endsWith('/free-check')) return Promise.resolve(envelope(scan));
    if (path === '/billing/internal-checkout')
      return Promise.resolve(envelope({ scanId: scan.id }));
    if (path.startsWith('/scans/')) return Promise.resolve(envelope(scan));
    void init;
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  saveCookieConsent({ preferences: true, analytics: false });
  window.localStorage.setItem('fluxradar.language', language);
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

const PAID_ONLY_CONTROLS = [
  ['include subdomains', /Include subdomains/],
  ['maximum pages', /^Maximum pages/],
  ['maximum crawl depth', /^Maximum crawl depth/],
  ['include patterns', /^Include path patterns/],
  ['exclude patterns', /^Exclude path patterns/],
  ['URL query parameters', /^URL query parameters/],
  ['robots.txt', /Respect robots\.txt/],
] as const;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('free plan controls', () => {
  it.each(PAID_ONLY_CONTROLS)('does not offer %s on Free', async (_label, pattern) => {
    renderNewScan(account);
    await screen.findByText('New scan — scope and tariff');

    expect(screen.queryByLabelText(pattern)).not.toBeInTheDocument();
  });

  it('explains what the free check actually reads', async () => {
    renderNewScan(account);
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByText('What the free check does')).toBeInTheDocument();
    expect(screen.getByText(/reads your homepage and nothing else/)).toBeInTheDocument();
    expect(screen.getAllByText('Homepage only').length).toBeGreaterThan(0);
    expect(screen.getByText('Always respected')).toBeInTheDocument();
    expect(
      screen.getByText(/belong to the paid plans and are not available on Free/),
    ).toBeInTheDocument();
  });

  it('explains it in Ukrainian too', async () => {
    renderNewScan(account, 'uk');
    await screen.findByText('Нова перевірка — область і тариф');

    expect(screen.getByText('Що робить безкоштовна перевірка')).toBeInTheDocument();
    expect(screen.getByText(/читає лише головну сторінку/)).toBeInTheDocument();
    expect(screen.getAllByText('Лише головна').length).toBeGreaterThan(0);
    expect(screen.getByText(/недоступні на Free/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Включати піддомени/)).not.toBeInTheDocument();
  });

  // The request says the same thing the screen says. The server decides this
  // for itself (apps/api/src/scans/free-scan-scope.ts); what must not happen is
  // the browser asking for limits that would be quietly replaced.
  it('asks for the homepage check and nothing more', async () => {
    const fetchMock = renderNewScan(account);
    await screen.findByText('New scan — scope and tariff');

    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/free-check'))).toBe(
        true,
      ),
    );
    const call = fetchMock.mock.calls.find(([input]) => pathOf(input).endsWith('/free-check'));
    expect(bodyOf(call?.[1] as RequestInit)).toEqual({
      scope: {
        includeSubdomains: false,
        maxPages: 1,
        maxDepth: 0,
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop',
      },
    });
  });
});

describe('paid plan controls', () => {
  it('keeps every crawl control the paid plans do reach', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    // An internal account opens on Complete, so the paid controls are the
    // starting state rather than something that has to be switched on.
    for (const [, pattern] of PAID_ONLY_CONTROLS) {
      expect(screen.getByLabelText(pattern)).toBeInTheDocument();
    }
    expect(
      screen.getByRole('group', { name: 'AI processing included in this audit' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('What the free check does')).not.toBeInTheDocument();
  });

  it('discloses included AI processing before a paid audit starts', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    const callout = screen.getByRole('group', {
      name: 'AI processing included in this audit',
    });
    expect(within(callout).getByText(/instruct FluxRadar to use Anthropic/)).toBeInTheDocument();
    expect(
      within(callout).getByText(/AI can be wrong, omit a mention or be temporarily unavailable/),
    ).toBeInTheDocument();
    expect(within(callout).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      '/privacy?lang=en',
    );
    expect(within(callout).getByRole('link', { name: 'Terms of service' })).toHaveAttribute(
      'href',
      '/terms?lang=en',
    );
    expect(within(callout).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('discloses the external performance provider before a Complete scan can start', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    const callout = screen.getByRole('group', { name: 'External performance measurement' });
    expect(within(callout).getByText(/Google PageSpeed Insights/)).toHaveTextContent(
      /do not connect a Google account or install anything/i,
    );
    expect(within(callout).getByText(/return no field data or fail to answer/i)).toBeVisible();
  });

  it('explains how robots.txt changes the crawl before the controls', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    const callout = screen.getByRole('group', { name: 'How robots.txt affects this scan' });
    expect(within(callout).getByText(/reads the site’s public robots\.txt/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Respect robots\.txt/)).toHaveAttribute(
      'aria-describedby',
      'robots-info-description',
    );
    fireEvent.click(screen.getByLabelText(/Respect robots\.txt/));
    expect(screen.getByLabelText(/I confirm the robots\.txt override/)).toHaveAttribute(
      'aria-describedby',
      'robots-info-description',
    );
  });

  it('localizes the included AI processing disclosure', async () => {
    renderNewScan(internalAccount, 'uk');
    await screen.findByText('Нова перевірка — область і тариф');

    const callout = screen.getByRole('group', { name: 'AI-обробка включена в цей аудит' });
    expect(within(callout).getByRole('link', { name: 'Політика приватності' })).toHaveAttribute(
      'href',
      '/privacy?lang=uk',
    );
  });

  it('localizes the robots.txt explanation', async () => {
    renderNewScan(internalAccount, 'uk');
    await screen.findByText('Нова перевірка — область і тариф');

    const callout = screen.getByRole('group', { name: 'Як robots.txt впливає на перевірку' });
    expect(within(callout).getByText(/читає публічний robots\.txt сайту/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Дотримуватись robots\.txt/)).toHaveAttribute(
      'aria-describedby',
      'robots-info-description',
    );
  });

  it('sends the settings the owner set', async () => {
    const fetchMock = renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    fireEvent.click(screen.getByLabelText(/Include subdomains/));
    fireEvent.change(screen.getByLabelText(/^Maximum pages/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/^Maximum crawl depth/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^Include path patterns/), {
      target: { value: '/docs/*' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => pathOf(input) === '/billing/internal-checkout'),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(
      ([input]) => pathOf(input) === '/billing/internal-checkout',
    );
    expect(bodyOf(call?.[1] as RequestInit)).toMatchObject({
      siteProfileId: profile.id,
      plan: 'Complete',
      aiConsent: {
        providers: ['anthropic', 'openai'],
        noticeVersion: 'core-ai-processing-notice-v4',
      },
      scope: {
        includeSubdomains: true,
        maxPages: 30,
        maxDepth: 2,
        urlPatterns: ['/docs/*'],
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop',
      },
    });
  });

  // Switching down to Free must not smuggle the paid settings out with it.
  it('drops back to the homepage check when the plan changes to Free', async () => {
    const fetchMock = renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    fireEvent.click(screen.getByLabelText(/Include subdomains/));
    fireEvent.click(screen.getByLabelText(/Respect robots\.txt/));
    fireEvent.change(screen.getByRole('combobox', { name: /^Scan plan/ }), {
      target: { value: 'Free' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/free-check'))).toBe(
        true,
      ),
    );
    const call = fetchMock.mock.calls.find(([input]) => pathOf(input).endsWith('/free-check'));
    expect(bodyOf(call?.[1] as RequestInit)).toEqual({
      scope: {
        includeSubdomains: false,
        maxPages: 1,
        maxDepth: 0,
        queryPolicy: 'ignore',
        respectRobots: true,
        robotsOverrideConfirmed: false,
        userAgent: 'desktop',
      },
    });
  });
});

// Path patterns and the URL query policy sit behind a disclosure: most scans
// run on the defaults, and the three fields were 138px between the limits being
// bought and the robots.txt rule that governs them. A saved configuration that
// set them is the case that must not stay hidden — the owner pays for exactly
// the crawl the group describes.
describe('advanced crawl rules', () => {
  function renderWithConfig(scanConfig: object): void {
    renderNewScan(internalAccount, 'en', [{ ...profile, scanConfig }]);
  }

  const defaultScope = {
    includeSubdomains: false,
    queryPolicy: 'ignore' as const,
    respectRobots: true,
    robotsOverrideConfirmed: false,
    userAgent: 'desktop' as const,
  };

  it('starts folded when the saved configuration holds the defaults', async () => {
    renderWithConfig({ plan: 'Complete', scope: defaultScope });
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByText('Advanced crawl rules')).toBeVisible();
    expect(screen.getByLabelText(/^Include path patterns/)).not.toBeVisible();
  });

  it('opens on a saved configuration that set a path pattern', async () => {
    renderWithConfig({
      plan: 'Complete',
      scope: { ...defaultScope, excludePatterns: ['/admin/*'] },
    });
    await screen.findByText('New scan — scope and tariff');

    // The group opens from an effect, a tick after the saved values land, so
    // both facts are awaited together rather than read between the two renders.
    await waitFor(() => {
      expect(screen.getByLabelText(/^Exclude path patterns/)).toHaveValue('/admin/*');
      expect(screen.getByLabelText(/^Exclude path patterns/)).toBeVisible();
    });
  });

  // Regression: the group used to be opened by a one-way effect watching the
  // live scope. Moving from one configured profile to another never changed
  // that flag, so a second profile's own patterns stayed folded away under a
  // group the owner had closed on the first one.
  it('opens again for the next profile that sets its own patterns', async () => {
    const second = {
      id: 'profile-2',
      name: 'Other Site',
      domain: 'https://other.example',
      scanConfig: { plan: 'Complete', scope: { ...defaultScope, excludePatterns: ['/private/*'] } },
    };
    renderNewScan(internalAccount, 'en', [
      {
        ...profile,
        scanConfig: { plan: 'Complete', scope: { ...defaultScope, excludePatterns: ['/admin/*'] } },
      },
      second,
    ]);
    await screen.findByText('New scan — scope and tariff');
    await waitFor(() => expect(screen.getByLabelText(/^Exclude path patterns/)).toBeVisible());

    fireEvent.click(screen.getByText('Advanced crawl rules'));
    await waitFor(() => expect(screen.getByLabelText(/^Exclude path patterns/)).not.toBeVisible());

    fireEvent.change(screen.getByLabelText(/^Profile/), { target: { value: 'profile-2' } });

    await waitFor(() =>
      expect(screen.getByLabelText(/^Exclude path patterns/)).toHaveValue('/private/*'),
    );
    expect(screen.getByLabelText(/^Exclude path patterns/)).toBeVisible();
  });

  it('opens on a saved configuration that keeps URL query parameters', async () => {
    renderWithConfig({
      plan: 'Complete',
      scope: { ...defaultScope, queryPolicy: 'include' as const },
    });
    await screen.findByText('New scan — scope and tariff');

    await waitFor(() => expect(screen.getByLabelText(/^URL query parameters/)).toBeVisible());
  });
});

// Which callouts start open is a decision about disclosure, not about height:
// the two that say what leaves the site and who processes it are read before
// money changes hands, and the operational one is not. Both directions are
// pinned, because folding either of the first two would otherwise be a silent
// change that no test noticed (see ScanCallout.tsx).
describe('what a callout discloses before the purchase', () => {
  it('opens the AI-processing disclosure and folds the robots.txt explanation', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');

    expect(screen.getByText(/instruct FluxRadar to use Anthropic/)).toBeVisible();
    expect(screen.getByText(/do not connect a Google account/)).toBeVisible();
    expect(screen.getByText(/reads the site’s public robots\.txt/)).not.toBeVisible();
  });

  it('opens the AI-processing disclosure in Ukrainian too', async () => {
    renderNewScan(internalAccount, 'uk');
    await screen.findByText('Нова перевірка — область і тариф');

    expect(screen.getByText(/доручаєте FluxRadar/)).toBeVisible();
  });
});

// The robots.txt override lives in the settings column and the button it blocks
// is pinned in the launch column beside it, so a disabled button with no reason
// beside it is a dead end two columns wide.
describe('a submit the settings are blocking', () => {
  it('says which setting is holding the scan back', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(screen.getByLabelText(/Respect robots\.txt/));

    const button = screen.getByRole('button', { name: 'Run internal scan' });
    expect(button).toBeDisabled();
    const reason = screen.getByText(/To start this scan/);
    expect(reason).toBeVisible();
    expect(button).toHaveAttribute('aria-describedby', reason.id);
  });

  it('drops the reason once the override is confirmed', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');
    fireEvent.click(screen.getByLabelText(/Respect robots\.txt/));
    fireEvent.click(screen.getByLabelText(/I confirm the robots\.txt override/));

    const button = screen.getByRole('button', { name: 'Run internal scan' });
    expect(button).toBeEnabled();
    expect(screen.queryByText(/To start this scan/)).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('moves to the field a rejected page count is reported on', async () => {
    renderNewScan(internalAccount);
    await screen.findByText('New scan — scope and tariff');
    const pages = screen.getByLabelText(/^Maximum pages/);
    fireEvent.change(pages, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run internal scan' }));

    await screen.findByText(/Enter a whole number of pages/);
    expect(pages).toHaveFocus();
  });
});
