// "Next step" and "Site status" are about one site at a time.
//
// With a salon site and a developer's site saved, both cards were built from
// the account's newest scan — the developer's — so the salon owner was told to
// "work through your report" for flux-lab.dev while the salon's own check had
// read nothing. Each site now gets its own block, named in its heading.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesktopScreen } from './DesktopScreen';
import { nextStepFor } from './NextStep';
import type { Scan, SiteProfile } from './api';

const salon = { id: 'p-salon', name: 'Eva Grace', domain: 'https://eva-grace.example' };
const lab = { id: 'p-lab', name: 'Flux Lab', domain: 'https://flux-lab.dev' };
const bothSites = [salon, lab] as SiteProfile[];

const readAll = {
  reach: 'reachable' as const,
  startStatus: 200,
  accessControlSignals: [],
  pagesRead: 12,
  pagesFetched: 12,
  urlsDiscovered: 12,
  urlsOverLimit: 0,
  urlsBlockedByRobots: 0,
  limitedBy: null,
  maxPages: 100,
};

function scan(overrides: Partial<Scan>): Scan {
  return {
    id: 'scan-lab',
    profileId: lab.id,
    plan: 'Complete',
    domain: lab.domain,
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 6, totalModules: 6 },
    crawlSummary: readAll,
    startedAt: '2026-10-04T10:00:00.000Z',
    completedAt: '2026-10-04T10:05:00.000Z',
    createdAt: '2026-10-04T10:00:00.000Z',
    modules: [],
    ...overrides,
  } as Scan;
}

/** The newest scan of the account: the developer's site, read in full. */
const labScan = scan({});

/**
 * The salon's own, older scan, as the API settles it when the site refused the
 * crawler: Failed, with the reach reason, after reading no page.
 */
const salonDeniedScan = scan({
  id: 'scan-salon',
  profileId: salon.id,
  plan: 'Basic',
  domain: salon.domain,
  status: 'Failed',
  statusReason: 'SiteDeniedAccess',
  crawlSummary: { ...readAll, reach: 'access-denied', startStatus: 403, pagesRead: 0 },
  createdAt: '2026-10-01T09:00:00.000Z',
  startedAt: '2026-10-01T09:00:00.000Z',
  completedAt: '2026-10-01T09:02:00.000Z',
});

function envelope(data: unknown, meta?: object): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta === undefined ? {} : { meta }) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

type Answer = () => Response | Promise<Response>;

