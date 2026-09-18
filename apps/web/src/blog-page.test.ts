import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copy } from './i18n';
import { saveCookieConsent } from './browser-consent';

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
];

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
  function destinations(name: string): string[] {
    return Array.from(
      readPage(name).matchAll(/<(a|button) class="menubar__item[^"]*"[^>]*>([^<]+)<\/\1>/g),
      (match) => match[2]?.trim() ?? '',
    );
  }

  // Regression: the blog and /faq abbreviated the row to Home / FAQ / Blog while
  // every other page listed the workspace tabs too, so the navigation changed
  // shape under a reader who followed the Blog link out of the product.
  it.each(PAGES)('%s lists the destinations the product header lists', (name) => {
    expect(destinations(name)).toEqual([
      'Home',
      'Profiles',
      'Scan',
      'Reports',
      'Integrations',
      'FAQ',
      'Blog',
    ]);
  });

  it.each(PAGES)('%s keeps the public destinations as real links', (name) => {
    const hrefs = Array.from(
      readPage(name).matchAll(/class="menubar__item[^"]*" href="([^"]+)"/g),
      (match) => match[1],
    );
    expect(hrefs).toEqual(['/', '/faq', '/blog']);
  });

  // Flat files have no session, so the tabs behind one render the way the
  // product renders them for a reader who is not signed in.
  it.each(PAGES)('%s shows the workspace tabs in the signed-out state', (name) => {
    const tabs = Array.from(
      readPage(name).matchAll(/<button class="menubar__item"[^>]*>/g),
      (match) => match[0],
    );
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) expect(tab).toContain(' disabled ');
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

  // The tabs are inert on flat files. Without the rule they would read as four
  // live controls in full contrast, which is not how the product draws them.
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
    saveCookieConsent(true);
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
  const source = readFileSync(resolve(BLOG_ROOT, 'blog.js'), 'utf8');

  function bootIndex(): void {
    const html = readPage('index.html');
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
    window.history.replaceState(null, '', '/blog');
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
  });

  it('offers equally direct necessary and preference choices on a first blog visit', () => {
    const region = document.querySelector('[data-cookie-consent]');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.textContent).toContain('Cookies & storage');
    expect(region?.querySelector('[data-cookie-choice="necessary"]')).not.toBeNull();
    expect(region?.querySelector('[data-cookie-choice="preferences"]')).not.toBeNull();
    expect(region?.querySelector('a')?.getAttribute('href')).toBe('/cookies?lang=en');
  });

  it('stores the current language only after preference permission and lets it be withdrawn', () => {
    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    document.querySelector<HTMLElement>('[data-cookie-choice="preferences"]')?.click();

    expect(
      JSON.parse(window.localStorage.getItem('fluxradar.cookieConsent') ?? 'null'),
    ).toMatchObject({
      version: 'v1',
      preferences: true,
    });
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');
    expect(document.querySelector('[data-cookie-consent]')).toBeNull();

    window.localStorage.setItem('fluxradar.pendingCheckout', 'pending-test');
    document.querySelector<HTMLElement>('[data-cookie-settings]')?.click();
    document.querySelector<HTMLElement>('[data-cookie-choice="necessary"]')?.click();
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.pendingCheckout')).toBe('pending-test');
    expect(
      JSON.parse(window.localStorage.getItem('fluxradar.cookieConsent') ?? 'null'),
    ).toMatchObject({
      version: 'v1',
      preferences: false,
    });
  });

  it('translates the cookie choice with the rest of the blog chrome', () => {
    document.querySelector<HTMLElement>('[data-language-filter="uk"]')?.click();
    const region = document.querySelector('[data-cookie-consent]');
    expect(region?.textContent).toContain('Cookies і сховище');
    expect(region?.textContent).toContain('Лише необхідні');
    expect(region?.querySelector('a')?.getAttribute('href')).toBe('/cookies?lang=uk');
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
