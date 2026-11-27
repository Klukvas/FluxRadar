import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { CrawlSummary } from './api';
import { SiteCoveragePanel } from './SiteCoverage';

// What the report is allowed to claim about how much of the site it read.
//
// The report that prompted these tests read 15 pages of a 334-page site and
// showed "coverage 100%" — true of its checks, false of the site, and the only
// number the buyer was looking at.

function summary(overrides: Partial<CrawlSummary> = {}): CrawlSummary {
  return {
    reach: 'reachable',
    startStatus: 200,
    accessControlSignals: [],
    pagesRead: 15,
    pagesFetched: 15,
    urlsDiscovered: 334,
    urlsOverLimit: 319,
    urlsBlockedByRobots: 0,
    limitedBy: 'owner',
    maxPages: 15,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('the site-coverage panel', () => {
  it('states what was read out of what was found', () => {
    render(<SiteCoveragePanel summary={summary()} language="en" />);

    expect(
      screen.getByText('We read 15 of the 334 addresses we found on your site.'),
    ).toBeInTheDocument();
  });

  it('never shows a partly read site as fully covered', () => {
    render(<SiteCoveragePanel summary={summary()} language="en" />);

    const bar = screen.getByRole('meter');
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThan(100);
    expect(screen.queryByText(/cover the whole site/, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('does not round a crawl one address short up to a complete one', () => {
    // 999/1000 rounds to 100% on the bar; the sentence must still say partial.
    render(
      <SiteCoveragePanel
        summary={summary({
          pagesRead: 999,
          pagesFetched: 999,
          urlsDiscovered: 1000,
          urlsOverLimit: 1,
          limitedBy: 'plan',
          maxPages: 999,
        })}
        language="en"
      />,
    );

    expect(screen.queryByText(/cover the whole site/, { selector: 'p' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/This plan covers up to 999 pages/, { selector: 'p' }),
    ).toBeInTheDocument();
  });

  it('names the owner’s own setting when that is what stopped the crawl', () => {
    render(<SiteCoveragePanel summary={summary()} language="en" />);

    expect(
      screen.getByText(/Your scan settings limit this check to 15 pages/, { selector: 'p' }),
    ).toBeInTheDocument();
  });

  it('names the plan when the tariff ceiling is what stopped the crawl', () => {
    render(
      <SiteCoveragePanel
        summary={summary({
          limitedBy: 'plan',
          maxPages: 5000,
          pagesRead: 5000,
          pagesFetched: 5000,
          urlsDiscovered: 6000,
          urlsOverLimit: 1000,
        })}
        language="en"
      />,
    );

    expect(
      screen.getByText(/This plan covers up to 5000 pages/, { selector: 'p' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your scan settings/, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('confirms full coverage only when every found address was read', () => {
    render(
      <SiteCoveragePanel
        summary={summary({
          pagesRead: 40,
          pagesFetched: 40,
          urlsDiscovered: 40,
          urlsOverLimit: 0,
          limitedBy: null,
          maxPages: 50_000,
        })}
        language="en"
      />,
    );

    expect(screen.getByText(/cover the whole site/, { selector: 'p' })).toBeInTheDocument();
  });

  it('counts robots-disallowed addresses apart, not as pages we missed', () => {
    render(
      <SiteCoveragePanel
        summary={summary({
          pagesRead: 40,
          pagesFetched: 40,
          urlsDiscovered: 40,
          urlsOverLimit: 0,
          urlsBlockedByRobots: 7,
          limitedBy: null,
          maxPages: 50_000,
        })}
        language="en"
      />,
    );

    expect(screen.getByText(/cover the whole site/, { selector: 'p' })).toBeInTheDocument();
    expect(
      screen.getByText(/A further 7 addresses are disallowed/, { selector: 'p' }),
    ).toBeInTheDocument();
  });

  it('says nothing below describes the site when no page was read', () => {
    render(
      <SiteCoveragePanel
        summary={summary({
          reach: 'access-denied',
          startStatus: 403,
          accessControlSignals: ['server: cloudflare'],
          pagesRead: 0,
          pagesFetched: 1,
          urlsDiscovered: 1,
          urlsOverLimit: 0,
        })}
        language="en"
      />,
    );

    expect(
      screen.getByText(/No page of the site could be read/, { selector: 'p' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('renders nothing for a scan that ran before the crawl was recorded', () => {
    // Not recorded is not zero: an invented number is what this panel exists
    // to stop.
    const { container } = render(<SiteCoveragePanel summary={null} language="en" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is translated', () => {
    render(<SiteCoveragePanel summary={summary()} language="uk" />);

    expect(
      screen.getByText('Ми прочитали 15 з 334 адрес, які знайшли на вашому сайті.'),
    ).toBeInTheDocument();
  });
});

// D-236: a Free report reads the homepage alone, so its full-coverage line must
// not claim the whole site; every other plan keeps its sentence exactly.
describe('full coverage on a Free report', () => {
  const homepageRead = {
    pagesRead: 1,
    pagesFetched: 1,
    urlsDiscovered: 1,
    urlsOverLimit: 0,
    limitedBy: null,
    maxPages: 1,
  } as const;

  it.each([
    [
      'en',
      'The free check reads only the homepage, so the sections below describe the homepage, not the rest of the site.',
    ],
    [
      'uk',
      'Безкоштовна перевірка читає лише головну сторінку, тож розділи нижче описують головну, а не решту сайту.',
    ],
  ] as const)('says the homepage was read, not the whole site (%s)', (language, sentence) => {
    render(<SiteCoveragePanel summary={summary(homepageRead)} language={language} homepageOnly />);
    expect(screen.getByText(sentence, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(/cover the whole site|охоплюють увесь сайт/)).toBeNull();
  });

  it.each([
    ['en', 'That is every address the crawl found, so the sections below cover the whole site.'],
    ['uk', 'Це всі адреси, які знайшов обхід, тож розділи нижче охоплюють увесь сайт.'],
  ] as const)('keeps the paid sentence byte-for-byte (%s)', (language, sentence) => {
    render(<SiteCoveragePanel summary={summary(homepageRead)} language={language} />);
    expect(screen.getByText(sentence, { selector: 'p' })).toBeInTheDocument();
  });
});

// A Free check reads the homepage and nothing else, so its crawl "found" one
// address on a site of any size. The owner of a fifteen-page site was shown
// "We read 1 of the 1 addresses" under a full bar — a whole site checked.
describe('a Free report of a site whose sitemap lists more than the homepage', () => {
  function homepageOf(unread: number, capped = false): CrawlSummary {
    return summary({
      pagesRead: 1,
      pagesFetched: 1,
      urlsDiscovered: 1,
      urlsOverLimit: 0,
      limitedBy: null,
      maxPages: 1,
      sitemap: { urls: unread + 1, unread, capped },
    });
  }

  it('counts the sitemap pages it did not read instead of saying 1 of 1', () => {
    render(<SiteCoveragePanel summary={homepageOf(14)} language="en" homepageOnly />);

    expect(
      screen.getByText('The free check read one page of your site: the homepage.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your sitemap lists 14 more pages that this check did not read.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/We read 1 of the 1/)).toBeNull();
  });

  it('draws the bar against the sitemap, not against the one page it looked at', () => {
    render(<SiteCoveragePanel summary={homepageOf(14)} language="en" homepageOnly />);

    // 1 of 15.
    expect(Number(screen.getByRole('meter').getAttribute('aria-valuenow'))).toBe(7);
  });

  it('says the count is a floor when the sitemap was cut at the crawler ceiling', () => {
    render(<SiteCoveragePanel summary={homepageOf(999, true)} language="en" homepageOnly />);

    expect(
      screen.getByText('Your sitemap lists at least 999 more pages that this check did not read.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['en', 1, 'Your sitemap lists 1 more page that this check did not read.'],
    ['uk', 1, 'Ще 1 сторінку з вашого sitemap ця перевірка не прочитала.'],
    ['uk', 3, 'Ще 3 сторінки з вашого sitemap ця перевірка не прочитала.'],
    ['uk', 14, 'Ще 14 сторінок з вашого sitemap ця перевірка не прочитала.'],
    ['ru', 21, 'Ещё 21 страницу из вашего sitemap эта проверка не прочитала.'],
    ['ru', 14, 'Ещё 14 страниц из вашего sitemap эта проверка не прочитала.'],
    ['en', 1500, 'Your sitemap lists 1,500 more pages that this check did not read.'],
  ] as const)('declines the page count (%s, %d)', (language, unread, sentence) => {
    render(<SiteCoveragePanel summary={homepageOf(unread)} language={language} homepageOnly />);

    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('never draws 0% beside a page that was read', () => {
    render(<SiteCoveragePanel summary={homepageOf(999)} language="en" homepageOnly />);

    expect(Number(screen.getByRole('meter').getAttribute('aria-valuenow'))).toBe(1);
  });

  it('draws no share at all when the count is only a floor', () => {
    render(<SiteCoveragePanel summary={homepageOf(999, true)} language="en" homepageOnly />);

    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('keeps the plain sentence when the sitemap lists nothing beyond the homepage', () => {
    render(<SiteCoveragePanel summary={homepageOf(0)} language="en" homepageOnly />);

    expect(
      screen.getByText('We read 1 of the 1 addresses we found on your site.'),
    ).toBeInTheDocument();
  });

  it('leaves a paid report on the addresses its own crawl found', () => {
    render(
      <SiteCoveragePanel
        summary={summary({ sitemap: { urls: 400, unread: 385, capped: false } })}
        language="en"
      />,
    );

    expect(
      screen.getByText('We read 15 of the 334 addresses we found on your site.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sitemap/)).toBeNull();
  });
});
