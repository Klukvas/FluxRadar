// The AI query-ideas block, in every state it can be in.
//
// One thing matters more than the rest and most of this file is about it: a
// suggested query must never be mistakeable for a measured one. So the block is
// labelled where it is read, it carries no numeric column, it is generated only
// when asked, and each of the four ways of having nothing to show says which of
// the four it is.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GoogleDataPanel } from './GoogleDataPanel';
import { QueryIdeasPanel } from './QueryIdeas';
import type { GoogleDataSnapshot, QueryIdeasResult } from './api';
import { copy } from './i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const GENERATED: QueryIdeasResult = {
  state: 'generated',
  model: 'claude-sonnet-5',
  generatedAt: '2026-09-08T12:00:00.000Z',
  ideas: [
    { query: 'website audit tool', language: 'en', rationale: 'Adjacent to what already ranks.' },
    { query: 'аудит сайту онлайн', language: 'uk', rationale: 'Українською цього ще немає.' },
    { query: 'аудит сайта онлайн', language: 'ru', rationale: 'Близко к измеренному запросу.' },
  ],
};

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stubs the endpoint and reports what the component actually requested. */
function stubIdeas(result: QueryIdeasResult | 'error'): { calls: RequestInit[]; paths: string[] } {
  const calls: RequestInit[] = [];
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      paths.push(new URL(String(input)).pathname);
      calls.push(init);
      if (result === 'error') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'X', message: 'no' } }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(envelope(result));
    }),
  );
  return { calls, paths };
}

const t = copy.en.report.queryIdeas;

describe('before anything is generated', () => {
  it('asks for nothing until the reader asks for it', () => {
    const { paths } = stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);

    expect(paths).toEqual([]);
    expect(screen.getByText(t.idleBody)).toBeTruthy();
  });

  // Pressing the button sends the measured queries to a third party, so the
  // sentence above it says so before it is pressed rather than afterwards.
  it('says what generating will do before it is done', () => {
    stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);

    expect(t.idleBody).toMatch(/sends your site address and the queries above/i);
    expect(copy.uk.report.queryIdeas.idleBody).toMatch(/надсилає адресу вашого сайту/);
  });

  it('is labelled as generated rather than measured, wherever it is read', () => {
    stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);

    const region = screen.getByRole('region', { name: /AI query ideas/ });
    expect(within(region).getByText(t.badge)).toBeTruthy();
    expect(t.badge).toMatch(/not Search Console data/i);
    expect(within(region).getByText(t.lead)).toBeTruthy();
    expect(t.lead).toMatch(/hypotheses to test, not measurements/i);
  });
});

describe('after the model answers', () => {
  it('posts to the scan’s own endpoint', async () => {
    const { paths, calls } = stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-42" language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    await screen.findByText('website audit tool');
    expect(paths).toEqual(['/scans/scan-42/search-console/query-ideas']);
    expect(calls[0]?.method).toBe('POST');
  });

  it('lists the three languages in a fixed order, each one named', async () => {
    stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    const rows = await screen.findAllByRole('row');
    // Header row first, then ru, uk, en whatever order the model used.
    expect(rows.slice(1).map((row) => row.textContent)).toEqual([
      'аудит сайта онлайнRussianБлизко к измеренному запросу.',
      'аудит сайту онлайнUkrainianУкраїнською цього ще немає.',
      'website audit toolEnglishAdjacent to what already ranks.',
    ]);
  });

  // The failure this whole block is shaped to avoid: a column of numbers that
  // reads like the measured table above it.
  it('has no column that could be read as a measurement', async () => {
    stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    const headers = (await screen.findAllByRole('columnheader')).map((cell) => cell.textContent);
    expect(headers).toEqual([t.columnQuery, t.columnLanguage, t.columnRationale]);
    for (const measured of ['Clicks', 'Impressions', 'CTR', 'Position']) {
      expect(headers).not.toContain(measured);
    }
  });

  it('names the model and when, so the rows are dated and attributed', async () => {
    stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    const note = await screen.findByText(/claude-sonnet-5/);
    expect(note.textContent).toContain('2026-09-08 12:00');
    expect(note.textContent).toMatch(/Not measured, not from Google/);
  });

  it('offers to generate again rather than pretending the first answer is final', async () => {
    stubIdeas(GENERATED);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    expect(await screen.findByRole('button', { name: t.regenerate })).toBeTruthy();
  });
});

