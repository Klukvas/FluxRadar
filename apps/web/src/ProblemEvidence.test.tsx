// A problem row names the owner's own page and what is on it now.
//
// "Fix these first" and the Issue Center's problem rows read "Page name for
// search results is missing, too short or too long — on 1 page", and which page
// and what the name actually was sat behind "Where exactly and how to fix". The
// summary now carries the rule's first findings with the values the rule
// recorded; these tests read the rows as an owner would, in both languages.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IssueRuleGroup, IssueSample, IssueSummary, Scan } from './api';
import { IssueProblems } from './IssueProblems';
import { IssuesScreen } from './Issues';
import type { Language } from './i18n';
import { FixFirst } from './ReportNextSteps';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sample(
  targetUrl: string,
  code: string,
  params: Record<string, string | number> = {},
  recommendation: Record<string, string | number> = {},
): IssueSample {
  return {
    targetUrl,
    messages: {
      evidence: { code, params },
      recommendation: { code: `${code.split('.')[0]}.recommendation`, params: recommendation },
    },
    evidence: null,
  };
}

function groupOf(ruleId: string, samples: readonly unknown[], openIssues = 1): IssueRuleGroup {
  return {
    ruleId,
    module: 'SEO',
    severity: 'Medium',
    issues: openIssues,
    openIssues,
    samples: samples as IssueSample[],
  };
}

function summaryOf(...groups: IssueRuleGroup[]): IssueSummary {
  return { total: groups.length, open: groups.length, bySeverity: {}, groups };
}

const TITLE_RANGE = { min: 10, max: 70 };
const DESCRIPTION_RANGE = { min: 50, max: 160 };

