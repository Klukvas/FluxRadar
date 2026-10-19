// The Free report's last block, which sells Basic with the free check's own result.
//
// What it may say is narrow: how many problems the free check left open on the
// homepage — counted as "Fix these first" counts them, one per rule — and
// nothing about the rest of the site, which nobody read. While the summary is
// loading it says no number at all, so a "0" never flashes before the real one.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportNextSteps } from './ReportNextSteps';
import type { IssueRuleGroup, IssueSummary, Scan } from './api';
import type { PaidPlan } from './plan-modules';
import type { SiteReadFailure } from './report-failure-copy';
import { BASIC_PRICE } from './tariff-prices';

const FREE_SCAN: Scan = {
  id: 'scan-free-upsell',
  profileId: 'profile-1',
  plan: 'Free',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-10-17T00:00:00.000Z',
  completedAt: '2026-10-17T00:01:00.000Z',
  createdAt: '2026-10-17T00:00:00.000Z',
  modules: [],
};

const FREE_RULES = ['SEO-ONPAGE-001', 'SEO-ONPAGE-002', 'SEO-ONPAGE-003', 'SEO-TECH-008'];

/** `count` open problems, each with several findings, plus one settled rule that must not count. */
function summaryWithOpenProblems(count: number): IssueSummary {
  const open: IssueRuleGroup[] = Array.from({ length: count }, (_, index) => ({
    ruleId: FREE_RULES[index % FREE_RULES.length] + (index >= FREE_RULES.length ? `-${index}` : ''),
    module: 'SEO',
    severity: 'High',
    issues: 3,
    openIssues: 3,
  }));
  const settled: IssueRuleGroup = {
    ruleId: 'SEO-TECH-001',
    module: 'SEO',
    severity: 'Medium',
    issues: 2,
    openIssues: 0,
  };
  const groups = [...open, settled];
  return {
    total: groups.reduce((sum, group) => sum + group.issues, 0),
    open: groups.reduce((sum, group) => sum + group.openIssues, 0),
    bySeverity: {},
    groups,
  };
}

