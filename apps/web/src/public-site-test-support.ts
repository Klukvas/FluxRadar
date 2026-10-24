// The public site as a crawler meets it, for tests that read every page.
//
// Two kinds of document make up fluxradar.net: the React pages the build
// prerenders (`staticPublicFiles`, the same function vite.config.ts calls) and
// the hand-written blog and knowledge-base HTML under `public/`, which has no
// generator. Head and link rules have to hold for both, so this loads both.
//
// Not a test file: the name ends in `-support`, so vitest's own `*.test.*`
// pattern does not collect it. Callers run in the node environment, because
// the prerender is `renderToString`.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { SITE_ORIGIN } from './seo';
import { staticPublicFiles } from './static-public-render';

// Vitest runs with `apps/web` as its working directory.
export const WEB_ROOT = process.cwd();
export const PUBLIC_ROOT = resolve(WEB_ROOT, 'public');

export interface PublicDocument {
  /** The clean public path, e.g. `/`, `/uk/faq` or `/knowledge-base/google-dani`. */
  readonly path: string;
  readonly html: string;
}

/** `faq/index.html` → `/faq`, `index.html` → `/`. */
function documentPath(fileName: string): string {
  const path = `/${fileName.replace(/\\/g, '/')}`.replace(/\/?index\.html$/, '');
  return path === '' ? '/' : path;
}

function htmlFilesUnder(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((name) => {
    const entry = join(directory, name);
    if (statSync(entry).isDirectory()) return htmlFilesUnder(entry);
    return name.endsWith('.html') ? [entry] : [];
  });
}

/** Every hand-written HTML document under `public/`, listed in the sitemap or not. */
export function staticHtmlDocuments(): readonly PublicDocument[] {
  return htmlFilesUnder(PUBLIC_ROOT).map((file) => ({
    path: documentPath(relative(PUBLIC_ROOT, file)),
    html: readFileSync(file, 'utf8'),
  }));
}

/** The sixteen React pages exactly as the build writes them. */
export function prerenderedDocuments(): readonly PublicDocument[] {
  const template = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf8');
  return staticPublicFiles(template).map((file) => ({
    path: documentPath(file.fileName),
    html: file.html,
  }));
}

/** The paths `public/sitemap.xml` lists, in its order. */
export function sitemapPaths(): readonly string[] {
  const sitemap = readFileSync(resolve(PUBLIC_ROOT, 'sitemap.xml'), 'utf8');
  return Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) =>
    new URL(match[1] ?? '').pathname.replace(/(.)\/$/, '$1'),
  );
}

/** One document per sitemap URL; a URL with no document fails loudly. */
export function sitemapDocuments(): readonly PublicDocument[] {
  const byPath = new Map(
    [...prerenderedDocuments(), ...staticHtmlDocuments()].map((page) => [page.path, page]),
  );
  return sitemapPaths().map((path) => {
    const page = byPath.get(path);
    if (page === undefined) throw new Error(`the sitemap lists ${path}, but no document serves it`);
    return page;
  });
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

/** Decodes the entities these documents use, named and numeric. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function attribute(tag: string, name: string): string | null {
  const value = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1];
  return value === undefined ? null : decodeEntities(value);
}

function headOf(html: string): string {
  return /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
}

/** The decoded `<title>` text, or null when the head has none. */
export function titleOf(html: string): string | null {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(headOf(html))?.[1];
  return title === undefined ? null : decodeEntities(title);
}

/** The content of the head `<meta>` whose `name` or `property` is `key`. */
export function metaContent(html: string, key: string): string | null {
  for (const tag of headOf(html).match(/<meta\b[^>]*>/gi) ?? []) {
    if (attribute(tag, 'name') === key || attribute(tag, 'property') === key) {
      return attribute(tag, 'content');
    }
  }
  return null;
}

/** Every `<a href>` in the body, decoded, in document order. */
export function bodyLinks(html: string): readonly string[] {
  const body = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, '');
  return (body.match(/<a\b[^>]*>/gi) ?? []).flatMap((tag) => attribute(tag, 'href') ?? []);
}

/**
 * A same-site link as an absolute URL on the canonical origin, or null for
 * mail, phone and off-site links. Relative links resolve against `from`.
 */
export function siteUrl(href: string, from: string): URL | null {
  if (/^(mailto|tel|javascript):/i.test(href)) return null;
  const url = new URL(href, `${SITE_ORIGIN}${from}`);
  return url.origin === SITE_ORIGIN ? url : null;
}

/** A path without its trailing slash, so `/blog/` and `/blog` are one page. */
export function cleanPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
}