/** The Free check's rule states, each with the line it must read as. */
const CASES: readonly {
  readonly name: string;
  readonly group: IssueRuleGroup;
  readonly en: string;
  readonly uk: string;
}[] = [
  {
    name: 'a missing title',
    group: groupOf('SEO-ONPAGE-001', [
      sample('https://mysalon.com.ua/', 'seo-onpage-001.evidence.missing', {}, TITLE_RANGE),
    ]),
    en: 'No page name for search results',
    uk: 'Назви сторінки для пошуку немає',
  },
  {
    name: 'a too-short title, with its value and length',
    group: groupOf('SEO-ONPAGE-001', [
      sample(
        'https://mysalon.com.ua/',
        'seo-onpage-001.evidence.too-short',
        { title: 'Головна', length: 7, min: 10 },
        TITLE_RANGE,
      ),
    ]),
    en: 'Name now: “Головна”, 7 characters; aim for 10–70',
    uk: 'Назва зараз: «Головна», 7 символів, а треба від 10 до 70',
  },
  {
    name: 'a too-long description',
    group: groupOf('SEO-ONPAGE-002', [
      sample(
        'https://mysalon.com.ua/prices',
        'seo-onpage-002.evidence.too-long',
        { length: 212, max: 160 },
        DESCRIPTION_RANGE,
      ),
    ]),
    en: 'The summary is 212 characters; aim for 50–160',
    uk: 'Опис зараз має 212 символів, а треба від 50 до 160',
  },
  {
    name: 'a page with no H1',
    group: groupOf('SEO-ONPAGE-003', [
      sample('https://mysalon.com.ua/', 'seo-onpage-003.evidence.no-h1', { outline: 'h2 → h3' }),
    ]),
    en: 'No main heading (H1)',
    uk: 'Головного заголовка H1 немає',
  },
  {
    name: 'a page with two H1s',
    group: groupOf('SEO-ONPAGE-003', [
      sample('https://mysalon.com.ua/', 'seo-onpage-003.evidence.multiple-h1', {
        count: 2,
        outline: 'h1 → h1 → h2',
      }),
    ]),
    en: '2 main headings (H1); there should be one',
    uk: 'Головних заголовків H1: 2, а має бути один',
  },
  {
    name: 'a page hidden by meta robots',
    group: groupOf('SEO-TECH-008', [
      sample('https://mysalon.com.ua/akcii', 'seo-tech-008.evidence.meta.sitemap', {
        content: 'noindex, follow',
      }),
    ]),
    en: 'Hidden from search by the meta robots tag “noindex, follow”, yet listed in the sitemap',
    uk: 'Сторінку приховано від пошуку тегом meta robots «noindex, follow», хоча вона є в карті сайту',
  },
  {
    name: 'a canonical on another host',
    group: groupOf('SEO-TECH-004', [
      sample('https://mysalon.com.ua/', 'seo-tech-004.evidence.foreign-host', {
        href: 'https://www.mysalon.com.ua/',
        canonicalHost: 'www.mysalon.com.ua',
        pageHost: 'mysalon.com.ua',
      }),
    ]),
    en: 'The main address (canonical) points to www.mysalon.com.ua, while this page is on mysalon.com.ua',
    uk: 'Основна адреса (canonical) вказує на www.mysalon.com.ua, а сторінка відкривається на mysalon.com.ua',
  },
  {
    name: 'a broken link, named as written on the page',
    group: groupOf('SEO-TECH-006', [
      sample('https://mysalon.com.ua/', 'seo-tech-006.evidence', {
        href: '/old-prices',
        status: 404,
        url: 'https://mysalon.com.ua/404-landing',
      }),
    ]),
    en: 'The link “/old-prices” leads to error 404',
    uk: 'Посилання «/old-prices» не працює: помилка 404',
  },
  {
    name: 'a hidden page other pages link to',
    group: groupOf('SEO-TECH-008', [
      sample('https://mysalon.com.ua/akcii', 'seo-tech-008.evidence.header.internal-links', {
        value: 'noindex',
        sources: 21,
      }),
    ]),
    en: 'Hidden from search by the server setting X-Robots-Tag “noindex”, yet 21 other pages link to it',
    uk: 'Сторінку приховано від пошуку налаштуванням сервера X-Robots-Tag «noindex», хоча на неї є посилання з 21 сторінки сайту',
  },
  {
    name: 'a skipped heading level',
    group: groupOf('SEO-ONPAGE-003', [
      sample('https://mysalon.com.ua/', 'seo-onpage-003.evidence.level-skip', {
        from: 2,
        to: 4,
        outline: 'h1 → h2 → h4',
      }),
    ]),
    en: 'H2 is followed straight by H4, without H3',
    uk: 'Після H2 одразу йде H4, без H3',
  },
  {
    name: 'a title shared with other pages',
    group: groupOf('SEO-ONPAGE-004', [
      sample('https://mysalon.com.ua/a', 'seo-onpage-004.evidence.no-canonical', {
        count: 3,
        pages: '/b, /c, /d',
        title: 'Салон',
      }),
    ]),
    en: 'Same name on 3 other pages: “Салон”',
    uk: 'Така сама назва ще на 3 сторінках: «Салон»',
  },
];

function renderFixFirst(summary: IssueSummary, language: Language) {
  return render(<FixFirst summary={summary} language={language} onOpenProblem={() => {}} />);
}

function renderProblems(summary: IssueSummary, language: Language) {
  return render(<IssueProblems summary={summary} language={language} onOpen={() => {}} />);
}

describe.each(['en', 'uk'] as const)('a problem row in %s', (language) => {
  describe.each([
    ['Fix these first', renderFixFirst],
    ['the Issue Center', renderProblems],
  ] as const)('in %s', (_where, renderRows) => {
    it.each(CASES)('names the page and what it has now for $name', (testCase) => {
      renderRows(summaryOf(testCase.group), language);

      const list = screen.getByRole('list', {
        name: language === 'en' ? 'Where it was found' : 'Де знайдено',
      });
      const address = testCase.group.samples?.[0]?.targetUrl.replace('https://', '') ?? '';
      expect(within(list).getByText(address)).toBeTruthy();
      expect(within(list).getByText(testCase[language])).toBeTruthy();
    });
  });
});

