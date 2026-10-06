import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADMIN_STATS_PATH } from './admin-stats';
import type { Language } from './i18n';
import {
  PUBLIC_PAGE_PATHS,
  SITE_ORIGIN,
  applyPageMetadata,
  pageMetadata,
  pageStructuredData,
  publicPageUrl,
  type PublicPageId,
} from './seo';
import {
  renderStaticPageHead,
  staticHeadFileName,
  staticHeadPages,
  staticPageHeadFiles,
  type StaticHeadPageId,
} from './static-page-heads';
import { WORKSPACE_PATHS } from './workspace-paths';

// The production build writes these heads into dist/<path>/index.html, and the
// first response of every public page is that file. These tests run the same
// generator on the source index.html (the template the built one is made from,
// differing only in the hashed script tags) and pin three things: each file
// states its own page, the runtime replaces the static tags instead of
// stacking copies, and the release smoke check covers every page.

const WEB_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(WEB_ROOT, '..', '..');
const TEMPLATE = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf8');

const LANGUAGES: readonly Language[] = ['en', 'uk'];

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function count(document: Document, selector: string): number {
  return document.head.querySelectorAll(selector).length;
}

function content(document: Document, selector: string): string | null {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null;
}

function alternatesOf(document: Document): Record<string, string> {
  return Object.fromEntries(
    Array.from(document.head.querySelectorAll('link[rel="alternate"][hreflang]'), (link) => [
      link.getAttribute('hreflang') ?? '',
      link.getAttribute('href') ?? '',
    ]),
  );
}

function structuredDataOf(document: Document): unknown[] {
  return Array.from(
    document.head.querySelectorAll('script[type="application/ld+json"]'),
    (script) => JSON.parse(script.textContent ?? '') as unknown,
  );
}

const nonHomePaths = (): string[] =>
  (Object.entries(PUBLIC_PAGE_PATHS) as [PublicPageId, string][])
    .filter(([page]) => page !== 'home')
    .map(([, path]) => path);

const homeTitle = parse(TEMPLATE).title;
const templateStructuredData = structuredDataOf(parse(TEMPLATE));

describe('static page heads', () => {
  const files = staticPageHeadFiles(TEMPLATE);

  it.each(staticHeadPages())('gives %s its own head in the first response', (page) => {
    const html = renderStaticPageHead(TEMPLATE, page);
    const document = parse(html);
    const meta = pageMetadata(page, 'en');
    const canonical = publicPageUrl(page, 'en');

    expect(document.title).toBe(meta.title);
    expect(document.title).not.toBe(homeTitle);
    expect(count(document, 'title')).toBe(1);

    expect(count(document, 'link[rel="canonical"]')).toBe(1);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      canonical,
    );
    // The exact text deploy/public-smoke.sh greps for after a release.
    expect(html).toContain(`<link rel="canonical" href="${canonical}"`);

    expect(count(document, 'meta[name="description"]')).toBe(1);
    expect(content(document, 'meta[name="description"]')).toBe(meta.description);
    expect(count(document, 'meta[property="og:url"]')).toBe(1);
    expect(content(document, 'meta[property="og:url"]')).toBe(canonical);
    expect(content(document, 'meta[property="og:title"]')).toBe(meta.title);
    expect(content(document, 'meta[property="og:description"]')).toBe(meta.description);
    expect(content(document, 'meta[property="og:locale"]')).toBe('en_US');
    expect(content(document, 'meta[property="og:locale:alternate"]')).toBe('uk_UA');
    expect(content(document, 'meta[name="twitter:title"]')).toBe(meta.title);
    expect(content(document, 'meta[name="twitter:description"]')).toBe(meta.description);

    expect(alternatesOf(document)).toEqual(meta.alternates);
    expect(count(document, 'link[rel="alternate"][hreflang]')).toBe(
      Object.keys(meta.alternates).length,
    );
  });

  it.each(staticHeadPages())('declares the structured data of %s', (page) => {
    const document = parse(renderStaticPageHead(TEMPLATE, page));
    const own = pageStructuredData(page, 'en');
    // applyPageMetadata removes only marked scripts, so the unmarked site-wide
    // block stays on every page at runtime and the page's own block, if any,
    // sits beside it. The first response carries exactly the same pair.
    expect(structuredDataOf(document)).toEqual(
      own === null ? templateStructuredData : [...templateStructuredData, own],
    );
    expect(count(document, 'script[type="application/ld+json"]:not([data-fluxradar-seo])')).toBe(1);
    expect(
      count(document, 'script[type="application/ld+json"][data-fluxradar-seo="structured-data"]'),
    ).toBe(own === null ? 0 : 1);
  });

  it('keeps the built script and stylesheet tags of the template', () => {
    const built = TEMPLATE.replace(
      '</head>',
      '  <script type="module" crossorigin src="/assets/index-abc123.js"></script>\n</head>',
    );
    for (const page of staticHeadPages()) {
      expect(renderStaticPageHead(built, page)).toContain(
        '<script type="module" crossorigin src="/assets/index-abc123.js"></script>',
      );
    }
  });

  // A page added to seo.ts and skipped here would silently keep serving the
  // home page's head; the list is derived, and this holds it to that.
  it('writes one file for every public page except home, and nothing else', () => {
    expect(files.map((file) => file.fileName).sort()).toEqual(
      nonHomePaths()
        .map((path) => `${path.slice(1)}/index.html`)
        .sort(),
    );
  });

  it('writes nothing for home or for any signed-in screen', () => {
    const pages: readonly string[] = staticHeadPages();
    expect(pages).not.toContain('home');
    expect(pages).not.toContain('workspace');
    const fileNames = files.map((file) => file.fileName);
    expect(fileNames).not.toContain('index.html');
    // @ts-expect-error home keeps index.html itself, so it has no file name here.
    expect(() => staticHeadFileName('home')).toThrow(/not a plain page path/);
    for (const path of [...Object.values(WORKSPACE_PATHS), ADMIN_STATS_PATH, '/account']) {
      expect(fileNames.some((name) => name.startsWith(`${path.slice(1)}/`))).toBe(false);
    }
  });

  it('fails the build instead of shipping half a head', () => {
    const noCanonical = TEMPLATE.replace(/<link rel="canonical"[^>]*>/, '');
    expect(() => renderStaticPageHead(noCanonical, 'faq')).toThrow(/exactly one canonical/);
    const twoDescriptions = TEMPLATE.replace(
      '</head>',
      '<meta name="description" content="second" /></head>',
    );
    expect(() => renderStaticPageHead(twoDescriptions, 'faq')).toThrow(/found 2/);
  });
});

