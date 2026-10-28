import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ANALYTICS_HOSTNAME, GA_MEASUREMENT_ID, GA_SCRIPT_ORIGIN } from './analytics-config';
import {
  PLAUSIBLE_EVENT_PATH,
  PLAUSIBLE_SCRIPT_PATH,
  PLAUSIBLE_SITE_SCRIPT,
  PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER,
} from './plausible-config';
import { cookieCopy } from './cookie-copy';
import { copy } from './i18n';
import { COOKIE_CONSENT_TTL_MS, saveCookieConsent } from './browser-consent';

// The blog is static HTML served straight from `public/`, so it has no
// component to render in a test. These tests read the shipped files instead:
// the first group pins the markup contract every page has to keep, and the
// second runs the real `blog.js` against the real index markup.

// Vitest runs with `apps/web` as its working directory.
const BLOG_ROOT = resolve(process.cwd(), 'public/blog');

const ARTICLE_PAGES = [
  'ai-crawler-readiness/index.html',
  'public-website-audit-checklist/index.html',
  'bezpeka-ta-dostupnist-publichnyy-skaner/index.html',
  'tekhnichnyy-seo-publichnyy-audyt/index.html',
  'uk/pryvachnist-ta-cookie/index.html',
  'uk/tekhnichne-seo-audyt/index.html',
  'uk/novi-perevirky-saitu/index.html',
  'uk/ai-boty-poshuk-i-navchannia/index.html',
];

const PAGES = [
  'index.html',
  'ai-crawler-readiness/index.html',
  'public-website-audit-checklist/index.html',
  'bezpeka-ta-dostupnist-publichnyy-skaner/index.html',
  'tekhnichnyy-seo-publichnyy-audyt/index.html',
  'uk/pryvachnist-ta-cookie/index.html',
  'uk/tekhnichne-seo-audyt/index.html',
  'uk/novi-perevirky-saitu/index.html',
  'uk/ai-boty-poshuk-i-navchannia/index.html',
];

function readPage(name: string): string {
  return readFileSync(resolve(BLOG_ROOT, name), 'utf8');
}

// blog.js asks the API who is reading as soon as it runs. Every page here is a
// visitor's, so the request gets a visitor's 401 instead of the network;
// blog-session.test.ts covers a signed-in reader and the failures.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 401 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(html).toContain(
      `href="${readPage(name).includes('<html lang="uk">') ? '/uk/faq' : '/faq'}"`,
    );
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
    const style = readPage(name).match(/<noscript\s*>\s*<style>([\s\S]*?)<\/style>/)?.[1];
    expect(style?.replace(/\s/g, '')).toContain('[data-article-lang]{display:block!important;}');
  });

  it.each(PAGES)('%s localizes the system status line with the rest of the chrome', (name) => {
    expect(readPage(name)).toContain('data-t="nav.systemStatus"');
  });

  it('declares each article page in the language it is written in', () => {
    expect(readPage('ai-crawler-readiness/index.html')).toContain('<html lang="en">');
    expect(readPage('uk/tekhnichne-seo-audyt/index.html')).toContain('<html lang="uk">');
  });
});

// The React shell credits the studio in every footer it renders; the blog is
// served as flat files and had no such link at all. These pin the same contract
// on the static side — one attribution per page, in the page's own language.
describe('blog footer attribution', () => {
  const FLUXLAB_URL = 'https://flux-lab.dev';
  const ATTRIBUTION = { en: 'Created by FluxLab', uk: 'Створено FluxLab' };

  /** The footer alone: parsing the whole document would fetch its stylesheet. */
  function footerOf(name: string): Element {
    const markup = /<footer[\s\S]*?<\/footer>/.exec(readPage(name))?.[0];
    if (markup === undefined) throw new Error(`${name} has no footer`);
    const footer = new DOMParser().parseFromString(markup, 'text/html').querySelector('footer');
    if (footer === null) throw new Error(`${name} has an unparseable footer`);
    return footer;
  }

  /** The language the page declares for itself — the label has to follow it. */
  function languageOf(name: string): 'en' | 'uk' {
    return readPage(name).includes('<html lang="uk">') ? 'uk' : 'en';
  }

  it.each(PAGES)('%s credits the studio from its footer', (name) => {
    const links = footerOf(name).querySelectorAll(`a[href="${FLUXLAB_URL}"]`);
    expect(links).toHaveLength(1);
  });

  // A second copy would read as two attributions rather than one.
  it.each(PAGES)('%s carries the attribution exactly once', (name) => {
    expect(readPage(name).match(/powered-by__link/g)).toHaveLength(1);
  });

  it.each(PAGES)('%s writes the attribution in the language it declares', (name) => {
    const link = footerOf(name).querySelector('.powered-by__link');
    expect(link?.textContent).toContain(ATTRIBUTION[languageOf(name)]);
  });

  it.each(PAGES)('%s leaves for the studio site without handing it a window', (name) => {
    const link = footerOf(name).querySelector('.powered-by__link');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    // The new tab is announced, so following the link is not a surprise.
    expect(link?.getAttribute('aria-label')).toContain(ATTRIBUTION[languageOf(name)]);
    expect(link?.getAttribute('aria-label')?.length).toBeGreaterThan(
      ATTRIBUTION[languageOf(name)].length,
    );
  });

  // The links that were already in each footer keep the order they had.
  it('appends the attribution after the existing footer links', () => {
    const links = Array.from(footerOf('index.html').querySelectorAll('a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', FLUXLAB_URL]);
  });
});

describe('blog footer attribution styling', () => {
  const css = readFileSync(resolve(BLOG_ROOT, 'blog.css'), 'utf8');

  /** The body of a rule, so an assertion cannot match a declaration next door. */
  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`blog.css has no rule for ${selector}`);
    return css.slice(start, css.indexOf('}', start));
  }

  it('gives the attribution a row of its own in every footer shape', () => {
    const row = rule('.powered-by');
    expect(row).toMatch(/width: 100%;/);
    // Not `flex-basis`: wherever a footer is laid out as a column,
    // a percentage basis resolves against the height instead.
    expect(row).not.toMatch(/flex: 0 0 100%;/);
    expect(row).toMatch(/flex-wrap: wrap;/);
  });

  it('paints the link in the colour the rest of the blog uses for links', () => {
    // #333399 on the #efefef page surface: 8.8:1.
    expect(rule('.powered-by .powered-by__link')).toMatch(/color: var\(--selection\);/);
  });

  it('shows a focus ring of its own, whatever the page stylesheet does', () => {
    expect(rule('.powered-by .powered-by__link:focus-visible')).toMatch(/outline: 2px dotted/);
  });
});