describe('a problem found on many pages', () => {
  const group = groupOf(
    'SEO-ONPAGE-002',
    [
      sample('https://mysalon.com.ua/', 'seo-onpage-002.evidence.missing', {}, DESCRIPTION_RANGE),
      sample('https://mysalon.com.ua/prices', 'seo-onpage-002.evidence.missing'),
      sample('https://mysalon.com.ua/contacts', 'seo-onpage-002.evidence.missing'),
    ],
    8,
  );

  it('names the first three pages and counts the rest, in Ukrainian', () => {
    renderProblems(summaryOf(group), 'uk');

    const list = screen.getByRole('list', { name: 'Де знайдено' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'mysalon.com.ua/Опису сторінки для пошуку немає',
      'mysalon.com.ua/pricesОпису сторінки для пошуку немає',
      'mysalon.com.ua/contactsОпису сторінки для пошуку немає',
      'і ще 5',
    ]);
    // The row's own count still says how far the problem reaches.
    expect(screen.getByText('На 8 сторінках')).toBeTruthy();
  });

  it('says "and N more" in English', () => {
    renderFixFirst(summaryOf(group), 'en');

    expect(screen.getByText('and 5 more')).toBeTruthy();
  });
});

describe('when the evidence cannot be read', () => {
  it('reads as it always did without samples', () => {
    const { ruleId, module, severity, issues, openIssues } = CASES[0]!.group;
    renderFixFirst(summaryOf({ ruleId, module, severity, issues, openIssues }), 'uk');

    expect(screen.queryByRole('list', { name: 'Де знайдено' })).toBeNull();
    expect(
      screen.getByText('Назва сторінки для пошуку відсутня, закоротка або задовга'),
    ).toBeTruthy();
  });

  it('ignores a summary whose samples are not samples (a stray mock answer)', () => {
    renderProblems(
      summaryOf(groupOf('SEO-ONPAGE-001', [{ id: 'scan-1' }, 'nonsense', null] as unknown[])),
      'en',
    );

    expect(screen.queryByRole('list', { name: 'Where it was found' })).toBeNull();
  });

  it('shows only the page when a value the line needs was not recorded', () => {
    renderProblems(
      summaryOf(
        groupOf('SEO-ONPAGE-001', [
          sample('https://mysalon.com.ua/', 'seo-onpage-001.evidence.too-short', { length: 7 }),
        ]),
      ),
      'uk',
    );

    const list = screen.getByRole('list', { name: 'Де знайдено' });
    expect(within(list).getByRole('listitem').textContent).toBe('mysalon.com.ua/');
  });

  it('falls back to the recorded sentence for a code with no plain line', () => {
    renderProblems(
      summaryOf(
        groupOf('SEC-PASSIVE-005', [
          {
            targetUrl: 'https://mysalon.com.ua/',
            messages: {
              evidence: { code: 'sec-passive-005.evidence', params: { cookie: 'session' } },
              recommendation: { code: 'sec-passive-005.recommendation', params: {} },
            },
            evidence: {
              en: 'Set-Cookie "session" is missing attributes: Secure',
              uk: 'Set-Cookie "session" не має атрибутів: Secure',
            },
          },
        ]),
      ),
      'uk',
    );

    expect(screen.getByText('Set-Cookie "session" не має атрибутів: Secure')).toBeTruthy();
  });
});