describe('static page heads at runtime', () => {
  let originalHead: string;
  let originalTitle: string;

  beforeEach(() => {
    originalHead = document.head.innerHTML;
    originalTitle = document.title;
  });

  afterEach(() => {
    document.head.innerHTML = originalHead;
    document.title = originalTitle;
  });

  function loadStaticHead(page: StaticHeadPageId): void {
    document.head.innerHTML = parse(renderStaticPageHead(TEMPLATE, page)).head.innerHTML;
  }

  function expectOneOfEach(page: StaticHeadPageId, language: Language): void {
    const meta = pageMetadata(page, language);
    expect(document.head.querySelectorAll('title')).toHaveLength(1);
    expect(document.title).toBe(meta.title);
    for (const selector of [
      'link[rel="canonical"]',
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:url"]',
      'meta[property="og:locale"]',
      'meta[name="twitter:title"]',
      'meta[name="twitter:description"]',
      'script[type="application/ld+json"]:not([data-fluxradar-seo])',
    ]) {
      expect(document.head.querySelectorAll(selector), selector).toHaveLength(1);
    }
    const ownScripts = document.head.querySelectorAll(
      'script[type="application/ld+json"][data-fluxradar-seo]',
    );
    const own = pageStructuredData(page, language);
    expect(ownScripts).toHaveLength(own === null ? 0 : 1);
    if (own !== null) {
      expect(JSON.parse(ownScripts[0]?.textContent ?? '')).toEqual(own);
    }
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      publicPageUrl(page, language),
    );
    expect(alternatesOf(document)).toEqual(meta.alternates);
    expect(document.head.querySelectorAll('link[rel="alternate"][hreflang]')).toHaveLength(
      Object.keys(meta.alternates).length,
    );
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  }

  for (const language of LANGUAGES) {
    it.each(staticHeadPages())(
      `replaces the static head of %s in place when the app applies ${language}`,
      (page) => {
        loadStaticHead(page);
        applyPageMetadata(page, language);
        expectOneOfEach(page, language);
      },
    );
  }

  it('stays at one of each across language switches', () => {
    for (const page of staticHeadPages()) {
      loadStaticHead(page);
      applyPageMetadata(page, 'en');
      applyPageMetadata(page, 'uk');
      applyPageMetadata(page, 'en');
      expectOneOfEach(page, 'en');
    }
  });
});

describe('what serves and verifies the static heads', () => {
  // The files are only reached because nginx tries `$uri/index.html` before the
  // SPA fallback: /faq → faq/index.html. `/faq/` is tested as a directory and
  // served through `index index.html`, and `?lang=uk` is not part of `$uri`, so
  // both reach the same file. Dropping that step would quietly serve the shared
  // head again, with every unit test above still green.
  it('relies on the nginx rule that maps /<path> to <path>/index.html', () => {
    const nginx = readFileSync(resolve(REPO_ROOT, 'deploy', 'nginx.conf'), 'utf8');
    expect(nginx).toContain('try_files $uri $uri/index.html /index.html;');
    expect(nginx).toMatch(/^\s*index index\.html;/m);
  });

  // The smoke script cannot import TypeScript, so its page list is a copy; this
  // keeps the copy honest. A page added to seo.ts and not to the script would
  // ship without anything checking its head after a release.
  it('checks every public page after a release', () => {
    const script = readFileSync(resolve(REPO_ROOT, 'deploy', 'public-smoke.sh'), 'utf8');
    const begin = script.indexOf('# fluxradar:public-pages');
    const end = script.indexOf('# fluxradar:end-public-pages');
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const region = script.slice(begin, end);

    const list = /^PUBLIC_PAGE_PATHS=\(([^)]*)\)$/m.exec(region)?.[1];
    expect(list).toBeDefined();
    expect((list ?? '').trim().split(/\s+/).sort()).toEqual(nonHomePaths().sort());
    expect(region).toContain(`CANONICAL_ORIGIN='${SITE_ORIGIN}'`);
  });
});
