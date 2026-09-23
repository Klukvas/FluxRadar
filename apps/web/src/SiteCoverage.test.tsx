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