/** Answers the summary with `summary`, or never answers when it is `'pending'`. */
function stubFetch(summary: IssueSummary | 'pending'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const { pathname } = new URL(String(input), 'http://localhost');
      if (pathname.endsWith('/issues/summary') && summary === 'pending') {
        return new Promise<Response>(() => {});
      }
      const data = pathname.endsWith('/issues/summary') ? summary : null;
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

function renderNextSteps(
  options: {
    scan?: Scan;
    language?: 'en' | 'uk';
    onUpgrade?: (plan: PaidPlan) => void;
    siteFailure?: SiteReadFailure | null;
  } = {},
) {
  return render(
    <ReportNextSteps
      scan={options.scan ?? FREE_SCAN}
      language={options.language ?? 'en'}
      onOpenProblem={() => {}}
      onAllProblems={() => {}}
      onUpgrade={options.onUpgrade ?? (() => {})}
      siteFailure={options.siteFailure}
    />,
  );
}

async function upsellBlock(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const block = heading.closest('section');
  if (block === null) throw new Error('expected the upsell block');
  return block;
}

const EN_HEADING = 'Your homepage is checked. The rest of the site is not';
const UK_HEADING = 'Головну перевірено. Решту сайту — ще ні';
const EN_REST = 'The other pages of the site have not been checked yet.';
const UK_REST = 'Інші сторінки сайту ще не перевірено.';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Free upsell → what the free check found', () => {
  it.each([
    [
      0,
      `On the homepage of smile.example, the free check found no problems in the four things it looks at. ${EN_REST}`,
    ],
    [
      1,
      `The free check found 1 problem on the homepage of smile.example, in the four things it looks at. ${EN_REST}`,
    ],
    [
      2,
      `The free check found 2 problems on the homepage of smile.example, in the four things it looks at. ${EN_REST}`,
    ],
    [
      5,
      `The free check found 5 problems on the homepage of smile.example, in the four things it looks at. ${EN_REST}`,
    ],
  ])('in English, with %i open problems', async (count, lead) => {
    stubFetch(summaryWithOpenProblems(count));
    renderNextSteps();

    const block = await upsellBlock(EN_HEADING);
    expect(await within(block).findByText(lead)).toBeInTheDocument();
  });

  it.each([
    [
      0,
      `На головній сторінці smile.example у чотирьох речах, які дивиться безкоштовна перевірка, проблем немає. ${UK_REST}`,
    ],
    [
      1,
      `Безкоштовна перевірка знайшла на головній сторінці smile.example 1 проблему у чотирьох речах, які вона дивиться. ${UK_REST}`,
    ],
    [
      2,
      `Безкоштовна перевірка знайшла на головній сторінці smile.example 2 проблеми у чотирьох речах, які вона дивиться. ${UK_REST}`,
    ],
    [
      5,
      `Безкоштовна перевірка знайшла на головній сторінці smile.example 5 проблем у чотирьох речах, які вона дивиться. ${UK_REST}`,
    ],
  ])('in Ukrainian, with %i open problems', async (count, lead) => {
    stubFetch(summaryWithOpenProblems(count));
    renderNextSteps({ language: 'uk' });

    const block = await upsellBlock(UK_HEADING);
    expect(await within(block).findByText(lead)).toBeInTheDocument();
  });

  // Ukrainian has three noun forms after a number, and the teens break the
  // pattern the last digit sets: 11–14 take «проблем», 21 and 101 «проблему».
  it.each([
    [4, 'проблеми'],
    [11, 'проблем'],
    [12, 'проблем'],
    [14, 'проблем'],
    [21, 'проблему'],
    [22, 'проблеми'],
    [25, 'проблем'],
    [101, 'проблему'],
    [111, 'проблем'],
  ])('in Ukrainian, %i takes «%s»', async (count, noun) => {
    stubFetch(summaryWithOpenProblems(count));
    renderNextSteps({ language: 'uk' });

    const block = await upsellBlock(UK_HEADING);
    expect(
      await within(block).findByText(
        `Безкоштовна перевірка знайшла на головній сторінці smile.example ${count} ${noun} у чотирьох речах, які вона дивиться. ${UK_REST}`,
      ),
    ).toBeInTheDocument();
  });

  it('counts problems as "Fix these first" does, not findings', async () => {
    // Two open rules with three findings each: two problems, not six.
    stubFetch(summaryWithOpenProblems(2));
    renderNextSteps();

    const block = await upsellBlock(EN_HEADING);
    expect(await within(block).findByText(/found 2 problems on the homepage/)).toBeInTheDocument();
    expect(within(block).queryByText(/6 problems/)).toBeNull();
  });

  it('says no number while the summary is still loading', async () => {
    stubFetch('pending');
    renderNextSteps();

    const block = await upsellBlock(EN_HEADING);
    expect(
      within(block).getByText(
        `The free check looked at four things on the homepage of smile.example. ${EN_REST}`,
      ),
    ).toBeInTheDocument();
    expect(within(block).queryByText(/\d+ problems?/)).toBeNull();
    expect(within(block).queryByText(/no problems/)).toBeNull();
  });

  it('says no number in Ukrainian while the summary is still loading', async () => {
    stubFetch('pending');
    renderNextSteps({ language: 'uk' });

    const block = await upsellBlock(UK_HEADING);
    expect(
      within(block).getByText(
        `Безкоштовна перевірка подивилася чотири речі на головній сторінці smile.example. ${UK_REST}`,
      ),
    ).toBeInTheDocument();
  });
});