// Regression: the header was the same markup on every page but not the same
// header — only the index told the reader which section they were in, and the
// blog switched to the burger 19px earlier than the React pages did.
describe('blog header renders the same way on every page variant', () => {
  const BASE_CSS = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
  const BLOG_CSS = readFileSync(resolve(BLOG_ROOT, 'blog.css'), 'utf8');

  /** The width of the first `max-width` query whose block holds `selector`. */
  function breakpointOf(css: string, selector: string): number {
    for (const query of css.matchAll(/@media \(max-width: (\d+)px\) \{/g)) {
      const start = query.index ?? 0;
      const block = css.slice(start, css.indexOf('\n}', start));
      if (block.includes(selector)) return Number(query[1]);
    }
    throw new Error(`no media query restyles ${selector}`);
  }

  /** The viewport width below which a stylesheet turns the burger on. */
  function burgerBreakpoint(css: string): number {
    return breakpointOf(css, '.menubar__toggle {');
  }

  /** Every destination the static header offers, in the order it offers them. */
  function headerOf(name: string): HTMLDivElement {
    const root = document.createElement('div');
    root.innerHTML = readPage(name);
    return root;
  }

  function destinations(name: string): string[] {
    return [...headerOf(name).querySelectorAll('.menubar__item')].map(
      (element) => element.textContent?.trim() ?? '',
    );
  }

  // Regression: the blog and /faq abbreviated the row to Home / FAQ / Blog while
  // every other page listed the workspace tabs too, so the navigation changed
  // shape under a reader who followed the Blog link out of the product.
  it.each(PAGES)('%s lists the destinations the product header lists', (name) => {
    expect(destinations(name)).toEqual(
      readPage(name).includes('<html lang="uk">')
        ? ['Головна', 'Мої сайти', 'Перевірка', 'Звіти', 'Інтеграції', 'FAQ', 'Блог']
        : ['Home', 'My sites', 'Scan', 'Reports', 'Integrations', 'FAQ', 'Blog'],
    );
  });

  it.each(PAGES)('%s keeps the public destinations as real links', (name) => {
    const hrefs = [...headerOf(name).querySelectorAll('a.menubar__item')].map((element) =>
      element.getAttribute('href'),
    );
    expect(hrefs).toEqual(
      readPage(name).includes('<html lang="uk">')
        ? ['/uk', '/uk/faq', '/blog']
        : ['/', '/faq', '/blog'],
    );
  });

  // The pages ship the tabs the way the product renders them for a reader who
  // is not signed in; blog.js turns them into links only once a session answers.
  it.each(PAGES)('%s shows the workspace tabs in the signed-out state', (name) => {
    const tabs = [...headerOf(name).querySelectorAll('button.menubar__item')];
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) expect(tab.hasAttribute('disabled')).toBe(true);
  });

  it.each(PAGES)('%s marks the blog as the section the reader is in', (name) => {
    const blogItem = /<a class="menubar__item[^"]*" href="\/blog"[^>]*>/.exec(readPage(name))?.[0];
    expect(blogItem).toContain('is-active');
    // The index is the page the link opens; an article only lives inside it.
    expect(blogItem).toContain(
      name === 'index.html' ? 'aria-current="page"' : 'aria-current="true"',
    );
  });

  it.each(PAGES)('%s names its main landmark the way the index does', (name) => {
    expect(readPage(name)).toContain('<main id="blog-main">');
  });

  it('switches to the burger at the width the React header switches at', () => {
    expect(burgerBreakpoint(BLOG_CSS)).toBe(burgerBreakpoint(BASE_CSS));
  });

  // A visitor's tabs are inert. Without the rule they would read as four live
  // controls in full contrast, which is not how the product draws them.
  it('greys the inert workspace tabs the way the React header greys them', () => {
    const declarations = (css: string) => {
      const start = css.indexOf('.menubar button:disabled {');
      if (start === -1) throw new Error('no disabled rule for menubar buttons');
      return css.slice(start, css.indexOf('}', start));
    };
    expect(declarations(BLOG_CSS)).toMatch(/color: var\(--plat-400\);/);
    expect(declarations(BLOG_CSS)).toMatch(/cursor: not-allowed;/);
    expect(declarations(BASE_CSS)).toMatch(/color: var\(--plat-400\);/);
  });

  // A disabled tab still matches `:hover`, so the selector has to exclude it or
  // an inert control lights up in the selection colour under the pointer.
  it('does not paint a disabled tab on hover, in either stylesheet', () => {
    expect(BLOG_CSS).toContain('.menubar button:hover:not(:disabled)');
    expect(BASE_CSS).toContain('.menubar button:hover:not(:disabled)');
    expect(BLOG_CSS).toContain('.menubar__links.is-open .menubar__item:hover:not(:disabled)');
  });

  // An article's own phone rules are typography, so they follow the shared page
  // rules at 700px. Only the header switches earlier, because only its row is
  // too wide for a tablet.
  it.each(ARTICLE_PAGES)('%s keeps its own responsive rules on the page width', (name) => {
    if (readPage(name).includes('class="blog-page content-page"')) {
      expect(readFileSync(resolve(BLOG_ROOT, 'content.css'), 'utf8')).toMatch(
        /@media\s*\(max-width:\s*699px\)[\s\S]*?\.content-page h1/,
      );
      return;
    }
    const inline = readPage(name).match(/@media\s*\(max-width:\s*\d+px\)/g) ?? [];
    expect(inline.length).toBeGreaterThan(0);
    for (const query of inline) {
      expect(query.replace(/\s/g, '')).toBe(
        `@media(max-width:${breakpointOf(BLOG_CSS, '.blog-page {')}px)`,
      );
    }
  });

  // Regression: the two sheets were written twice and drifted. The blog head
  // wrapped to two rows on the Ukrainian station name, its language button was
  // a 22px target in a column of 44px rows, and its rows, labels and brand each
  // started in a different column from the React sheet's.
  /**
   * Every declaration a selector picks up inside the burger media query. Base
   * splits some selectors over two rules where the blog writes one, so the
   * rules are read together rather than one at a time.
   */
  function mobileRule(css: string, selector: string): string {
    const query = css.indexOf(`@media (max-width: ${burgerBreakpoint(css)}px) {`);
    const block = css.slice(query, css.indexOf('\n}', query));
    const bodies: string[] = [];
    for (
      let at = block.indexOf(`${selector} {`);
      at !== -1;
      at = block.indexOf(`${selector} {`, at + 1)
    ) {
      bodies.push(block.slice(at, block.indexOf('}', at)));
    }
    if (bodies.length === 0) throw new Error(`no mobile rule for ${selector}`);
    return bodies.join('\n');
  }

  it('ellipsizes the sheet subtitle rather than wrapping the 44px head', () => {
    const status = mobileRule(BLOG_CSS, '.menubar__sheet-status');
    expect(status).toMatch(/min-width: 0;/);
    expect(status).toMatch(/overflow: hidden;/);
    expect(status).toMatch(/text-overflow: ellipsis;/);
    expect(status).toMatch(/white-space: nowrap;/);
  });

  // Regression: the sheet showed a visible "Language" / "МОВА" label the React
  // sheet hides, so the same header read differently on /blog and /faq.
  it('hides the language label from the sheet the way the React sheet hides it', () => {
    // Each sheet writes the rule under its own narrow-viewport query, so the
    // rule is read where it is rather than inside one particular query.
    const hidingRule = (css: string) => {
      const start = css.indexOf('.menubar__language > span {');
      if (start === -1) throw new Error('nothing hides the language label');
      return css.slice(start, css.indexOf('}', start));
    };
    expect(hidingRule(BLOG_CSS)).toMatch(/clip: rect\(0, 0, 0, 0\);/);
    expect(hidingRule(BASE_CSS)).toMatch(/clip: rect\(0, 0, 0, 0\);/);
    // Hidden, not removed: it is the combobox's accessible name.
    expect(hidingRule(BLOG_CSS)).not.toMatch(/display: none;/);
  });

  it('offers the same tap target on the language button the React sheet does', () => {
    const selector = '.menubar__links.is-open .menubar__language-button';
    expect(mobileRule(BLOG_CSS, selector)).toMatch(/min-height: 40px;/);
    expect(mobileRule(BASE_CSS, selector)).toMatch(/min-height: 40px;/);
  });

  it.each([
    '.menubar__sheet-head',
    '.menubar__group-label',
    '.menubar__links.is-open .menubar__language',
    '.menubar__language-listbox',
  ])('lays %s out on the shared sheet inset, as the React sheet does', (selector) => {
    /** The declarations that position a rule against the sheet's left edge. */
    const insetLines = (css: string) =>
      mobileRule(css, selector)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('var(--sheet-inset)'));

    expect(insetLines(BASE_CSS).length).toBeGreaterThan(0);
    expect(insetLines(BLOG_CSS)).toEqual(insetLines(BASE_CSS));
  });

  it('subtracts the active rail from the row padding instead of adding to it', () => {
    const row = mobileRule(BLOG_CSS, '.menubar__links.is-open .menubar__item');
    expect(row).toMatch(
      /padding: 0 var\(--sheet-inset\) 0 calc\(var\(--sheet-inset\) - var\(--sheet-rail\)\);/,
    );
    expect(row).toMatch(/margin: 0;/);
    expect(row).toMatch(/border-left: var\(--sheet-rail\) solid transparent;/);
  });
});

