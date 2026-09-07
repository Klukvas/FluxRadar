import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The blog is static HTML served straight from `public/`, so it has no
// component to render in a test. These tests read the shipped files instead:
// the first group pins the markup contract every page has to keep, and the
// second runs the real `blog.js` against the real index markup.

// Vitest runs with `apps/web` as its working directory.
const BLOG_ROOT = resolve(process.cwd(), 'public/blog');

const PAGES = [
  'index.html',
  'ai-crawler-readiness/index.html',
  'public-website-audit-checklist/index.html',
  'bezpeka-ta-dostupnist-publichnyy-skaner/index.html',
  'tekhnichnyy-seo-publichnyy-audyt/index.html',
  'uk/pryvachnist-ta-cookie/index.html',
  'uk/tekhnichne-seo-audyt/index.html',
];

function readPage(name: string): string {
  return readFileSync(resolve(BLOG_ROOT, name), 'utf8');
}

describe('blog pages share one header with the app', () => {
  it.each(PAGES)('%s loads the shared header stylesheet and script', (name) => {
    const html = readPage(name);
    expect(html).toContain('<link rel="stylesheet" href="/blog/blog.css" />');
    expect(html).toContain('<script src="/blog/blog.js"></script>');
  });

  it.each(PAGES)('%s renders the same menubar as the product header', (name) => {
    const html = readPage(name);
    expect(html).toContain('class="menubar"');
    expect(html).toContain('class="menubar__apple"');
    expect(html).toContain('id="menubar-links"');
    expect(html).toContain('href="/faq"');
  });

  it.each(PAGES)('%s offers the full-screen burger sheet on a narrow viewport', (name) => {
    const html = readPage(name);
    expect(html).toContain('class="menubar__toggle"');
    expect(html).toContain('aria-controls="menubar-links"');
    expect(html).toContain('class="menubar__sheet-head"');
    expect(html).toContain('data-menu-close');
  });

  it.each(PAGES)('%s offers the custom language dropdown, not a bare link pair', (name) => {
    const html = readPage(name);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('id="menubar-language-listbox"');
    expect(html).toContain('data-language-option="en"');
    expect(html).toContain('data-language-option="uk"');
  });

  // Regression: three different bespoke headers used to ship across the blog.
  it.each(PAGES)('%s no longer carries the old bespoke nav markup', (name) => {
    const html = readPage(name);
    expect(html).not.toContain('data-site-nav');
    expect(html).not.toContain('class="mobile-menu"');
    expect(html).not.toContain('class="menu-toggle"');
  });

  it('lists articles in both languages on the index, each tagged with its language', () => {
    const html = readPage('index.html');
    expect(html).toContain('data-article-lang="en"');
    expect(html).toContain('data-article-lang="uk"');
    expect(html).toContain('data-language-filter="en"');
    expect(html).toContain('data-language-filter="uk"');
  });

  // Without JavaScript the language filter cannot be changed, so the page must
  // not ship pre-filtered and strand half the articles.
  it.each(PAGES)('%s shows every article when JavaScript is off', (name) => {
    expect(readPage(name)).toContain(
      '<noscript><style>[data-article-lang] { display: block !important; }</style></noscript>',
    );
  });

  it.each(PAGES)('%s localizes the system status line with the rest of the chrome', (name) => {
    expect(readPage(name)).toContain('data-t="nav.systemStatus"');
  });

  it('declares each article page in the language it is written in', () => {
    expect(readPage('ai-crawler-readiness/index.html')).toContain('<html lang="en">');
    expect(readPage('uk/tekhnichne-seo-audyt/index.html')).toContain('<html lang="uk">');
  });
});

