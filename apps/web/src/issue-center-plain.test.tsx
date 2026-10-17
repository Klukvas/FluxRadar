// The Issue Center, read by an owner who does not build websites.
//
// Four persona reviews found the problem list leading with the check's
// measurement ("shorter than 10 or longer than 70 characters"), the plain
// meaning folded where nobody opened it, no visible "what to do", and a
// "Show findings" button that did not say what it opened. These pin the
// reading order the list has now, in both languages.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Issue, IssueSummary, Scan } from './api';
import { checksCopyUk } from './checks-copy.uk';
import { copy, type Language } from './i18n';
import { IssuesScreen } from './Issues';

const SCAN = { id: 'scan-1', domain: 'https://mysalon.com.ua' } as Scan;

const SUMMARY: IssueSummary = {
  total: 4,
  open: 4,
  bySeverity: { Critical: 0, High: 1, Medium: 2, Low: 1 },
  groups: [
    { ruleId: 'SEO-ONPAGE-001', module: 'SEO', severity: 'High', issues: 1, openIssues: 1 },
    { ruleId: 'SEO-ONPAGE-002', module: 'SEO', severity: 'Medium', issues: 1, openIssues: 1 },
    { ruleId: 'A11Y-002', module: 'Accessibility', severity: 'Medium', issues: 1, openIssues: 1 },
    { ruleId: 'SEO-ONPAGE-003', module: 'SEO', severity: 'Low', issues: 1, openIssues: 1 },
  ],
};

const FINDING: Issue = {
  id: 'issue-1',
  scanId: SCAN.id,
  ruleId: 'SEO-ONPAGE-001',
  module: 'SEO',
  fingerprint: 'fp-1',
  severity: 'High',
  category: 'on-page',
  status: 'New',
  targetUrl: 'https://mysalon.com.ua/',
  evidenceType: 'dom',
  evidenceRef: 'issue/issue-1',
  evidenceExcerpt: '<title> is missing',
  recommendation: 'Add a descriptive title.',
  confidence: 1,
  affectedTargets: 1,
  applicableTargets: 1,
  rulePenalty: 0,
  scoreDelta: 0,
  observedAt: '2026-10-18T00:00:00.000Z',
};