// Regression: the blog shipped three footer shapes — the index's `.site-footer`
// plus two inline article ones, one flex and one block — and on a short page all
// three floated in the middle of the screen above an empty desktop.
describe('blog footer is one shape, pinned to the bottom of a short page', () => {
  const css = readFileSync(resolve(BLOG_ROOT, 'blog.css'), 'utf8');

  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`blog.css has no rule for ${selector}`);
    return css.slice(start, css.indexOf('}', start));
  }

  it.each(PAGES)('%s uses the shared footer, not one of its own', (name) => {
    expect(readPage(name)).toContain('<footer class="site-footer">');
  });

  it.each(ARTICLE_PAGES)('%s no longer restyles the footer in its own stylesheet', (name) => {
    const inlineStyles = Array.from(
      readPage(name).matchAll(/<style>([\s\S]*?)<\/style>/g),
      (match) => match[1],
    ).join('\n');
    expect(inlineStyles).not.toMatch(/(^|[\s{;,])footer\s*\{/);
  });

  it('lets the page fill a viewport the content does not', () => {
    expect(rule('body')).toMatch(/min-height: 100dvh;/);
    expect(rule('body')).toMatch(/flex-direction: column;/);
    expect(rule('main')).toMatch(/flex: 1 0 auto;/);
  });

  // A sticky top of one viewport asks for a position below the fold; the card
  // clamps it back to its own bottom edge, which is the floor of a short page
  // and the end of the flow on a long one. Geometry is checked in a browser.
  it('sinks the footer to the floor without moving it on a long page', () => {
    expect(rule('.site-footer')).toMatch(/position: sticky;/);
    expect(rule('.site-footer')).toMatch(/top: 100vh;/);
    expect(rule('.site-footer')).toMatch(/margin-top: 40px;/);
  });
});

