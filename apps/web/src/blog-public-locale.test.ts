import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd(), 'public/blog');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const source = ['public-links.js', 'attribution.js', 'blog.js']
  .map((file) => readFileSync(resolve(root, file), 'utf8'))
  .join('\n');
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))),
  );
  document.body.innerHTML =
    /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, '') ?? '';
  document.body.setAttribute('data-blog-page', 'index');
  document.documentElement.lang = 'en';
  window.history.replaceState(null, '', '/blog?lang=uk');
  new Function(source)();
});
afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('data-blog-page');
  localStorage.clear();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
function destinations() {
  return [
    '.menubar__apple',
    '.menubar [data-t="nav.home"]',
    '.menubar [data-t="nav.faq"]',
    '.site-footer [data-t="blog.footerHome"]',
  ].map((selector) => document.querySelector(selector)?.getAttribute('href'));
}
/** Re-boots the blog scripts at one address, as a fresh visit would. */
function visit(url: string): void {
  document.body.innerHTML =
    /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, '') ?? '';
  document.body.setAttribute('data-blog-page', 'index');
  document.documentElement.lang = 'en';
  window.history.replaceState(null, '', url);
  new Function(source)();
}

/** A live v3 consent record, so a stored language is allowed to be read. */
function allowPreferences(): void {
  const updatedAt = Date.now() - 1000;
  localStorage.setItem(
    'fluxradar.cookieConsent',
    JSON.stringify({
      version: 'v3',
      preferences: true,
      analytics: false,
      updatedAt,
      expiresAt: updatedAt + 180 * 24 * 60 * 60 * 1000,
    }),
  );
}

describe('blog public destinations follow the selected locale', () => {
  it('keeps the Ukrainian initial filter linked to Ukrainian public documents', () => {
    expect(destinations()).toEqual(['/uk', '/uk', '/uk/faq', '/uk']);
  });
  // The blog and the knowledge base are written in English and Ukrainian only.
  // A Russian reader therefore reads a Ukrainian article list, and the links
  // that leave for the product still take them back to the Russian pages.
  it('sends a Russian reader back to the Russian public pages', () => {
    visit('/blog?lang=ru');
    expect(destinations()).toEqual(['/ru', '/ru', '/ru/faq', '/ru']);
  });

  it('writes the blog itself in a language it has articles in', () => {
    visit('/blog?lang=ru');
    // There is no Russian article set, so a Russian reader reads the Ukrainian
    // one: that is the language of their site and of their report, and English
    // is the one language they did not ask for. The filter still offers only
    // the two languages the blog is actually written in, and labelling the
    // page Russian would be a lie either way.
    expect(document.documentElement.lang).toBe('uk');
    expect(document.querySelector('[data-language-option="ru"]')).toBeNull();
    expect(
      Array.from(document.querySelectorAll('[data-language-filter]'), (node) =>
        node.getAttribute('data-language-filter'),
      ),
    ).toEqual(['en', 'uk']);
  });

  // The same reader arriving from the product rather than from a ?lang= link:
  // the app stored their interface language, and it has to be read the same way.
  it('reads a stored Russian interface language as the Ukrainian list', () => {
    allowPreferences();
    localStorage.setItem('fluxradar.language', 'ru');
    visit('/blog');
    expect(document.documentElement.lang).toBe('uk');
    expect(destinations()).toEqual(['/ru', '/ru', '/ru/faq', '/ru']);
  });

  it('lets a Russian reader choose the Ukrainian article list, links and all', () => {
    visit('/blog?lang=ru');
    document.querySelector<HTMLButtonElement>('[data-language-filter="uk"]')?.click();
    // Picking a filter is picking a language, so the destinations follow it.
    expect(destinations()).toEqual(['/uk', '/uk', '/uk/faq', '/uk']);
    expect(document.documentElement.lang).toBe('uk');
  });

  it('updates only fixed chrome links when the filter changes', () => {
    const articleLinks = Array.from(document.querySelectorAll('article a'), (node) =>
      node.getAttribute('href'),
    );
    document.querySelector<HTMLButtonElement>('[data-language-filter="en"]')?.click();
    expect(destinations()).toEqual(['/', '/', '/faq', '/']);
    document.querySelector<HTMLButtonElement>('[data-language-filter="uk"]')?.click();
    expect(destinations()).toEqual(['/uk', '/uk', '/uk/faq', '/uk']);
    expect(
      Array.from(document.querySelectorAll('article a'), (node) => node.getAttribute('href')),
    ).toEqual(articleLinks);
  });
});