describe('Free upsell → what Basic adds', () => {
  it('lists the four things Basic checks on every page, with the Basic price', async () => {
    stubFetch(summaryWithOpenProblems(1));
    renderNextSteps();

    const block = await upsellBlock(EN_HEADING);
    expect(within(block).getByText('A full Basic report checks every page for:')).toBeVisible();
    expect(
      within(block)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Broken links — where a visitor clicks and lands nowhere',
      'Pages with no description, the same title, or duplicates',
      'Which pages Google cannot show — and why',
      'Whether AI assistants like ChatGPT know about your business',
    ]);
    expect(
      within(block).getByText(`Basic — ${BASIC_PRICE}, paid once, no subscription.`),
    ).toBeInTheDocument();
    expect(
      within(block).getByRole('button', { name: `Check the whole site for ${BASIC_PRICE}` }),
    ).toBeInTheDocument();
    const compare = within(block).getByRole('link', {
      name: 'Need security, speed and accessibility too? Compare plans',
    });
    expect(compare).toHaveAttribute('href', '/plans');
  });

  it('says it in Ukrainian', async () => {
    stubFetch(summaryWithOpenProblems(1));
    renderNextSteps({ language: 'uk' });

    const block = await upsellBlock(UK_HEADING);
    expect(
      within(block).getByText('Повний звіт Basic перевірить на всіх сторінках:'),
    ).toBeVisible();
    expect(
      within(block)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Биті посилання — куди клієнт клікає і потрапляє в нікуди',
      'Сторінки без опису, з однаковими заголовками або дублікатами',
      'Які сторінки Google не може показати — і чому',
      'Чи знають про ваш бізнес ШІ-помічники на кшталт ChatGPT',
    ]);
    expect(
      within(block).getByText(`Basic — ${BASIC_PRICE}, оплата один раз, без підписки.`),
    ).toBeInTheDocument();
    expect(
      within(block).getByRole('button', { name: `Перевірити весь сайт за ${BASIC_PRICE}` }),
    ).toBeInTheDocument();
    expect(
      within(block).getByRole('link', {
        name: 'Потрібні ще безпека, швидкість і доступність? Порівняти тарифи',
      }),
    ).toHaveAttribute('href', '/plans');
  });

  it('takes the price from the tariff table, never a literal', () => {
    const source = readFileSync(resolve(__dirname, 'findings-copy.ts'), 'utf8');
    // Each language's upsell block (not the type's) runs up to the `download` block after it.
    const upsells = [
      ...source.matchAll(/(?<!readonly\s+)\bupsell:\s*\{([\s\S]*?)\bdownload:\s*\{/g),
    ].map((match) => match[1]);
    expect(upsells).toHaveLength(2);
    for (const body of upsells) {
      expect(body).toContain('${BASIC_PRICE}');
      expect(body).not.toMatch(/\$\d/);
    }
  });

  it('opens the upgrade on Basic', async () => {
    stubFetch(summaryWithOpenProblems(1));
    const onUpgrade = vi.fn();
    renderNextSteps({ onUpgrade });

    const block = await upsellBlock(EN_HEADING);
    fireEvent.click(within(block).getByRole('button', { name: /^Check the whole site for/ }));

    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onUpgrade).toHaveBeenCalledWith('Basic');
  });
});

describe('Free upsell → where it is not shown', () => {
  it('is not drawn when the free check could not read the site', async () => {
    stubFetch(summaryWithOpenProblems(0));
    renderNextSteps({
      scan: { ...FREE_SCAN, status: 'Failed', statusReason: 'SiteDeniedAccess' },
      siteFailure: {
        kind: 'access-denied',
        reasonCode: 'SiteDeniedAccess',
        startStatus: 403,
        accessControlSignals: [],
      },
    });

    expect(await screen.findByRole('heading', { name: /could not/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: EN_HEADING })).toBeNull();
  });

  it.each(['Basic', 'WebsiteAudit', 'Complete'] as const)(
    'is not drawn on a %s report',
    async (plan) => {
      stubFetch(summaryWithOpenProblems(2));
      renderNextSteps({ scan: { ...FREE_SCAN, plan } });

      expect(await screen.findByRole('heading', { name: 'Fix these first' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: EN_HEADING })).toBeNull();
    },
  );
});

describe('Action Plan upgrade', () => {
  // Basic includes the plan since 2026-10-19; only an archived report is
  // still locked, and only Complete re-checks every section it covered.
  it('opens the upgrade on Complete from an archived Website Audit report', async () => {
    stubFetch(summaryWithOpenProblems(2));
    const onUpgrade = vi.fn();
    renderNextSteps({ scan: { ...FREE_SCAN, plan: 'WebsiteAudit' }, onUpgrade });

    fireEvent.click(await screen.findByRole('button', { name: 'Run a Complete scan' }));

    expect(onUpgrade).toHaveBeenCalledWith('Complete');
  });

  it('sells nothing from a Basic report, which includes the plan', async () => {
    stubFetch(summaryWithOpenProblems(2));
    const onUpgrade = vi.fn();
    renderNextSteps({ scan: { ...FREE_SCAN, plan: 'Basic' }, onUpgrade });

    expect(await screen.findByRole('heading', { name: 'Fix these first' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run a Complete scan' })).toBeNull();
    expect(onUpgrade).not.toHaveBeenCalled();
  });
});
