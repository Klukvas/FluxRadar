import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { copy } from './i18n';
import { pageMetadata, pageStructuredData, publicPageUrl } from './seo';

// The public pages are all served from one `index.html`, so what separates them
// for a search engine — title, description, canonical, alternates — is decided
// at runtime. These tests pin that, and the Ukrainian rendering of the two long
// public documents.

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST_ERROR', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function stubApi(handler: (path: string) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(new URL(String(input)).pathname)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const signedOut = (path: string): Response =>
  path === '/auth/me' ? failure(401, 'session required') : envelope(null);

function canonical(): string | null {
  return document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
}

function alternates(): Record<string, string> {
  const links = document.head.querySelectorAll('link[rel="alternate"]');
  return Object.fromEntries(
    Array.from(links, (link) => [
      link.getAttribute('hreflang') ?? '',
      link.getAttribute('href') ?? '',
    ]),
  );
}

function metaContent(selector: string): string | null {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null;
}

function structuredData(): unknown[] {
  return Array.from(
    document.head.querySelectorAll('script[type="application/ld+json"][data-fluxradar-seo]'),
    (script) => JSON.parse(script.textContent ?? 'null'),
  );
}

function switchLanguageToUkrainian(): void {
  fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
  fireEvent.click(screen.getByRole('option', { name: 'Українська' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  for (const managed of document.head.querySelectorAll('[data-fluxradar-seo]')) managed.remove();
});

describe('public page metadata', () => {
  it('gives every public page its own English and Ukrainian URL', () => {
    expect(publicPageUrl('home', 'en')).toBe('https://fluxradar.net/');
    expect(publicPageUrl('home', 'uk')).toBe('https://fluxradar.net/?lang=uk');
    expect(publicPageUrl('faq', 'en')).toBe('https://fluxradar.net/faq');
    expect(publicPageUrl('faq', 'uk')).toBe('https://fluxradar.net/faq?lang=uk');
  });

  it('gives each public page a distinct title and description in both languages', () => {
    for (const language of ['en', 'uk'] as const) {
      const titles = (['home', 'faq', 'checks', 'bot', 'privacy', 'terms'] as const).map(
        (page) => pageMetadata(page, language).title,
      );
      expect(new Set(titles).size).toBe(titles.length);
      for (const title of titles) expect(title.length).toBeGreaterThan(10);
    }
  });

  it('gives the crawler page its own indexable URL in both languages', () => {
    // The user agent every request carries points here, so the address has to
    // resolve to a page a stranger can read and a crawler can index.
    expect(publicPageUrl('bot', 'en')).toBe('https://fluxradar.net/bot');
    expect(publicPageUrl('bot', 'uk')).toBe('https://fluxradar.net/bot?lang=uk');
    expect(pageMetadata('bot', 'en').indexable).toBe(true);
  });

  it('lists every public page in the sitemap, in both languages', () => {
    // A page that exists but is not listed is a page nobody finds. The list is
    // a file rather than generated code, so nothing else would catch a page
    // added to the app and forgotten here.
    const sitemap = readFileSync(resolve(__dirname, '../public/sitemap.xml'), 'utf8');
    for (const page of ['home', 'faq', 'checks', 'bot', 'privacy', 'terms', 'cookies'] as const) {
      for (const language of ['en', 'uk'] as const) {
        expect(sitemap).toContain(`<loc>${publicPageUrl(page, language)}</loc>`);
      }
    }
  });

  it('keeps signed-in screens out of the index instead of describing them as the home page', () => {
    const workspace = pageMetadata('workspace', 'en');
    expect(workspace.indexable).toBe(false);
    expect(workspace.canonical).toBeNull();
    expect(workspace.alternates).toEqual({});
  });

  it('declares both languages and an x-default for every public page', () => {
    expect(pageMetadata('checks', 'uk').alternates).toEqual({
      en: 'https://fluxradar.net/checks',
      uk: 'https://fluxradar.net/checks?lang=uk',
      'x-default': 'https://fluxradar.net/checks',
    });
  });

  it('publishes FAQ structured data that matches the questions on the page', () => {
    const data = pageStructuredData('faq', 'en') as {
      '@type': string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(data['@type']).toBe('FAQPage');
    const visible = copy.en.faq.sections.flatMap((section) => section.entries);
    expect(data.mainEntity).toHaveLength(visible.length);
    expect(data.mainEntity[0]?.name).toBe(visible[0]?.question);
    expect(data.mainEntity[0]?.acceptedAnswer.text).toContain(visible[0]?.answer[0]);
  });

  it('publishes only the two products it actually sells, at the printed prices', () => {
    const data = pageStructuredData('home', 'en') as {
      '@graph': { name: string; offers: { price: string; priceCurrency: string } }[];
    };
    expect(data['@graph']).toHaveLength(2);
    expect(data['@graph'].map((product) => product.offers.price)).toEqual(['55', '120']);
    expect(data['@graph'].every((product) => product.offers.priceCurrency === 'USD')).toBe(true);
  });

  it('declares no structured data on pages that show none of it', () => {
    expect(pageStructuredData('privacy', 'en')).toBeNull();
    expect(pageStructuredData('terms', 'uk')).toBeNull();
    expect(pageStructuredData('checks', 'en')).toBeNull();
    expect(pageStructuredData('bot', 'en')).toBeNull();
  });
});

describe('public page metadata in the rendered app', () => {
  // Regression: every public route used to inherit the home page's canonical
  // from index.html, telling crawlers they were all the same document.
  it('gives the FAQ its own canonical, title and alternates', async () => {
    window.history.replaceState(null, '', '/faq');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: copy.en.faq.title });

    expect(canonical()).toBe('https://fluxradar.net/faq');
    expect(document.title).toBe(copy.en.seo.faq.title);
    expect(metaContent('meta[name="description"]')).toBe(copy.en.seo.faq.description);
    expect(metaContent('meta[property="og:url"]')).toBe('https://fluxradar.net/faq');
    expect(alternates()).toEqual({
      en: 'https://fluxradar.net/faq',
      uk: 'https://fluxradar.net/faq?lang=uk',
      'x-default': 'https://fluxradar.net/faq',
    });
    expect(structuredData()).toHaveLength(1);
  });

  it('gives the coverage document its own canonical, not the home page one', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });

    expect(canonical()).toBe('https://fluxradar.net/checks');
    expect(document.title).toBe(copy.en.seo.checks.title);
  });

  it('opens in Ukrainian from ?lang=uk and points the canonical at that URL', async () => {
    window.history.replaceState(null, '', '/faq?lang=uk');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: copy.uk.faq.title });

    expect(document.documentElement.lang).toBe('uk');
    expect(canonical()).toBe('https://fluxradar.net/faq?lang=uk');
    expect(document.title).toBe(copy.uk.seo.faq.title);
    expect(metaContent('meta[property="og:locale"]')).toBe('uk_UA');
  });

  it('follows the language switch on the home page', async () => {
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'One URL. Every signal.' });
    expect(canonical()).toBe('https://fluxradar.net/');

    switchLanguageToUkrainian();

    expect(document.title).toBe(copy.uk.seo.home.title);
    expect(canonical()).toBe('https://fluxradar.net/?lang=uk');
  });
});

