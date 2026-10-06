// The public example report (/example-report) — the route, the EXAMPLE label, and the links that lead here.
//
// It exists for a stranger: somebody weighing up the product who cannot see a
// report because they have not bought one. The suite was one 1,125-line file
// and is five now, one per question it answers; the helpers they share live in
// `example-report-test-support.tsx`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { App } from './App';
import { EXAMPLE_REPORT_PATH } from './app-routes';
import { exampleReportCopy } from './example-report-copy';
import { EXAMPLE_DOMAIN } from './example-report-fixture';
import {
  PUBLIC_PAGE_REQUESTS,
  cleanupExamplePage,
  openExample,
  requestedPaths,
  stubSignedOut,
} from './example-report-test-support';
import { copy } from './i18n';
import { pageMetadata, publicPageUrl } from './seo';

afterEach(cleanupExamplePage);

describe('the route', () => {
  it('opens for a visitor with no session, and asks for nothing of its own', async () => {
    const fetchMock = stubSignedOut();
    window.history.replaceState(null, '', EXAMPLE_REPORT_PATH);
    render(<App />);

    // Rendered without waiting for the session, like every other public page.
    expect(
      await screen.findByRole('heading', { name: exampleReportCopy.en.title }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(EXAMPLE_REPORT_PATH);
    // The exact list, not a subset: the report is built from a fixture, so a
    // fetch appearing here would mean the page had started depending on the API.
    expect(requestedPaths(fetchMock)).toEqual(PUBLIC_PAGE_REQUESTS);
  });

  it('renders even when the session request never answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    window.history.replaceState(null, '', EXAMPLE_REPORT_PATH);
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: exampleReportCopy.en.title }),
    ).toBeInTheDocument();
  });

  it('has its own title, description and canonical, in both languages', async () => {
    await openExample();
    expect(document.title).toBe(copy.en.seo.exampleReport.title);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      publicPageUrl('exampleReport', 'en'),
    );
    expect(pageMetadata('exampleReport', 'en').indexable).toBe(true);
    cleanup();

    await openExample('uk');
    expect(document.documentElement.lang).toBe('uk');
    expect(document.title).toBe(copy.uk.seo.exampleReport.title);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      publicPageUrl('exampleReport', 'uk'),
    );
  });

  it('is listed in the sitemap in both languages', () => {
    const sitemap = readFileSync(resolve(__dirname, '../public/sitemap.xml'), 'utf8');
    for (const language of ['en', 'uk'] as const) {
      expect(sitemap).toContain(`<loc>${publicPageUrl('exampleReport', language)}</loc>`);
    }
  });

  it('follows the language switch like the rest of the site', async () => {
    await openExample();
    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
    fireEvent.click(screen.getByRole('option', { name: 'Українська' }));

    expect(
      await screen.findByRole('heading', { name: exampleReportCopy.uk.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: exampleReportCopy.en.title })).toBeNull();
  });
});

describe('it can never be mistaken for a real report', () => {
  it.each(['en', 'uk'] as const)('carries the EXAMPLE label (%s)', async (language) => {
    await openExample(language);
    const label = exampleReportCopy[language].exampleLabel;

    // On screen, and as the report's own accessible name, so it is the first
    // thing said about the document by a screen reader too.
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('article', { name: label })).toBeInTheDocument();
    expect(screen.getByText(exampleReportCopy[language].exampleBody)).toBeInTheDocument();
  });

  it('keeps the label visible on paper', () => {
    const css = readFileSync(resolve(__dirname, 'styles/example-report.css'), 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    // Not hidden when printed, and legible without colour.
    expect(print).toMatch(/\.example-banner \{/);
    expect(print).not.toMatch(/\.example-banner \{[^}]*display: none/);
    expect(css).not.toMatch(/\.example-banner[^{]*\{[^}]*visibility: hidden/);
  });

  it('names no real site, person, price or payment', async () => {
    await openExample();
    // Scoped to the report and its label: the site's own header and footer
    // link to the terms and the refund policy on every page, which is not this
    // page making a claim about a purchase.
    const report = document.querySelector('.example-report') as HTMLElement;
    const text = `${report.textContent ?? ''}${document.querySelector('.example-banner')?.textContent ?? ''}`;

    expect(text).toContain(EXAMPLE_DOMAIN);
    expect(EXAMPLE_DOMAIN.endsWith('.example')).toBe(true);
    // Every address on the page is under the reserved domain.
    for (const link of document.querySelectorAll('.example-report a[href^="http"]')) {
      expect(link.getAttribute('href')).toContain('.example');
    }
    // No price, and no claim that anything was bought or owed. "It needs no
    // payment and no card" stays: it is the opposite of a purchase claim, so
    // the pin is on the figures and the claims, not on the words.
    expect(text).not.toMatch(/\$\d|\bUSD\b|\brefund\b|you paid|invoice|your card/i);
    // No email address outside the reserved domain.
    for (const address of text.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
      expect(address).toMatch(/\.example$/);
    }
  });
});

describe('the links that lead to it', () => {
  it('is linked from the home page’s sample, its pricing block and its footer', async () => {
    stubSignedOut();
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    const links = Array.from(
      document.querySelectorAll(`a[href="${EXAMPLE_REPORT_PATH}"]`),
      (link) => link.textContent ?? '',
    );
    expect(links.length).toBeGreaterThanOrEqual(3);
    expect(links.some((label) => label.includes(copy.en.home.example.fullLink))).toBe(true);
    expect(links.some((label) => label.includes(copy.en.pricing.exampleLink))).toBe(true);
    expect(links.some((label) => label.includes(copy.en.home.footer.exampleLink))).toBe(true);
  });

  it('leaves the home page’s own requests unchanged', async () => {
    const fetchMock = stubSignedOut();
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });

    expect(requestedPaths(fetchMock)).toEqual(PUBLIC_PAGE_REQUESTS);
  });
});