describe('page text is untrusted', () => {
  it('renders the fallback for a code that names an Object member', () => {
    renderProblems(
      summaryOf(
        groupOf('SEO-ONPAGE-001', [
          {
            targetUrl: 'https://mysalon.com.ua/',
            messages: {
              evidence: { code: 'constructor', params: {} },
              recommendation: { code: '__proto__', params: {} },
            },
            evidence: { en: 'Recorded sentence', uk: 'Записане речення' },
          },
        ]),
      ),
      'uk',
    );

    expect(screen.getByText('Записане речення')).toBeTruthy();
  });

  it('removes characters that draw nothing but keeps emoji joined', () => {
    const hidden = '\u00ad\u061c\u180e\u2060\u2064\ufff9\ufffb\u{e0041}\u{e007f}';
    renderProblems(
      summaryOf(
        groupOf('SEO-ONPAGE-001', [
          sample(
            'https://mysalon.com.ua/',
            'seo-onpage-001.evidence.too-short',
            { title: `Пере${hidden}карня 👩\u200d💻`, length: 9 },
            TITLE_RANGE,
          ),
        ]),
      ),
      'en',
    );

    expect(
      screen.getByText('Name now: “Перекарня 👩\u200d💻”, 9 characters; aim for 10–70'),
    ).toBeTruthy();
  });

  it('renders markup in a title as text', () => {
    const { container } = renderFixFirst(
      summaryOf(
        groupOf('SEO-ONPAGE-001', [
          sample(
            'https://mysalon.com.ua/',
            'seo-onpage-001.evidence.too-short',
            { title: '<script>x</script>', length: 9 },
            TITLE_RANGE,
          ),
        ]),
      ),
      'en',
    );

    expect(
      screen.getByText('Name now: “<script>x</script>”, 9 characters; aim for 10–70'),
    ).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
  });

  it('shortens a long title and strips its line breaks', () => {
    const longTitle = `Перукарня\n\u202eна Подолі ${'дуже '.repeat(40)}`;
    renderProblems(
      summaryOf(
        groupOf('SEO-ONPAGE-001', [
          sample(
            'https://mysalon.com.ua/',
            'seo-onpage-001.evidence.too-long',
            { title: longTitle, length: 215, max: 70 },
            TITLE_RANGE,
          ),
        ]),
      ),
      'uk',
    );

    const line = screen.getByText(/^Назва зараз:/).textContent ?? '';
    const quoted = /«(.*)»/.exec(line)?.[1] ?? '';
    expect(quoted.startsWith('Перукарня на Подолі дуже')).toBe(true);
    expect(quoted.endsWith('…')).toBe(true);
    expect([...quoted]).toHaveLength(80);
    expect(line).not.toMatch(/[\n\u202e]/);
    expect(line.endsWith('215 символів, а треба від 10 до 70')).toBe(true);
  });

  it('keeps the full address one hover away and shows a short one', () => {
    renderProblems(
      summaryOf(
        groupOf('SEO-TECH-008', [
          sample('https://mysalon.com.ua/akcii?utm=x#top', 'seo-tech-008.evidence.meta.sitemap', {
            content: 'noindex',
          }),
        ]),
      ),
      'en',
    );

    const address = screen.getByText('mysalon.com.ua/akcii?utm=x');
    expect(address.getAttribute('title')).toBe('https://mysalon.com.ua/akcii?utm=x#top');
    expect(address.closest('a')).toBeNull();
  });
});

describe('the Issue Center over the real summary request', () => {
  it('shows the evidence and still opens the problem onto its findings', async () => {
    const summary = summaryOf(
      groupOf('SEO-ONPAGE-001', [
        sample(
          'https://mysalon.com.ua/',
          'seo-onpage-001.evidence.too-short',
          { title: 'Головна', length: 7, min: 10 },
          TITLE_RANGE,
        ),
      ]),
    );
    const requested: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requested.push(url);
        const data = url.pathname.endsWith('/issues/summary') ? summary : [];
        const meta = { total: 0, page: 1, limit: 50 };
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data, error: null, meta }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    const scan = { id: 'scan-evidence', domain: 'https://mysalon.com.ua' } as Scan;
    render(<IssuesScreen scan={scan} language="uk" onError={() => {}} />);

    expect(
      await screen.findByText('Назва зараз: «Головна», 7 символів, а треба від 10 до 70'),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Де саме і як виправити: Назва сторінки для пошуку відсутня, закоротка або задовга',
      }),
    );
    await screen.findByText('Показано лише одну проблему');
    expect(requested.at(-1)?.searchParams.get('ruleId')).toBe('SEO-ONPAGE-001');
  });
});