describe('audit coverage page in Ukrainian', () => {
  it('renders the whole document in Ukrainian, not only the header', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });

    switchLanguageToUkrainian();

    expect(await screen.findByRole('heading', { name: 'Обсяг аудиту' })).toBeInTheDocument();
    for (const section of copy.uk.checks.sections) {
      expect(screen.getByRole('heading', { name: section.title })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: copy.uk.checks.back })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('heading', { name: 'Audit coverage' })).not.toBeInTheDocument();
  });

  it('keeps every index entry pointing at a section that exists', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });

    const index = screen.getByRole('navigation', { name: copy.en.checks.contents });
    const anchors = Array.from(index.querySelectorAll('a'));
    expect(anchors.length).toBe(copy.en.checks.sections.length);
    for (const anchor of anchors) {
      const id = anchor.getAttribute('href')?.slice(1) ?? '';
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('still names the standards it measures against without claiming certification', async () => {
    window.history.replaceState(null, '', '/checks');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'Audit coverage' });
    switchLanguageToUkrainian();

    expect(
      await screen.findByRole('heading', {
        name: 'Доступність — WCAG 2.2 AA / EN 301 549 / Section 508',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Чого FluxRadar не сертифікує' }),
    ).toBeInTheDocument();
  });
});

describe('legal pages', () => {
  it('renders the document chrome in Ukrainian and says which language binds', async () => {
    window.history.replaceState(null, '', '/privacy');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'Privacy policy' });

    switchLanguageToUkrainian();

    expect(
      await screen.findByRole('heading', { name: 'Політика приватності' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.uk.legal.back })).toHaveAttribute('href', '/');
    expect(screen.getByText(copy.uk.legal.languageNotice)).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: copy.uk.legal.contentsLabel }),
    ).toBeInTheDocument();
  });

  it('marks English as an informational translation', async () => {
    window.history.replaceState(null, '', '/terms');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'Terms of service' });

    expect(screen.getByText(copy.en.legal.languageNotice)).toBeInTheDocument();
  });

  it('points every document-map entry at a section on the page', async () => {
    window.history.replaceState(null, '', '/privacy');
    stubApi(signedOut);
    render(<App />);
    await screen.findByRole('heading', { name: 'Privacy policy' });

    const index = screen.getByRole('navigation', { name: copy.en.legal.contentsLabel });
    const anchors = Array.from(index.querySelectorAll('a[href^="#"]'));
    expect(anchors).toHaveLength(copy.en.legal.privacy.sections.length);
    for (const anchor of anchors) {
      expect(document.getElementById(anchor.getAttribute('href')?.slice(1) ?? '')).not.toBeNull();
    }
  });
});
