// The progress window, read the way the owner of a small site reads it.
//
// Four people watching it could not tell what was happening: it said
// "preparing" half way through a run, counted "audit sections", showed a page
// limit as if it were the size of the job and never said where the report
// would turn up. These pin the plain version: a headline for the stage the
// scan is really in, a bar that keeps moving forward, a rough time, and the
// report list as the place to come back to.

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Scan, ScanModule } from './api';
import type { Language } from './i18n';
import { ScanScreen } from './ScanProgress';

const STARTED = Date.parse('2026-10-18T10:00:00.000Z');
const MINUTE = 60_000;

function module(name: string, status: string): ScanModule {
  return {
    module: name,
    status,
    statusReason: null,
    coverage: null,
    score: null,
    applicableChecks: 1,
    completedApplicableChecks: status === 'Completed' ? 1 : 0,
    usableOutput: status === 'Completed',
    metadata: {},
  };
}

const RUNNING: Scan = {
  id: 'scan-1',
  profileId: 'profile-1',
  plan: 'Basic',
  domain: 'https://example.com',
  status: 'Running',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 0, totalModules: 2, scannedUrls: 0, discoveredUrls: 0 },
  startedAt: new Date(STARTED).toISOString(),
  completedAt: null,
  createdAt: new Date(STARTED).toISOString(),
  modules: [module('SEO', 'Pending'), module('AI SEO / GEO', 'Pending')],
};

function reading(scannedUrls: number, discoveredUrls: number): Scan {
  return { ...RUNNING, progress: { ...RUNNING.progress, scannedUrls, discoveredUrls } };
}

function checking(seo: string, geo: string): Scan {
  const modules = [module('SEO', seo), module('AI SEO / GEO', geo)];
  const done = modules.filter((row) => row.status === 'Completed').length;
  return {
    ...RUNNING,
    progress: { completedModules: done, totalModules: 2, scannedUrls: 30, discoveredUrls: 30 },
    modules,
  };
}

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Each poll answers with the next scan in the list, then keeps the last one. */
function stubPolls(scans: readonly Scan[]): void {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname !== '/scans/scan-1')
        return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
      const scan = scans[Math.min(call, scans.length - 1)] as Scan;
      call += 1;
      return Promise.resolve(envelope(scan));
    }),
  );
}

/** The screen with the state the app keeps around it, so polls re-render it. */
function Harness(props: { initial: Scan; language: Language; onReports: () => void }) {
  const [scan, setScan] = useState<Scan>(props.initial);
  const onUpdate = useCallback((next: Scan) => setScan(next), []);
  const onError = useCallback(() => {}, []);
  return (
    <ScanScreen
      scan={scan}
      language={props.language}
      onUpdate={onUpdate}
      onDone={() => {}}
      onReports={props.onReports}
      onError={onError}
    />
  );
}

function show(scan: Scan, language: Language = 'en', onReports: () => void = () => {}) {
  stubPolls([scan]);
  return render(<Harness initial={scan} language={language} onReports={onReports} />);
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function barValue(): number {
  return Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the headline names the stage the scan is in', () => {
  it('says a queued scan is waiting and will start shortly', async () => {
    show({ ...RUNNING, status: 'Queued', startedAt: null, modules: [] });

    expect(
      await screen.findByText('Your check is in the queue and will start shortly.'),
    ).toBeInTheDocument();
    expect(barValue()).toBe(0);
    expect(
      screen.getByText('The list of checks appears once your check starts.'),
    ).toBeInTheDocument();
  });

  it('says the site is being read, with the pages read so far and no moving target', async () => {
    show(reading(12, 40));

    expect(await screen.findByText('Reading the pages of your site')).toBeInTheDocument();
    expect(screen.getByText('12 pages read so far')).toBeInTheDocument();
    expect(screen.queryByText(/of 40/)).toBeNull();
  });

  it('names the running section in plain words', async () => {
    show(checking('Completed', 'Running'));

    expect(
      await screen.findByText('Now checking: being named by AI assistants'),
    ).toBeInTheDocument();
    // The page count belongs to the crawl and is gone once the sections run.
    expect(screen.queryByText(/pages read so far/)).toBeNull();
  });

  it('names the running section in Ukrainian', async () => {
    show(checking('Running', 'Pending'), 'uk');

    expect(
      await screen.findByText('Зараз перевіряємо: чи вас знаходять у пошуку'),
    ).toBeInTheDocument();
  });

  it('says the report is being put together once the last section is done', async () => {
    show(checking('Completed', 'Completed'));

    expect(await screen.findByText('Putting your report together…')).toBeInTheDocument();
    expect(barValue()).toBe(97);
  });

  it('reads as reading pages for an older API with no progress data', async () => {
    show({ ...RUNNING, progress: { completedModules: 0, totalModules: 0 }, modules: [] });

    expect(await screen.findByText('Reading the pages of your site')).toBeInTheDocument();
    expect(screen.queryByText(/pages read so far/)).toBeNull();
    expect(screen.queryByText(/preparing/i)).toBeNull();
  });

  it('never says "preparing" once work has started', async () => {
    show(reading(3, 3));

    await screen.findByText('Reading the pages of your site');
    expect(document.body.textContent).not.toMatch(/preparing|audit sections/i);
  });
});