describe('blog language filter', () => {
  const source = readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

  function bootIndex(search = ''): void {
    const html = readPage('index.html');
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    window.history.replaceState(null, '', `/blog${search}`);
    document.documentElement.setAttribute('data-blog-lang', 'en');
    document.documentElement.lang = 'en';
    document.body.setAttribute('data-blog-page', 'index');
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
    new Function(source)();
  }

  function filterButton(language: string): HTMLElement {
    const button = document.querySelector<HTMLElement>(`[data-language-filter="${language}"]`);
    if (button === null) throw new Error(`missing ${language} filter button`);
    return button;
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('data-blog-page');
    document.documentElement.removeAttribute('data-blog-lang');
  });

  it('opens in English and marks the English filter as the active one', () => {
    bootIndex();
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('en');
    expect(filterButton('en').getAttribute('aria-pressed')).toBe('true');
    expect(filterButton('uk').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows only Ukrainian articles once Ukrainian is picked', () => {
    bootIndex();
    filterButton('uk').click();
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('uk');
    expect(document.documentElement.lang).toBe('uk');
    expect(filterButton('uk').getAttribute('aria-pressed')).toBe('true');
    expect(window.location.search).toBe('?lang=uk');
  });

  it('switches back to English and restores the default URL', () => {
    bootIndex('?lang=uk');
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('uk');
    filterButton('en').click();
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('en');
    expect(window.location.pathname).toBe('/blog');
    expect(window.location.search).toBe('');
  });

  it('translates the page chrome, not only the article list', () => {
    bootIndex();
    const title = document.querySelector('[data-t="blog.title"]');
    expect(title?.textContent).toBe('Field notes for healthier websites.');
    filterButton('uk').click();
    expect(title?.textContent).toBe('Польові нотатки для здоровіших сайтів.');
    expect(document.querySelector('[data-t="nav.home"]')?.textContent).toBe('Головна');
  });

  it('remembers the choice under the key the product app reads', () => {
    bootIndex();
    filterButton('uk').click();
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');
  });

  it('honours ?lang=uk on entry so a shared link opens in the language it promises', () => {
    bootIndex('?lang=uk');
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('uk');
    expect(filterButton('uk').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('blog header controls', () => {
  const source = readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

  function bootIndex(): void {
    const html = readPage('index.html');
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    window.history.replaceState(null, '', '/blog');
    document.body.setAttribute('data-blog-page', 'index');
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
    new Function(source)();
  }

  function listbox(): HTMLElement {
    const element = document.getElementById('menubar-language-listbox');
    if (element === null) throw new Error('missing language listbox');
    return element;
  }

  function languageButton(): HTMLElement {
    const element = document.querySelector<HTMLElement>('[data-language-button]');
    if (element === null) throw new Error('missing language button');
    return element;
  }

  beforeEach(() => {
    window.localStorage.clear();
    bootIndex();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('data-blog-page');
    document.documentElement.removeAttribute('data-blog-lang');
  });

  it('opens and closes the language dropdown from its own button', () => {
    expect(listbox().hidden).toBe(true);
    languageButton().click();
    expect(listbox().hidden).toBe(false);
    expect(languageButton().getAttribute('aria-expanded')).toBe('true');
    languageButton().click();
    expect(listbox().hidden).toBe(true);
  });

  it('closes the language dropdown when the reader clicks outside it', () => {
    languageButton().click();
    expect(listbox().hidden).toBe(false);
    document
      .querySelector('h1')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    expect(listbox().hidden).toBe(true);
    expect(languageButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the dropdown open while the click lands inside it', () => {
    languageButton().click();
    listbox().dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    expect(listbox().hidden).toBe(false);
  });

  it('closes the language dropdown on Escape', () => {
    languageButton().click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(listbox().hidden).toBe(true);
  });

  it('filters the blog from the header dropdown, not only from the filter bar', () => {
    languageButton().click();
    document.querySelector<HTMLElement>('[data-language-option="uk"]')?.click();
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('uk');
    expect(document.querySelector('[data-language-current]')?.textContent).toBe('Українська');
  });

  it('opens the burger sheet full screen and closes it again', () => {
    const toggle = document.querySelector<HTMLElement>('[data-menu-toggle]');
    const sheet = document.getElementById('menubar-links');
    expect(sheet?.classList.contains('is-open')).toBe(false);
    toggle?.click();
    expect(sheet?.classList.contains('is-open')).toBe(true);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    document.querySelector<HTMLElement>('[data-menu-close]')?.click();
    expect(sheet?.classList.contains('is-open')).toBe(false);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the burger sheet on Escape', () => {
    document.querySelector<HTMLElement>('[data-menu-toggle]')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('menubar-links')?.classList.contains('is-open')).toBe(false);
  });
});
