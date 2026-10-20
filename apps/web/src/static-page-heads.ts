// Metadata transformer shared by the full public prerender and head tests.
import type { Language } from './i18n';
import {
  MANAGED_ATTRIBUTE,
  OG_LOCALES,
  PUBLIC_PAGE_PATHS,
  pageMetadata,
  pageStructuredData,
  type PublicPageId,
} from './seo';

/** `/` keeps `index.html` itself, which is already the home page's head. */
export type StaticHeadPageId = Exclude<PublicPageId, 'home'>;

export interface StaticPageHeadFile {
  readonly page: StaticHeadPageId;
  /** Relative to the build output directory, e.g. `faq/index.html`. */
  readonly fileName: string;
  readonly html: string;
}

/** Only plain lowercase path segments: anything else could escape `dist/`. */
const SAFE_PAGE_PATH = /^(\/[a-z0-9-]+)+$/;

const TITLE_PATTERN = /<title>[\s\S]*?<\/title>/g;
const CANONICAL_PATTERN = /<link\b[^>]*\srel="canonical"[^>]*>/g;
const ALTERNATE_PATTERN = /[ \t]*<link\b(?=[^>]*\srel="alternate")(?=[^>]*\shreflang=)[^>]*>\n?/g;
const STRUCTURED_DATA_PATTERN =
  /<script\b[^>]*\stype="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g;

/** Every public page except home, in the order `PUBLIC_PAGE_PATHS` lists them. */
export function staticHeadPages(): readonly StaticHeadPageId[] {
  return (Object.keys(PUBLIC_PAGE_PATHS) as PublicPageId[]).filter(
    (page): page is StaticHeadPageId => page !== 'home',
  );
}

export function staticHeadFileName(page: StaticHeadPageId): string {
  const path = PUBLIC_PAGE_PATHS[page];
  if (!SAFE_PAGE_PATH.test(path)) {
    throw new Error(`static page heads: "${path}" (${page}) is not a plain page path`);
  }
  return `${path.slice(1)}/index.html`;
}

/** The files the build writes beside `index.html`, one per public page except home. */
export function staticPageHeadFiles(template: string): readonly StaticPageHeadFile[] {
  return staticHeadPages().map((page) => ({
    page,
    fileName: staticHeadFileName(page),
    html: renderStaticPageHead(template, page),
  }));
}

/**
 * The built `index.html` with the head of one public page.
 *
 * Everything that is not page metadata — the hashed script and stylesheet tags,
 * the icon, `og:image`, `og:locale:alternate` — is kept byte for byte. A
 * template that is missing a tag this function must replace fails the build
 * instead of shipping a page with half a head.
 */
export function renderStaticPageHead(
  template: string,
  page: PublicPageId,
  language: Language = 'en',
): string {
  const meta = pageMetadata(page, language);
  if (meta.canonical === null) {
    throw new Error(`static page heads: ${page} has no canonical URL`);
  }
  const alternates = Object.entries(meta.alternates).map(([hreflang, href]) =>
    alternateTag(hreflang, href),
  );

  let html = template.replace(ALTERNATE_PATTERN, '');
  html = replaceOnly(html, TITLE_PATTERN, `<title>${escapeText(meta.title)}</title>`, '<title>');
  html = replaceMeta(html, 'name', 'description', meta.description);
  html = replaceOnly(
    html,
    CANONICAL_PATTERN,
    [canonicalTag(meta.canonical), ...alternates].join('\n    '),
    'canonical link',
  );
  html = replaceMeta(html, 'property', 'og:title', meta.title);
  html = replaceMeta(html, 'property', 'og:description', meta.description);
  html = replaceMeta(html, 'property', 'og:url', meta.canonical);
  html = replaceMeta(html, 'property', 'og:locale', OG_LOCALES[language]);
  html = replaceMeta(html, 'name', 'twitter:title', meta.title);
  html = replaceMeta(html, 'name', 'twitter:description', meta.description);
  return replaceStructuredData(
    html.replace(/<html lang="[^"]+">/, `<html lang="${language}">`),
    page,
    language,
  );
}

/**
 * Every page keeps the template's unmarked site-wide Organization/WebSite
 * block, because `applyPageMetadata` never removes it; a page that declares its
 * own structured data gets that as a second, marked block right after it. The
 * first response and the JS-rendered head therefore carry the same scripts, and
 * a session that enters on such a page still has the site-wide block after it
 * navigates to `/`.
 */
function replaceStructuredData(html: string, page: PublicPageId, language: Language): string {
  const structuredData = pageStructuredData(page, language);
  if (structuredData === null) return html;
  // `<` is escaped so no string in the copy can close the script element early.
  const json = JSON.stringify(structuredData).replace(/</g, '\\u003c');
  const pageScript = `<script type="application/ld+json" ${MANAGED_ATTRIBUTE}="structured-data">${json}</script>`;
  return replaceOnly(
    html,
    STRUCTURED_DATA_PATTERN,
    (siteWideScript) => `${siteWideScript}\n    ${pageScript}`,
    'JSON-LD script',
  );
}

function replaceMeta(
  html: string,
  keyAttribute: 'name' | 'property',
  key: string,
  value: string,
): string {
  const pattern = new RegExp(`<meta\\b[^>]*\\s${keyAttribute}="${escapeRegExp(key)}"[^>]*>`, 'g');
  const tag = `<meta ${keyAttribute}="${key}" content="${escapeAttribute(value)}" ${MANAGED_ATTRIBUTE}="${key}" />`;
  return replaceOnly(html, pattern, tag, `meta ${keyAttribute}="${key}"`);
}

function replaceOnly(
  html: string,
  pattern: RegExp,
  replacement: string | ((match: string) => string),
  label: string,
): string {
  const found = html.match(pattern)?.length ?? 0;
  if (found !== 1) {
    throw new Error(
      `static page heads: index.html must contain exactly one ${label}, found ${found}`,
    );
  }
  // Always a function, so `$&` or `$1` in the copy is inserted literally.
  return html.replace(pattern, (match) =>
    typeof replacement === 'string' ? replacement : replacement(match),
  );
}

function canonicalTag(href: string): string {
  return `<link rel="canonical" href="${escapeAttribute(href)}" ${MANAGED_ATTRIBUTE}="canonical" />`;
}

function alternateTag(hreflang: string, href: string): string {
  return `<link rel="alternate" hreflang="${escapeAttribute(hreflang)}" href="${escapeAttribute(href)}" ${MANAGED_ATTRIBUTE}="alternate" />`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