describe('the progress bar', () => {
  it('only moves forward across polls and stays below 100 until the scan ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: STARTED + 2 * MINUTE });
    const polls = [
      reading(1, 5),
      reading(30, 80),
      checking('Running', 'Pending'),
      // A retried attempt resets the rows: the bar must not jump back.
      reading(2, 2),
      checking('Completed', 'Running'),
      checking('Completed', 'Completed'),
    ];
    stubPolls(polls);
    render(<Harness initial={RUNNING} language="en" onReports={() => {}} />);

    const seen: number[] = [];
    await settle();
    seen.push(barValue());
    for (let poll = 1; poll < polls.length; poll += 1) {
      await settle(1000);
      seen.push(barValue());
    }

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBeGreaterThan(3);
    expect(Math.max(...seen)).toBeLessThan(100);
  });

  it('shows a finished scan as a full measurement', async () => {
    const done: Scan = {
      ...checking('Completed', 'Completed'),
      status: 'Completed',
      completedAt: new Date(STARTED + 3 * MINUTE).toISOString(),
    };
    show(done);

    expect(await screen.findByRole('meter')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('time and where to find the result', () => {
  it('gives a rough time, not a promise', async () => {
    show(reading(4, 4));

    expect(
      await screen.findByText('This usually takes a few minutes. Large sites take longer.'),
    ).toBeInTheDocument();
  });

  it('gives the rough time in Ukrainian', async () => {
    show(reading(4, 4), 'uk');

    expect(
      await screen.findByText('Зазвичай це займає кілька хвилин. Великі сайти перевіряємо довше.'),
    ).toBeInTheDocument();
  });

  it('adds a calm note only after the scan has run for more than 20 minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: STARTED + 19 * MINUTE });
    show(reading(400, 900));

    await settle();
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();

    await settle(2 * MINUTE);
    expect(
      screen.getByText(
        'This check is taking longer than usual. It is still in progress, so you can close this page and come back later.',
      ),
    ).toBeInTheDocument();
  });

  it('points to Reports and keeps the leave-and-come-back line', async () => {
    const onReports = vi.fn();
    show(reading(4, 4), 'en', onReports);

    expect(
      await screen.findByText('You can close this page; the scan continues.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('When it is ready, you will find the report in Reports.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(onReports).toHaveBeenCalledTimes(1);
  });

  it('points to «Звіти» in Ukrainian', async () => {
    show(reading(4, 4), 'uk');

    expect(
      await screen.findByText('Можна закрити цю сторінку — перевірка продовжиться.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Коли звіт буде готовий, ви знайдете його в розділі «Звіти».'),
    ).toBeInTheDocument();
  });

  it('promises no email, in either language', async () => {
    const { unmount } = show(reading(4, 4));
    await screen.findByText('Reading the pages of your site');
    expect(document.body.textContent).not.toMatch(/e-?mail|inbox/i);
    unmount();

    show(reading(4, 4), 'uk');
    await screen.findByText('Читаємо сторінки вашого сайту');
    expect(document.body.textContent).not.toMatch(/лист|пошт|e-?mail/i);
  });
});

describe('the page limit', () => {
  it('reads as a plan limit, not as the size of the job', async () => {
    show(reading(4, 4));

    expect(await screen.findByText('Plan limit: up to 5,000 pages.')).toBeInTheDocument();
    expect(screen.queryByText(/Scope:/)).toBeNull();
  });

  it('groups the Ukrainian number with a space', async () => {
    show(reading(4, 4), 'uk');

    const line = await screen.findByText(/^Ліміт тарифу:/);
    expect(line.textContent).toBe('Ліміт тарифу: до 5\u00a0000 сторінок.');
    expect(document.body.textContent).not.toContain('5,000');
  });

  it('names a limit the owner set as theirs', async () => {
    show({ ...reading(4, 4), scope: { includeSubdomains: false, maxPages: 21 } }, 'uk');

    expect(await screen.findByText('Ліміт, який ви задали: до 21 сторінки.')).toBeInTheDocument();
  });

  it('says a Free check reads the homepage only', async () => {
    show({ ...reading(1, 1), plan: 'Free', modules: [module('SEO', 'Pending')] });

    expect(await screen.findByText('This check reads your homepage only.')).toBeInTheDocument();
  });
});

describe('a legacy paused scan', () => {
  it('still reads as resuming, with cancel available', async () => {
    show({ ...reading(4, 4), status: 'Paused', statusReason: 'UserPausedAfterQueue' }, 'uk');

    expect(await screen.findByText('Відновлюємо перевірку…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Інші дії'));
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати перевірку' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/автоматичне повернення не передбачене/)).toBeInTheDocument();
  });
});