function json(data: unknown, meta?: Record<string, number>): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta ? { meta } : {}) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** Answers the summary and every findings page; nothing goes unmocked. */
function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/issues/summary')) return Promise.resolve(json(SUMMARY));
    return Promise.resolve(json([FINDING], { total: 1, page: 1, limit: 50 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function problemRows(language: Language): Promise<HTMLElement[]> {
  render(<IssuesScreen scan={SCAN} language={language} onError={() => {}} />);
  const rows = (await screen.findAllByRole('row')).slice(1);
  expect(rows).toHaveLength(4);
  return rows;
}

function row(rows: readonly HTMLElement[], index: number): HTMLElement {
  const element = rows[index];
  if (element === undefined) throw new Error(`expected a problem row at index ${index}`);
  return element;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a problem row in Ukrainian', () => {
  it('leads with what it means and folds the measurement away', async () => {
    stubApi();
    const title = row(await problemRows('uk'), 0);

    const meaning = within(title).getByText(
      /Пошукові системи зазвичай показують цю назву як заголовок вашого результату/,
    );
    expect(meaning).toBeVisible();
    expect(meaning.closest('details')).toBeNull();

    const measured = within(title).getByText(/коротша за 10 чи довша за 70 символів/);
    expect(measured).not.toBeVisible();
    expect(measured.closest('details')).not.toBeNull();
    expect(within(title).getByText('Технічні деталі').tagName).toBe('SUMMARY');
    expect(within(title).queryByText('Що це означає простою мовою')).toBeNull();
  });

  it('says what to do under each explained problem', async () => {
    stubApi();
    const rows = await problemRows('uk');

    const fix = within(row(rows, 0)).getByText(/Дайте кожній сторінці коротку власну назву/);
    expect(fix).toBeVisible();
    expect(fix).toHaveTextContent(/^Що зробити:/);
    expect(within(row(rows, 1)).getByText(/Напишіть для кожної сторінки опис/)).toBeVisible();
    expect(
      within(row(rows, 3)).getByText(/Дайте кожній сторінці один головний заголовок/),
    ).toBeVisible();
  });

  it('makes up no fix for a rule that has no plain explanation', async () => {
    stubApi();
    const images = row(await problemRows('uk'), 2);
    expect(within(images).queryByText('Що зробити:')).toBeNull();
    expect(within(images).queryByText('Технічні деталі')).toBeNull();
  });
});

describe('a problem row in English', () => {
  it('leads with what it means and says what to do', async () => {
    stubApi();
    const rows = await problemRows('en');
    const title = row(rows, 0);

    expect(
      within(title).getByText(/Search engines usually show this name as the headline/),
    ).toBeVisible();
    const fix = within(title).getByText(/Give each page a short, distinct name/);
    expect(fix).toBeVisible();
    expect(fix).toHaveTextContent(/^What to do:/);
    expect(
      within(title).getByText(/shorter than 10 or longer than 70 characters/),
    ).not.toBeVisible();
    expect(within(row(rows, 2)).queryByText('What to do:')).toBeNull();
  });

  it('opens what the check measured with one click', async () => {
    stubApi();
    const title = row(await problemRows('en'), 0);
    const technical = within(title).getByText('Technical details').closest('details');
    if (technical === null) throw new Error('expected the technical disclosure');
    technical.open = true;
    fireEvent(technical, new Event('toggle'));

    expect(within(technical).getByText('What the check found')).toBeVisible();
    expect(within(technical).getByText(/shorter than 10 or longer than 70/)).toBeVisible();
    expect(within(technical).getByText('One finding for each page.')).toBeVisible();
    // Said once, on the row: the fold does not repeat the meaning or the fix.
    expect(within(technical).queryByText(/Give each page a short/)).toBeNull();
  });
});

describe('the actions say what they open', () => {
  it('opens the problem’s pages from «Де саме і як виправити»', async () => {
    const fetchMock = stubApi();
    render(<IssuesScreen scan={SCAN} language="uk" onError={() => {}} />);
    const problem = 'Назва сторінки для пошуку відсутня, закоротка або задовга';

    fireEvent.click(
      await screen.findByRole('button', { name: `Де саме і як виправити: ${problem}` }),
    );

    expect(await screen.findByRole('heading', { name: problem })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            String(input).includes('/issues?') && String(input).includes('ruleId=SEO-ONPAGE-001'),
        ),
      ).toBe(true),
    );
    // The developer task is still offered for the open problem.
    expect(
      await screen.findByRole('button', {
        name: `Скопіювати завдання для розробника: ${problem}`,
      }),
    ).toBeInTheDocument();

    const explain = await screen.findByRole('button', { name: 'Пояснення й доказ' });
    expect(explain).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(explain);
    expect(screen.getByRole('button', { name: 'Сховати пояснення' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('the screen’s lead', () => {
  it('says what the owner does here in two plain sentences, with a compact legend', async () => {
    stubApi();
    await problemRows('uk');

    expect(screen.getByText(/^Почніть із найтерміновіших проблем угорі списку\./)).toBeVisible();
    const legend = screen.getByText(/показує, коли братися/);
    expect(legend).toHaveTextContent(
      'Критичність показує, коли братися: Критична — беріться першою · Висока — виправте найближчим часом',
    );
    // The counts stay.
    expect(screen.getByText('Відкритих знахідок: 4, проблем: 4.')).toBeInTheDocument();
  });
});

describe('the Issue Center’s name in Ukrainian', () => {
  it('is «Центр проблем» wherever Ukrainian copy names it', () => {
    expect(copy.uk.issues.windowTitle).toBe('Центр проблем');
    expect(JSON.stringify(copy.uk)).not.toContain('Issue Center');
    expect(JSON.stringify(checksCopyUk)).not.toContain('Issue Center');
    expect(JSON.stringify(checksCopyUk)).toContain('Центрі проблем');
  });
});