describe('blog language filter', () => {
  const source =
    readFileSync(resolve(BLOG_ROOT, 'attribution.js'), 'utf8') +
    readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

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

  // The static header keeps its own copy of the labels, so it can drift from the
  // product's. It has to read as the same header in both languages, not only in
  // the one the files ship in.
  it.each(['en', 'uk'] as const)(
    'names the destinations in %s the way the product does',
    (language) => {
      bootIndex();
      if (language === 'uk') filterButton('uk').click();
      const labels = copy[language].nav;

      const destinations = Array.from(document.querySelectorAll('.menubar__item')).map((item) =>
        item.textContent?.trim(),
      );
      expect(destinations).toEqual([
        labels.home,
        labels.profiles,
        labels.scan,
        labels.reports,
        labels.integrations,
        labels.faq,
        labels.blog,
      ]);
      expect(document.querySelector('[data-t="nav.profiles"]')?.getAttribute('title')).toBe(
        labels.descriptions.profiles,
      );
    },
  );

  it('translates the footer attribution along with the chrome', () => {
    bootIndex();
    const attribution = document.querySelector('[data-t="blog.poweredBy"]');
    const link = document.querySelector('.powered-by__link');
    expect(attribution?.textContent).toBe('Created by FluxLab');

    filterButton('uk').click();

    expect(attribution?.textContent).toBe('Створено FluxLab');
    expect(link?.getAttribute('aria-label')).toContain('Створено FluxLab');
  });

  it('remembers the choice under the key the product app reads', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    bootIndex();
    filterButton('uk').click();
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');
  });

  it('keeps the language filter usable without persisting it before cookie permission', () => {
    bootIndex();
    filterButton('uk').click();
    expect(document.documentElement.lang).toBe('uk');
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
  });

  it('honours ?lang=uk on entry so a shared link opens in the language it promises', () => {
    bootIndex('?lang=uk');
    expect(document.documentElement.getAttribute('data-blog-lang')).toBe('uk');
    expect(filterButton('uk').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('blog cookie choices', () => {
  const source =
    readFileSync(resolve(BLOG_ROOT, 'attribution.js'), 'utf8') +
    readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

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

  beforeEach(() => {
    window.localStorage.clear();
    bootIndex();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('data-blog-page');
    document.documentElement.removeAttribute('data-blog-lang');
    window.localStorage.clear();
    document.getElementById('fluxradar-ga')?.remove();
    delete window.dataLayer;
    // Booting blog.js on the production host also starts the cookieless count,
    // which asks for none of the choices this block makes. Left behind, its
    // tracker would be what the page-count block below finds already running.
    document.getElementById('fluxradar-plausible')?.remove();
    delete window.plausible;
    // Before the host changes back: a `domain=` write is rejected elsewhere.
    for (const name of ['_ga', '_gcl_aw', '_gcl_zz', 'fluxradar_session']) {
      document.cookie = `${name}=; Max-Age=0; path=/`;
      document.cookie = `${name}=; Max-Age=0; path=/; domain=.${ANALYTICS_HOSTNAME}`;
    }
    visit('http://localhost:3000/');
  });

  function visit(url: string): void {
    (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(url);
  }

  function choose(choice: 'necessary' | 'save' | 'all'): void {
    document.querySelector<HTMLElement>(`[data-cookie-choice="${choice}"]`)?.click();
  }

  function storedConsent(): unknown {
    return JSON.parse(window.localStorage.getItem('fluxradar.cookieConsent') ?? 'null');
  }

  /** Each gtag call as a plain array — dataLayer holds `arguments` objects. */
  function calls(): unknown[][] {
    return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
  }

  function pageViews(): unknown[] {
    return calls()
      .filter((call) => call[0] === 'event' && call[1] === 'page_view')
      .map((call) => call[2]);
  }

  function reportedPages(): unknown[] {
    return pageViews().map((params) => (params as { page_location: unknown }).page_location);
  }

  /**
   * Every string `run` assigns to `document.cookie`. happy-dom's jar neither
   * honours a past `expires` nor reads a cookie back once it was written with a
   * `domain`, so the deletions themselves are what a test can watch — and they
   * are what matters here, because the domain each one carries is the point.
   */
  function cookieWrites(run: () => void): readonly string[] {
    const written = vi.spyOn(document, 'cookie', 'set');
    try {
      run();
      return written.mock.calls.map(([value]) => String(value));
    } finally {
      written.mockRestore();
    }
  }

  /** Each cookie a deletion write names, as `name` or `name@<domain>`. */
  function deletedCookies(writes: readonly string[]): readonly string[] {
    return writes
      .filter((write) => write.includes('Max-Age=0'))
      .map((write) => {
        const name = write.slice(0, write.indexOf('='));
        const domain = /; domain=([^;]+)/.exec(write)?.[1];
        return domain === undefined ? name : `${name}@${domain}`;
      });
  }

  /** Both forms of the same name: host-only, and the registrable domain. */
  function bothDomainForms(names: readonly string[]): readonly string[] {
    return names.flatMap((name) => [name, `${name}@.${ANALYTICS_HOSTNAME}`]);
  }

  // The static banner carries its own copy of the app's wording, and the
  // analytics hint is the one line that has to match word for word: it names the
  // permission the banner asks for, and this banner saves the same v3 consent
  // and reports the same Google Ads click id as the app. A hint left behind
  // would ask for less than the choice actually grants.
  it.each(['en', 'uk'] as const)(
    'repeats the analytics permission the app asks for, word for word, in %s',
    (language) => {
      if (language !== 'en') {
        document.querySelector<HTMLElement>(`[data-language-filter="${language}"]`)?.click();
      }

      expect(document.getElementById('blog-cookie-analytics-hint')?.textContent).toBe(
        cookieCopy[language].analyticsHint,
      );
    },
  );

  it('offers equally direct choices with nothing optional ticked on a first blog visit', () => {
    const region = document.querySelector('[data-cookie-consent]');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.textContent).toContain('Cookies & storage');
    expect(region?.querySelector('[data-cookie-choice="necessary"]')).not.toBeNull();
    expect(region?.querySelector('[data-cookie-choice="save"]')).not.toBeNull();
    expect(region?.querySelector('[data-cookie-choice="all"]')).not.toBeNull();
    const options = [...(region?.querySelectorAll<HTMLInputElement>('[data-cookie-option]') ?? [])];
    expect(options.map((option) => [option.dataset.cookieOption, option.checked])).toEqual([
      ['preferences', false],
      ['analytics', false],
    ]);
    expect(region?.querySelector('a')?.getAttribute('href')).toBe('/cookies');
  });

  it('stores the current language only after preference permission and lets it be withdrawn', () => {
    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    choose('all');

    expect(storedConsent()).toMatchObject({ version: 'v3', preferences: true, analytics: true });
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');
    expect(document.querySelector('[data-cookie-consent]')).toBeNull();

    window.localStorage.setItem('fluxradar.pendingCheckout', 'pending-test');
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();
    choose('necessary');
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.pendingCheckout')).toBe('pending-test');
    expect(storedConsent()).toMatchObject({ version: 'v3', preferences: false, analytics: false });
  });

  it('saves only the categories that were ticked', () => {
    document.querySelector<HTMLElement>('[data-cookie-option="analytics"]')?.click();
    choose('save');

    expect(storedConsent()).toMatchObject({ version: 'v3', preferences: false, analytics: true });
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
  });

  // v1 predates the analytics category and v2 predates the Google Ads click
  // measurement inside it, so neither is an answer to what this banner asks —
  // and a v2 visitor who allowed analytics is asked again with the box empty.
  // The language permission each gave still stands; browser-consent.test.ts
  // pins the same two steps for the app.
  it.each([
    ['v1', {}],
    ['v2', { analytics: true }],
  ])(
    'keeps the language a %s visitor allowed while asking about analytics again',
    (version, answered) => {
      // One reading of the clock: the record is only valid when the lifetime is exact.
      const updatedAt = Date.now() - 1000;
      window.localStorage.setItem(
        'fluxradar.cookieConsent',
        JSON.stringify({
          version,
          preferences: true,
          ...answered,
          updatedAt,
          expiresAt: updatedAt + COOKIE_CONSENT_TTL_MS,
        }),
      );
      window.localStorage.setItem('fluxradar.language', 'uk');
      document.body.innerHTML = '';
      bootIndex();

      expect(document.documentElement.getAttribute('data-blog-lang')).toBe('uk');
      expect(document.querySelector('[data-cookie-consent]')).not.toBeNull();
      expect(
        document.querySelector<HTMLInputElement>('[data-cookie-option="preferences"]')?.checked,
      ).toBe(true);
      expect(
        document.querySelector<HTMLInputElement>('[data-cookie-option="analytics"]')?.checked,
      ).toBe(false);
    },
  );

  it('requests nothing from Google until analytics is allowed, then reports the page', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    bootIndex();
    window.history.replaceState(null, '', '/blog?lang=uk');
    expect(document.getElementById('fluxradar-ga')).toBeNull();
    expect(window.dataLayer).toBeUndefined();

    document.querySelector<HTMLElement>('[data-cookie-option="analytics"]')?.click();
    choose('save');

    expect(document.getElementById('fluxradar-ga')?.getAttribute('src')).toBe(
      `${GA_SCRIPT_ORIGIN}/gtag/js?id=${GA_MEASUREMENT_ID}`,
    );
    // The page view carries the path only: no ?lang=, and nothing a query could hold.
    expect(pageViews()).toEqual([
      expect.objectContaining({ page_location: 'https://fluxradar.net/blog' }),
    ]);
  });

  // The static pages carry the Google Ads click id exactly as the app does: in
  // the parameters of the page view that opens the visit, and only when the
  // query holds one well-formed id. config and set keep the cleaned address,
  // because gtag reads those for every later hit of the page as well.
  it.each([
    ['?gclid=AbC-123_xyz', 'https://fluxradar.net/blog?gclid=AbC-123_xyz'],
    ['?gclid=one&gclid=two', 'https://fluxradar.net/blog'],
    ['?gclid=not%20a%20click%20id', 'https://fluxradar.net/blog'],
    ['?lang=uk&reset_token=secret', 'https://fluxradar.net/blog'],
  ])('reports %s as %s', (search, expected) => {
    document.body.innerHTML = '';
    visit(`https://fluxradar.net/blog${search}`);
    bootIndex(search);
    choose('all');

    expect(pageViews()).toEqual([expect.objectContaining({ page_location: expected })]);
    const persistent = calls().filter((call) => call[0] === 'config' || call[0] === 'set');
    expect(persistent).toHaveLength(2);
    expect(persistent.find((call) => call[0] === 'config')?.[2]).toMatchObject({
      page_location: 'https://fluxradar.net/blog',
    });
    expect(persistent.find((call) => call[0] === 'set')?.[1]).toMatchObject({
      page_location: 'https://fluxradar.net/blog',
    });
    // Nothing but that one page view ever names the id.
    expect(calls().filter((call) => JSON.stringify(call).includes('gclid'))).toEqual(
      expected.includes('gclid')
        ? [['event', 'page_view', expect.objectContaining({ page_location: expected })]]
        : [],
    );
    expect(JSON.stringify(calls())).not.toContain('secret');
  });

  // The reader may use the language filter before answering the banner, and
  // that filter rewrites the address: applyLanguage() replaces /blog?gclid=...
  // with /blog?lang=uk. The id is therefore captured when the script starts,
  // not when the hit is sent — a send-time read would lose precisely the clicks
  // the ad was paid for.
  it('reports the click after the language filter has rewritten the address', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog?gclid=AbC-123_xyz');
    bootIndex('?gclid=AbC-123_xyz');

    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    expect(window.location.search).toBe('?lang=uk');
    choose('all');

    expect(reportedPages()).toEqual(['https://fluxradar.net/blog?gclid=AbC-123_xyz']);
  });

  // The campaign pair outlives that rewrite for the same reason, and it matters
  // for the same money: the filter drops ?utm_source= along with the click id,
  // and a pair read when the tag is configured would report the paid visit as
  // an organic one. It travels in config, never in a page_location.
  it('reports the campaign after the language filter has rewritten the address', () => {
    document.body.innerHTML = '';
    const search = '?utm_source=google&utm_medium=cpc';
    visit(`https://fluxradar.net/blog${search}`);
    bootIndex(search);

    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    expect(window.location.search).toBe('?lang=uk');
    choose('all');

    expect(calls().find((call) => call[0] === 'config')?.[2]).toMatchObject({
      campaign_source: 'google',
      campaign_medium: 'cpc',
      page_location: 'https://fluxradar.net/blog',
    });
    expect(reportedPages()).toEqual(['https://fluxradar.net/blog']);
    expect(JSON.stringify(calls())).not.toMatch(/utm_/);
  });

  // Coming back to the tab syncs analytics while the banner is still open, and
  // that sync must not re-read the address the filter has rewritten: the reader
  // has not answered yet, so the click is still theirs to report.
  it('keeps the click through a focus with the banner still unanswered', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog?gclid=AbC-123_xyz');
    bootIndex('?gclid=AbC-123_xyz');

    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    window.dispatchEvent(new Event('focus'));
    choose('all');

    expect(reportedPages()).toEqual(['https://fluxradar.net/blog?gclid=AbC-123_xyz']);
  });

  // Re-allowing analytics opens a new visit in GA's eyes, so the landing hit is
  // reported again: without that the ad click behind the visit would be lost.
  it('reports the click again when analytics is allowed a second time', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog?gclid=AbC-123_xyz');
    bootIndex('?gclid=AbC-123_xyz');
    choose('all');
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();
    choose('necessary');
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();
    choose('all');

    expect(reportedPages()).toEqual([
      'https://fluxradar.net/blog?gclid=AbC-123_xyz',
      'https://fluxradar.net/blog?gclid=AbC-123_xyz',
    ]);
  });

  it('stops reporting when analytics is withdrawn', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    bootIndex();
    choose('all');
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();
    choose('necessary');

    expect((window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`]).toBe(
      true,
    );
  });

  // The same opt-out the app takes (src/analytics.ts): without it gtag keeps the
  // ad click in first-party _gcl_* cookies of its own, which nothing here reads
  // — the click id travels in the landing page view's location, and no Google
  // Ads tag is loaded. A config-time setting, taken before gtag.js is
  // requested: support.google.com/google-ads/answer/2476688.
  it('turns the conversion linker off in the config call, and nowhere else', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    bootIndex();
    choose('all');

    const configured = calls().filter((call) => call[0] === 'config');
    expect(configured).toHaveLength(1);
    expect(configured[0]?.[1]).toBe(GA_MEASUREMENT_ID);
    expect(configured[0]?.[2]).toMatchObject({
      conversion_linker: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    expect(calls().filter((call) => JSON.stringify(call).includes('conversion_linker'))).toEqual(
      configured,
    );
  });

  // A reader who allowed analytics while the linker was still on carries its
  // cookie until a withdrawal clears it. Each name goes on both domain forms
  // gtag may have used, and _gcl_zz stands for a name Google has not
  // documented: only the prefix sweep reaches that one.
  it('deletes the conversion linker’s cookies as well, on both domain forms', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    bootIndex();
    choose('all');
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    document.cookie = '_gcl_zz=GCL.1.other; path=/';
    // The one necessary cookie in the Cookie Policy's inventory: it stays.
    document.cookie = 'fluxradar_session=keep; path=/';
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();

    const writes = cookieWrites(() => choose('necessary'));

    expect(new Set(deletedCookies(writes))).toEqual(
      new Set(
        bothDomainForms([
          '_ga',
          `_ga_${GA_MEASUREMENT_ID.replace(/^G-/, '')}`,
          '_gcl_aw',
          '_gcl_au',
          '_gcl_dc',
          '_gcl_gb',
          '_gcl_gs',
          '_gcl_zz',
        ]),
      ),
    );
    expect(document.cookie).not.toContain('_gcl_');
    expect(document.cookie).toContain('fluxradar_session=keep');
  });

  // The linker kept a second copy outside the jar: a _gcl_ls entry in
  // localStorage, which no cookie deletion reaches. A reader measured before the
  // opt-out shipped carries it until a withdrawal takes it away. Swept by
  // prefix, which is why _gcl_x goes as well, and never by name: the reader's
  // own fluxradar.* keys answer to the consent record, not to this.
  it('removes the linker’s localStorage keys on withdrawal, and only those', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    bootIndex();
    choose('all');
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');
    window.localStorage.setItem('_gcl_x', 'another');

    // Analytics withdrawn, the language permission left standing.
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();
    document.querySelector<HTMLElement>('[data-cookie-option="analytics"]')?.click();
    choose('save');

    expect(storedConsent()).toMatchObject({ version: 'v3', preferences: true, analytics: false });
    expect(window.localStorage.getItem('_gcl_ls')).toBeNull();
    expect(window.localStorage.getItem('_gcl_x')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.language')).toBe('en');
  });

  // Storage access can throw by itself where the browser has blocked site data,
  // and the withdrawal is the one thing that must still happen: gtag is told to
  // stop, its cookies go, and the banner still reports the save it could not
  // make instead of leaving the reader with a dead button.
  it('withdraws even when localStorage throws', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    bootIndex();
    choose('all');
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();
    const blocked = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });

    try {
      const writes = cookieWrites(() => choose('necessary'));

      expect(new Set(deletedCookies(writes))).toEqual(
        new Set(
          bothDomainForms([
            '_ga',
            `_ga_${GA_MEASUREMENT_ID.replace(/^G-/, '')}`,
            '_gcl_aw',
            '_gcl_au',
            '_gcl_dc',
            '_gcl_gb',
            '_gcl_gs',
          ]),
        ),
      );
      expect(
        (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`],
      ).toBe(true);
      expect(document.querySelector('.blog-cookie-consent__error')).not.toBeNull();
    } finally {
      blocked.mockRestore();
    }
  });

  // Both entries outlive the opt-out that stopped new ones: _gcl_aw has 90 days
  // of its own and _gcl_ls has no expiry at all, so a reader who accepted
  // analytics before the linker was turned off keeps them for months while
  // nothing reads either. Start-up therefore sweeps the prefix whatever the
  // reader has answered — and sweeps nothing else: _ga is the tag's working
  // cookie and belongs to a consent that is still standing.
  it('sweeps the linker\u2019s leftovers at start-up with analytics still allowed', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    saveCookieConsent({ preferences: true, analytics: true });
    window.localStorage.setItem('fluxradar.language', 'en');
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    document.cookie = '_gcl_zz=GCL.1.other; path=/';
    document.cookie = 'fluxradar_session=keep; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');

    const writes = cookieWrites(() => bootIndex());

    expect(new Set(deletedCookies(writes))).toEqual(
      new Set(bothDomainForms(['_gcl_aw', '_gcl_au', '_gcl_dc', '_gcl_gb', '_gcl_gs', '_gcl_zz'])),
    );
    expect(document.cookie).not.toContain('_gcl_');
    expect(window.localStorage.getItem('_gcl_ls')).toBeNull();
    // What the standing consent allowed is left exactly as it was.
    expect(document.cookie).toContain('_ga=GA1.1.123.456');
    expect(document.cookie).toContain('fluxradar_session=keep');
    expect(window.localStorage.getItem('fluxradar.language')).toBe('en');
    expect(document.getElementById('fluxradar-ga')).not.toBeNull();
    expect(pageViews()).toHaveLength(1);
  });

  // A reader who refused, or who has not answered the banner at all, is in the
  // same position: the entries are already on the device and nothing is ever
  // going to read them. The sweep waits for no consent event to arrive, and
  // still asks Google for nothing.
  it('sweeps the linker\u2019s leftovers at start-up with no consent on record', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    document.cookie = 'fluxradar_session=keep; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');

    bootIndex();

    expect(storedConsent()).toBeNull();
    expect(document.cookie).not.toContain('_gcl_');
    expect(window.localStorage.getItem('_gcl_ls')).toBeNull();
    expect(document.cookie).toContain('fluxradar_session=keep');
    expect(document.getElementById('fluxradar-ga')).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });

  // Off production the tag never ran, so there is nothing of Google's to find,
  // and the jar belongs to whoever else answers on that host. The sweep takes
  // the host check syncAnalytics already takes before it clears gtag's cookies.
  it('leaves the jar and storage alone at start-up on a host other than production', () => {
    document.body.innerHTML = '';
    visit('http://localhost:3000/blog');
    saveCookieConsent({ preferences: true, analytics: true });
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');

    const writes = cookieWrites(() => bootIndex());

    expect(deletedCookies(writes)).toEqual([]);
    expect(document.cookie).toContain('_gcl_aw=GCL.1.click');
    expect(window.localStorage.getItem('_gcl_ls')).toBe('{"sid":1}');
  });

  // Storage access can throw by itself where the browser has blocked site data,
  // and the page is not allowed to fail with it: the cookies still go, the
  // consent on record still takes effect, and the reader still gets the chrome.
  // The entry that could not be removed stays — the honest outcome.
  it('boots even when localStorage throws during the sweep', () => {
    document.body.innerHTML = '';
    visit('https://fluxradar.net/blog');
    saveCookieConsent({ preferences: true, analytics: true });
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');
    const blocked = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });

    try {
      expect(() => bootIndex()).not.toThrow();

      expect(document.cookie).not.toContain('_gcl_');
      expect(document.getElementById('fluxradar-ga')).not.toBeNull();
      expect(pageViews()).toHaveLength(1);
      expect(document.querySelector('[data-cookie-settings]')).not.toBeNull();
    } finally {
      blocked.mockRestore();
    }
    expect(window.localStorage.getItem('_gcl_ls')).toBe('{"sid":1}');
  });

  it('never reports from a host other than production', () => {
    choose('all');
    expect(document.getElementById('fluxradar-ga')).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });

  // blog.js is not part of the bundle, so it carries its own copy of the stream.
  it('reports into the same GA4 stream as the app', () => {
    expect(source).toContain(`var GA_MEASUREMENT_ID = '${GA_MEASUREMENT_ID}';`);
    expect(source).toContain(`var GA_SCRIPT_ORIGIN = '${GA_SCRIPT_ORIGIN}';`);
    expect(source).toContain(`var ANALYTICS_HOSTNAME = '${ANALYTICS_HOSTNAME}';`);
  });

  it('translates the cookie choice with the rest of the blog chrome', () => {
    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    const region = document.querySelector('[data-cookie-consent]');
    expect(region?.textContent).toContain('Cookies і сховище');
    expect(region?.textContent).toContain('Лише необхідні');
    expect(region?.querySelector('a')?.getAttribute('href')).toBe('/uk/cookies');
  });

  it('shows the choice on article pages as well as the blog index', () => {
    document.body.innerHTML = '';
    const html = readPage('ai-crawler-readiness/index.html');
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    window.history.replaceState(null, '', '/blog/ai-crawler-readiness');
    document.documentElement.lang = 'en';
    document.body.setAttribute('data-blog-page', 'article');
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
    new Function(source)();

    expect(document.querySelector('[data-cookie-consent]')?.textContent).toContain(
      'Cookies & storage',
    );
  });
});