/** Answers per site; anything else gets an empty envelope, as the API mocks do. */
function stubApi(perSite: Record<string, Answer>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = pathOf(input);
    if (path === '/scans') {
      return Promise.resolve(envelope([labScan], { total: 7, page: 1, limit: 1 }));
    }
    const site = /^\/profiles\/([^/]+)\/scans$/.exec(path)?.[1];
    const answer = site === undefined ? undefined : perSite[site];
    return Promise.resolve(answer === undefined ? envelope(null) : answer());
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function siteReads(fetchMock: ReturnType<typeof vi.fn>, profileId: string): number {
  return fetchMock.mock.calls.filter(
    ([input]) => pathOf(input as RequestInfo) === `/profiles/${profileId}/scans`,
  ).length;
}

function renderDesktop(profiles: readonly SiteProfile[], language: 'en' | 'uk' = 'en') {
  const onOpenScan = vi.fn();
  const onNewScan = vi.fn();
  const view = render(
    <DesktopScreen
      profiles={profiles}
      onRefresh={() => Promise.resolve()}
      onProfileDeleted={() => {}}
      onSelectProfile={() => {}}
      onNewScan={onNewScan}
      onOpenScan={onOpenScan}
      onRetryScan={() => Promise.resolve()}
      onError={() => {}}
      onNotice={() => {}}
      onOnboarding={() => {}}
      language={language}
    />,
  );
  return { onOpenScan, onNewScan, unmount: view.unmount };
}

async function siteBlock(heading: string): Promise<HTMLElement> {
  const title = await screen.findByRole('heading', { level: 2, name: heading });
  const block = title.closest('section');
  if (block === null) throw new Error(`No block around "${heading}"`);
  return block;
}

/** The optional domain-ownership panel, which follows one site of the screen. */
function ownershipPanel(): HTMLElement {
  const panel = screen.getByText('Domain ownership (optional)').closest('.panel');
  if (!(panel instanceof HTMLElement)) throw new Error('No ownership panel');
  return panel;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the desktop with two saved sites', () => {
  it('names each site and opens that site’s own scan, not the account’s newest', async () => {
    stubApi({
      [salon.id]: () => envelope([salonDeniedScan]),
      [lab.id]: () => envelope([labScan]),
    });
    const { onOpenScan } = renderDesktop(bothSites);

    const salonBlock = await siteBlock('Eva Grace · eva-grace.example');
    const labBlock = await siteBlock('Flux Lab · flux-lab.dev');

    // The salon is the site the owner clicks; its button opens the salon's scan.
    fireEvent.click(
      await within(salonBlock).findByRole('button', {
        name: 'Open the scan for eva-grace.example',
      }),
    );
    expect(onOpenScan).toHaveBeenLastCalledWith('scan-salon');
    expect(salonBlock).not.toHaveTextContent('flux-lab.dev');

    // The control: a scan that read the site is still a report to work through.
    fireEvent.click(
      within(labBlock).getByRole('button', { name: 'Open the report for flux-lab.dev' }),
    );
    expect(onOpenScan).toHaveBeenLastCalledWith('scan-lab');
    expect(labBlock).toHaveTextContent('Work through your report');
    expect(within(labBlock).getByText('Completed')).toBeInTheDocument();

    // The account-wide "Last checked: flux-lab.dev" row is gone with two sites.
    expect(screen.queryByText('Last checked')).not.toBeInTheDocument();
  });

  it('tells the owner a site that refused the crawler is theirs to look at', async () => {
    stubApi({
      [salon.id]: () => envelope([salonDeniedScan]),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites);

    const salonBlock = await siteBlock('Eva Grace · eva-grace.example');
    await within(salonBlock).findByText('Review what went wrong');
    expect(salonBlock).toHaveTextContent('We could not read any page of eva-grace.example');
    // A refund is recorded, not paid out by itself: the copy must not say more.
    expect(salonBlock).toHaveTextContent('a refund is recorded for it automatically');
    expect(salonBlock).not.toHaveTextContent('in full');
    expect(salonBlock).not.toHaveTextContent('the money is returned');
    expect(salonBlock).toHaveTextContent('issued by hand through Creem');
    expect(within(salonBlock).getByText('Not available')).toHaveClass('status-chip--error');
    expect(salonBlock).not.toHaveTextContent('Work through your report');
    expect(salonBlock).not.toHaveTextContent('The last scan did not finish');
    expect(
      within(salonBlock).queryByRole('button', { name: /Open the report/ }),
    ).not.toBeInTheDocument();
  });

  it('reads an unreachable site from its status reason alone', async () => {
    stubApi({
      [salon.id]: () =>
        envelope([{ ...salonDeniedScan, statusReason: 'SiteUnreachable', crawlSummary: null }]),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites);

    const salonBlock = await siteBlock('Eva Grace · eva-grace.example');
    await within(salonBlock).findByText('Review what went wrong');
    expect(
      within(salonBlock).getByRole('button', { name: 'Open the scan for eva-grace.example' }),
    ).toBeInTheDocument();
  });

  it('keeps the platform-failure step for a failure the site did not cause', async () => {
    stubApi({
      [salon.id]: () =>
        envelope([{ ...salonDeniedScan, statusReason: 'NoUsableOutput', crawlSummary: readAll }]),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites);

    const salonBlock = await siteBlock('Eva Grace · eva-grace.example');
    await within(salonBlock).findByText('The last scan did not finish');
    expect(within(salonBlock).getByText('Not available')).toHaveClass('status-chip--error');
  });

  it('offers the free check to a site never checked, for that site', async () => {
    stubApi({ [salon.id]: () => envelope([]), [lab.id]: () => envelope([labScan]) });
    const { onNewScan } = renderDesktop(bothSites);

    const salonBlock = await siteBlock('Eva Grace · eva-grace.example');
    fireEvent.click(
      await within(salonBlock).findByRole('button', { name: 'Check eva-grace.example' }),
    );
    expect(onNewScan).toHaveBeenLastCalledWith(salon, 'Free');
  });

  it('keeps the account’s own facts under the sites', async () => {
    stubApi({
      [salon.id]: () => envelope([salonDeniedScan]),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites);

    const saved = await screen.findByText('Sites saved');
    expect(saved.closest('.field-row')).toHaveTextContent('2');
    const listed = await screen.findByText('Reports listed');
    expect(listed.closest('.field-row')).toHaveTextContent('7');
  });

  it('names the site and labels the buttons with its address, UK', async () => {
    stubApi({
      [salon.id]: () => envelope([salonDeniedScan]),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites, 'uk');

    const salonBlock = await siteBlock('Eva Grace · eva-grace.example');
    await within(salonBlock).findByText('Перегляньте, що пішло не так');
    expect(salonBlock).toHaveTextContent('що саме відповів сайт');
    expect(
      within(salonBlock).getByRole('button', { name: 'Відкрити перевірку для eva-grace.example' }),
    ).toBeInTheDocument();
    const labBlock = await siteBlock('Flux Lab · flux-lab.dev');
    expect(
      await within(labBlock).findByRole('button', { name: 'Відкрити звіт для flux-lab.dev' }),
    ).toBeInTheDocument();
  });
});

describe('reading each site', () => {
  it('says one site could not be read, and retries only that site', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let salonAnswer: Answer = () => envelope({ not: 'a list' });
    const fetchMock = stubApi({
      [salon.id]: () => salonAnswer(),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites);

    const salonBlock = await siteBlock('Eva Grace · eva-grace.example');
    expect(await within(salonBlock).findByRole('alert')).toHaveTextContent(
      'Site status could not be loaded',
    );
    const labBlock = await siteBlock('Flux Lab · flux-lab.dev');
    await within(labBlock).findByRole('button', { name: 'Open the report for flux-lab.dev' });

    salonAnswer = () => envelope([salonDeniedScan]);
    fireEvent.click(within(salonBlock).getByRole('button', { name: 'Try again' }));
    // The site that answered stays on screen while the other is read again.
    expect(
      within(labBlock).getByRole('button', { name: 'Open the report for flux-lab.dev' }),
    ).toBeInTheDocument();
    await within(salonBlock).findByText('Review what went wrong');
    expect(siteReads(fetchMock, salon.id)).toBe(2);
    expect(siteReads(fetchMock, lab.id)).toBe(1);
  });

  it('points the ownership panel at the newest of the sites’ own scans', async () => {
    const fetchMock = stubApi({
      [salon.id]: () => envelope([salonDeniedScan]),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites);

    // The salon is listed first, but the lab was checked last.
    await waitFor(() => expect(ownershipPanel()).toHaveTextContent('https://flux-lab.dev'));
    expect(
      fetchMock.mock.calls.some(
        ([input]) => pathOf(input as RequestInfo) === `/profiles/${lab.id}/verification`,
      ),
    ).toBe(true);
  });

  it('keeps the ownership panel on the first site when a site could not be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubApi({
      [salon.id]: () => envelope({ not: 'a list' }),
      [lab.id]: () => envelope([labScan]),
    });
    renderDesktop(bothSites);

    const labBlock = await siteBlock('Flux Lab · flux-lab.dev');
    await within(labBlock).findByRole('button', { name: 'Open the report for flux-lab.dev' });
    await screen.findByRole('alert');
    // The lab's scan is the newest the screen can see, but not necessarily the
    // account's newest: the panel stays on the first site instead of switching.
    await waitFor(() => expect(ownershipPanel()).toHaveTextContent('https://eva-grace.example'));
    expect(ownershipPanel()).not.toHaveTextContent('https://flux-lab.dev');
  });
});

describe('the desktop with one saved site', () => {
  it('keeps one next-step panel and the account’s site status, with no per-site reads', async () => {
    const fetchMock = stubApi({});
    renderDesktop([lab as SiteProfile]);

    expect(await screen.findByText('Work through your report')).toBeInTheDocument();
    expect(await screen.findByText('Last checked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the report for flux-lab.dev' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /flux-lab\.dev/ })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([input]) => pathOf(input as RequestInfo))).toContain(
        '/scans',
      ),
    );
    expect(siteReads(fetchMock, lab.id)).toBe(0);
  });
});

describe('the next step for a scan that could not read the site', () => {
  it('is to review what went wrong, from the crawl summary', () => {
    expect(nextStepFor([lab as SiteProfile], salonDeniedScan)).toBe('unread');
  });

  it('is the same when only the status reason says so', () => {
    const unreachable = scan({
      status: 'Failed',
      statusReason: 'SiteUnreachable',
      crawlSummary: null,
    });
    expect(nextStepFor([lab as SiteProfile], unreachable)).toBe('unread');
  });

  it('stays the generic step for a scan the owner cancelled, whatever its crawl read', () => {
    const cancelled = scan({
      status: 'Cancelled',
      statusReason: 'UserCancelledAfterStart',
      crawlSummary: { ...readAll, reach: 'access-denied' },
    });
    expect(nextStepFor([lab as SiteProfile], cancelled)).toBe('failed');
  });

  it('stays the platform failure for any other failed scan', () => {
    const failed = scan({ status: 'Failed', statusReason: 'NoUsableOutput' });
    expect(nextStepFor([lab as SiteProfile], failed)).toBe('failed');
  });

  it('stays a report to work through when the crawl read the site', () => {
    expect(nextStepFor([lab as SiteProfile], labScan)).toBe('paidDone');
  });
});