describe('when there is nothing to show', () => {
  it.each([
    ['not_configured', t.notConfiguredTitle],
    ['unavailable', t.unavailableTitle],
    ['empty', t.emptyTitle],
    ['failed', t.failedTitle],
  ] as const)('says which kind of nothing %s is', async (state, title) => {
    stubIdeas({ state } as QueryIdeasResult);
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  // Four states, four sentences: a deployment with no provider and a provider
  // that refused are not the same thing to the person reading it.
  it('gives each state its own sentence', () => {
    const titles = [t.notConfiguredTitle, t.unavailableTitle, t.emptyTitle, t.failedTitle];
    expect(new Set(titles).size).toBe(titles.length);
    const bodies = [t.notConfiguredBody, t.unavailableBody, t.emptyBody, t.failedBody];
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('treats a failed request as no ideas, never as a broken report', async () => {
    stubIdeas('error');
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    expect(await screen.findByText(t.failedTitle)).toBeTruthy();
  });

  it('disables the button while it waits so one press is one model call', async () => {
    let release: (value: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    render(<QueryIdeasPanel scanId="scan-1" language="en" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));

    const button = await screen.findByRole('button', { name: t.generating });
    expect(button).toBeDisabled();
    release(envelope(GENERATED));
    await waitFor(() => expect(screen.getByRole('button', { name: t.regenerate })).toBeTruthy());
  });
});

describe('in Ukrainian', () => {
  it('writes the block, its badge and its states in the chosen language', async () => {
    const uk = copy.uk.report.queryIdeas;
    stubIdeas({ state: 'not_configured' });
    render(<QueryIdeasPanel scanId="scan-1" language="uk" />);

    expect(screen.getByText(uk.lead)).toBeTruthy();
    expect(screen.getByText(uk.badge)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: uk.generate }));

    expect(await screen.findByText(uk.notConfiguredTitle)).toBeTruthy();
    expect(screen.queryByText(t.notConfiguredTitle)).toBeNull();
  });
});

describe('where the block sits inside the Google panel', () => {
  const SNAPSHOT: GoogleDataSnapshot = {
    source: 'google',
    readOnly: true,
    fetchedAt: '2026-09-06T09:30:00.000Z',
    dateRange: { startDate: '2026-08-07', endDate: '2026-09-03' },
    searchConsole: {
      state: 'connected',
      detail: 'ok',
      data: {
        siteUrl: 'sc-domain:example.com',
        totals: { clicks: 1234, impressions: 56789, ctr: 0.0217, position: 12.34 },
        topQueries: [
          { key: 'flux radar', clicks: 300, impressions: 4000, ctr: 0.075, position: 3.2 },
        ],
        topPages: [],
      },
    },
    analytics: { state: 'no_data', detail: 'none', data: null },
  };

  // The measured rows and the generated ones live in different tables, in
  // different regions. Nothing generated is ever appended to a real one.
  it('never puts an idea in the measured Search Console table', async () => {
    stubIdeas(GENERATED);
    render(<GoogleDataPanel snapshot={SNAPSHOT} language="en" scanId="scan-1" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));
    await screen.findByText('website audit tool');

    const measured = screen.getByRole('table', { name: 'Top queries' });
    expect(within(measured).queryByText('website audit tool')).toBeNull();
    expect(within(measured).getByText('flux radar')).toBeTruthy();

    const ideas = screen.getByRole('table', { name: t.tableLabel });
    expect(within(ideas).queryByText('flux radar')).toBeNull();
  });

  it('leaves the measured totals untouched by anything generated', async () => {
    stubIdeas(GENERATED);
    render(<GoogleDataPanel snapshot={SNAPSHOT} language="en" scanId="scan-1" />);
    fireEvent.click(screen.getByRole('button', { name: t.generate }));
    await screen.findByText('website audit tool');

    const metrics = screen.getByLabelText(copy.en.report.google.metricsLabel);
    expect(within(metrics).getByText('1,234')).toBeTruthy();
    expect(metrics.textContent).not.toContain('website audit tool');
  });

  it('is omitted entirely when the panel has no scan to ask about', () => {
    stubIdeas(GENERATED);
    render(<GoogleDataPanel snapshot={SNAPSHOT} language="en" />);

    expect(screen.queryByRole('region', { name: /AI query ideas/ })).toBeNull();
  });
});