describe('blog header controls', () => {
  const source =
    readFileSync(resolve(BLOG_ROOT, 'attribution.js'), 'utf8') +
    readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

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

// The blog's half of src/plausible.ts. Plausible is the one measurement here
// that runs without being allowed, so what this block really checks is that it
// earns that: nothing is written to the device, and no address, query or click
// id that could name a reader leaves the browser.
describe('the blog page count', () => {
  const SITE_SCRIPT = 'pa-7Ab3Kd9';
  const rawSource =
    readFileSync(resolve(BLOG_ROOT, 'attribution.js'), 'utf8') +
    readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

  /**
   * The blog with a site script id this file chose: a literal one, so the
   * assertions hold whatever id the site ships, or the placeholder, which is
   * what a build with no Plausible site of its own carries.
   */
  function sourceWith({ configured }: { readonly configured: boolean }): string {
    const siteScript = configured ? SITE_SCRIPT : PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER;
    const filled = rawSource.replace(
      `var PLAUSIBLE_SITE_SCRIPT = '${PLAUSIBLE_SITE_SCRIPT}';`,
      `var PLAUSIBLE_SITE_SCRIPT = '${siteScript}';`,
    );
    expect(filled).not.toBe(rawSource);
    return filled;
  }

  function boot(url: string, options: { readonly configured: boolean }): void {
    visit(url);
    const html = readPage('index.html');
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    document.documentElement.setAttribute('data-blog-lang', 'en');
    document.documentElement.lang = 'en';
    document.body.setAttribute('data-blog-page', 'index');
    document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
    new Function(sourceWith(options))();
  }

  function visit(url: string): void {
    (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(url);
  }

  function pageViews(): readonly string[] {
    const queued = (window.plausible?.q ?? []) as readonly (readonly unknown[])[];
    return queued
      .filter((call) => call[0] === 'pageview')
      .map((call) => (call[1] as { readonly url?: string } | undefined)?.url ?? '');
  }

  /** The tracker's own hook, as blog.js configured it. Null means "drop". */
  function transform(payload: Record<string, unknown>): Record<string, unknown> | null {
    const hook = window.plausible?.o?.transformRequest;
    if (hook === undefined) {
      expect.unreachable('blog.js configured the tracker without a transformRequest');
    }
    return hook(payload) as Record<string, unknown> | null;
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('data-blog-page');
    document.documentElement.removeAttribute('data-blog-lang');
    document.getElementById('fluxradar-plausible')?.remove();
    document.getElementById('fluxradar-ga')?.remove();
    delete window.plausible;
    delete window.dataLayer;
    window.localStorage.clear();
    visit('http://localhost:3000/');
  });

  // blog.js is not part of the bundle, so it carries its own copy of the three
  // values the proxy and the app have to agree on; DEPLOY-023 pins the third.
  it('counts into the same Plausible site as the app', () => {
    expect(rawSource).toContain(`var PLAUSIBLE_SITE_SCRIPT = '${PLAUSIBLE_SITE_SCRIPT}';`);
    expect(rawSource).toContain(`var PLAUSIBLE_SCRIPT_PATH = '${PLAUSIBLE_SCRIPT_PATH}';`);
    expect(rawSource).toContain(`var PLAUSIBLE_EVENT_PATH = '${PLAUSIBLE_EVENT_PATH}';`);
  });

  it('requests nothing while the site script id is the placeholder', () => {
    boot('https://fluxradar.net/blog', { configured: false });

    expect(document.getElementById('fluxradar-plausible')).toBeNull();
    expect(window.plausible).toBeUndefined();
  });

  it('never counts from a host other than production', () => {
    boot('http://localhost:3000/blog', { configured: true });

    expect(document.getElementById('fluxradar-plausible')).toBeNull();
    expect(window.plausible).toBeUndefined();
  });

  it('loads the tracker first-party, with automatic page views off', () => {
    boot('https://fluxradar.net/blog', { configured: true });

    const script = document.getElementById('fluxradar-plausible');
    expect(script?.getAttribute('src')).toBe(PLAUSIBLE_SCRIPT_PATH);
    expect(script?.getAttribute('src')).not.toMatch(/plausible\.io/);
    expect(window.plausible?.o?.autoCapturePageviews).toBe(false);
    expect(window.plausible?.o?.endpoint).toBe(PLAUSIBLE_EVENT_PATH);
  });

  it('sends one page view carrying the cleaned address', () => {
    boot('https://fluxradar.net/blog/ai-crawler-readiness', { configured: true });

    expect(pageViews()).toEqual(['https://fluxradar.net/blog/ai-crawler-readiness']);
  });

  it.each([
    ['the language filter', '?lang=uk'],
    ['a Google Ads click', '?gclid=EAIaIQobChMI'],
    ['an unapproved campaign', '?utm_source=spy&utm_medium=unknown'],
  ])('drops the query string of %s', (_label, search) => {
    boot(`https://fluxradar.net/blog${search}`, { configured: true });

    expect(pageViews()).toEqual(['https://fluxradar.net/blog']);
  });

  // Plausible reads the campaign out of the address it is given, so only the
  // fixed allowlist the app also uses travels there.
  it('forwards the approved campaign pair', () => {
    boot('https://fluxradar.net/blog?utm_source=instagram&utm_medium=social', {
      configured: true,
    });

    expect(pageViews()).toEqual([
      'https://fluxradar.net/blog?utm_source=instagram&utm_medium=social',
    ]);
  });

  it('writes no cookie and no storage key of its own', () => {
    boot('https://fluxradar.net/blog', { configured: true });

    expect(document.cookie).not.toMatch(/plausible/);
    expect(Object.keys({ ...window.localStorage })).not.toContain('plausible_ignore');
  });

  // The automatic captures are switched on in the Plausible dashboard and
  // compiled into the script it serves, so nothing in this file can see whether
  // they are on; an init option is what overrides them. Every article links
  // out, and the outbound capture reports props.url — the href whole.
  it('turns every automatic capture off by name', () => {
    boot('https://fluxradar.net/blog', { configured: true });

    expect(window.plausible?.o).toMatchObject({
      autoCapturePageviews: false,
      outboundLinks: false,
      fileDownloads: false,
      formSubmissions: false,
      hashBasedRouting: false,
    });
  });

  // The other half, which holds even if one is switched back on: a null answer
  // makes the tracker drop the request, and only a page view is ever not null.
  it.each([
    [
      'an outbound link click',
      { n: 'Outbound Link: Click', p: { url: 'https://customer.example.com/pricing?ref=abc' } },
    ],
    [
      'a file download',
      { n: 'File Download', p: { url: 'https://fluxradar.net/reports/abc123.pdf?token=secret' } },
    ],
    ['a form submission', { n: 'Form: Submission' }],
  ])('refuses to send %s', (_label, payload) => {
    boot('https://fluxradar.net/blog', { configured: true });

    expect(transform(payload)).toBeNull();
  });

  it('cleans a page view referrer into a copy, leaving the tracker payload alone', () => {
    boot('https://fluxradar.net/blog', { configured: true });
    const payload = { n: 'pageview', r: 'https://fluxradar.net/scans/abc123?token=secret' };

    const sent = transform(payload);

    expect(sent).toMatchObject({ r: 'https://fluxradar.net/scans/:id' });
    expect(sent).not.toBe(payload);
    expect(payload.r).toBe('https://fluxradar.net/scans/abc123?token=secret');
  });
});
