import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Articles are published by hand and by the scheduled blog agent
// (apps/web/blog-authoring/README.md). Both write a page file and must also list it on
// the blog index and in the sitemap; twenty articles once shipped without
// either. These tests find every article on disk, so a new page is checked
// the moment it exists — nobody has to remember to register it here.

// Vitest runs with `apps/web` as its working directory.
const PUBLIC_ROOT = resolve(process.cwd(), 'public');
const BLOG_ROOT = resolve(PUBLIC_ROOT, 'blog');
const SITE_ORIGIN = 'https://fluxradar.net';

/** Ukrainian drafts left at the blog root; they carry noindex and stay unlisted. */
const UNLISTED_DRAFTS = new Set([
  'bezpeka-ta-dostupnist-publichnyy-skaner',
  'tekhnichnyy-seo-publichnyy-audyt',
]);

interface ArticlePage {
  /** Path under /blog, e.g. `ai-crawler-readiness` or `uk/seo-katalohu-tovariv`. */
  readonly path: string;
  readonly language: 'en' | 'uk';
  readonly html: string;
}

function articleDirectories(directory: string, prefix: string): readonly string[] {
  return readdirSync(resolve(BLOG_ROOT, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${prefix}${entry.name}`)
    .filter((path) => existsSync(resolve(BLOG_ROOT, path, 'index.html')));
}

function readArticle(path: string): ArticlePage {
  return {
    path,
    language: path.startsWith('uk/') ? 'uk' : 'en',
    html: readFileSync(resolve(BLOG_ROOT, path, 'index.html'), 'utf8'),
  };
}

const ARTICLES = [...articleDirectories('.', ''), ...articleDirectories('uk', 'uk/')]
  .filter((path) => path !== 'uk')
  .map(readArticle);
const PUBLISHED = ARTICLES.filter((article) => !UNLISTED_DRAFTS.has(article.path));
const INDEX_HTML = readFileSync(resolve(BLOG_ROOT, 'index.html'), 'utf8');
const SITEMAP = readFileSync(resolve(PUBLIC_ROOT, 'sitemap.xml'), 'utf8');

function articleUrl(path: string): string {
  return `${SITE_ORIGIN}/blog/${path}`;
}

/** The index section that lists one language's cards. */
function indexSection(language: 'en' | 'uk'): string {
  const match = new RegExp(
    `<section[^>]*data-article-lang="${language}"[^>]*>([\\s\\S]*?)</section>`,
  ).exec(INDEX_HTML);
  return match?.[1] ?? '';
}

function indexCard(path: string): string | undefined {
  return Array.from(
    INDEX_HTML.matchAll(/<article>([\s\S]*?)<\/article>/g),
    (match) => match[1],
  ).find((card) => card?.includes(`href="/blog/${path}"`));
}

function sitemapEntry(path: string): string | undefined {
  const loc = `<loc>${articleUrl(path)}</loc>`;
  return Array.from(SITEMAP.matchAll(/<url>([\s\S]*?)<\/url>/g), (match) => match[1]).find(
    (entry) => entry?.includes(loc),
  );
}

function datePublished(html: string): string | undefined {
  const blocks = Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    (match) => JSON.parse(match[1] ?? 'null') as Record<string, unknown>,
  );
  const nodes = blocks.flatMap((block) =>
    Array.isArray(block['@graph']) ? (block['@graph'] as Record<string, unknown>[]) : [block],
  );
  const posting = nodes.find((node) => typeof node.datePublished === 'string');
  return posting?.datePublished as string | undefined;
}

/** `<link rel="alternate" hreflang="…" href="…">` pairs declared in a page head. */
function alternates(html: string): ReadonlyMap<string, string> {
  const links = Array.from(html.matchAll(/<link\b[^>]*rel="alternate"[^>]*>/g), (m) => m[0]);
  return new Map(
    links.flatMap((link) => {
      const language = /hreflang="([^"]+)"/.exec(link)?.[1];
      const href = /href="([^"]+)"/.exec(link)?.[1];
      return language !== undefined && href !== undefined ? [[language, href] as const] : [];
    }),
  );
}

function pathOfUrl(url: string): string | undefined {
  const prefix = `${SITE_ORIGIN}/blog/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : undefined;
}

describe('every blog article is reachable', () => {
  it('finds the articles on disk', () => {
    expect(PUBLISHED.length).toBeGreaterThan(20);
  });

  it.each(PUBLISHED.map((article) => [article.path, article] as const))(
    '%s is listed on the blog index in its own language section',
    (path, article) => {
      expect(indexSection(article.language)).toContain(`href="/blog/${path}"`);
    },
  );

  it.each(PUBLISHED.map((article) => [article.path] as const))('%s is in the sitemap', (path) => {
    expect(sitemapEntry(path)).toBeDefined();
  });

  it('lists no blog address in the sitemap that has no page', () => {
    const blogUrls = Array.from(
      SITEMAP.matchAll(/<loc>https:\/\/fluxradar\.net\/blog\/([^<]+)<\/loc>/g),
      (match) => match[1] ?? '',
    );
    expect(blogUrls.filter((path) => !existsSync(resolve(BLOG_ROOT, path, 'index.html')))).toEqual(
      [],
    );
  });

  it('links no index card to a page that does not exist', () => {
    const cards = Array.from(INDEX_HTML.matchAll(/<article>([\s\S]*?)<\/article>/g), (m) => m[1]);
    const hrefs = cards.flatMap((card) =>
      Array.from((card ?? '').matchAll(/href="\/blog\/([^"?#]+)"/g), (m) => m[1] ?? ''),
    );
    expect(hrefs.filter((path) => !existsSync(resolve(BLOG_ROOT, path, 'index.html')))).toEqual([]);
  });
});

describe('every blog article describes itself consistently', () => {
  it.each(PUBLISHED.map((article) => [article.path, article] as const))(
    '%s declares its own address and language',
    (path, article) => {
      expect(article.html).toContain(`<html lang="${article.language}"`);
      expect(article.html).toContain(`<link rel="canonical" href="${articleUrl(path)}" />`);
      expect(article.html).toContain(`<meta property="og:url" content="${articleUrl(path)}" />`);
    },
  );

  it.each(PUBLISHED.map((article) => [article.path, article] as const))(
    '%s shows the same publication date on the index as in its structured data',
    (path, article) => {
      const published = datePublished(article.html);
      expect(published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(indexCard(path)).toContain(`<time datetime="${published}">`);
    },
  );

  it.each(PUBLISHED.map((article) => [article.path, article] as const))(
    '%s loads the shared blog chrome',
    (_path, article) => {
      expect(article.html).toContain('<link rel="stylesheet" href="/blog/blog.css" />');
      expect(article.html).toContain('<script src="/blog/blog.js"></script>');
      expect(article.html).toContain(article.language === 'uk' ? 'href="/uk/faq"' : 'href="/faq"');
    },
  );
});

const TRANSLATED = PUBLISHED.filter((article) => alternates(article.html).size > 0);

// Runs once the first translated pair exists; an empty it.each fails the suite.
describe.runIf(TRANSLATED.length > 0)('translated blog articles point at each other', () => {
  const translated = TRANSLATED;

  it.each(translated.map((article) => [article.path, article] as const))(
    '%s names itself and a translation that names it back',
    (path, article) => {
      const own = alternates(article.html);
      expect(own.get(article.language)).toBe(articleUrl(path));
      const others = Array.from(own.entries()).filter(
        ([language]) => language !== article.language && language !== 'x-default',
      );
      expect(others.length).toBeGreaterThan(0);
      others.forEach(([, url]) => {
        const otherPath = pathOfUrl(url);
        expect(otherPath).toBeDefined();
        const other = readArticle(otherPath ?? '');
        expect(alternates(other.html).get(article.language)).toBe(articleUrl(path));
      });
    },
  );

  it.each(translated.map((article) => [article.path, article] as const))(
    '%s carries the same translations in the sitemap',
    (path, article) => {
      const entry = sitemapEntry(path) ?? '';
      alternates(article.html).forEach((url, language) => {
        expect(entry).toContain(`hreflang="${language}" href="${url}"`);
      });
    },
  );
});
