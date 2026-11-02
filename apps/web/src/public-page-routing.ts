import type { Language } from './i18n.js';

export const PUBLIC_PAGE_PATHS = {
  home: '/',
  faq: '/faq',
  checks: '/checks',
  bot: '/bot',
  exampleReport: '/example-report',
  privacy: '/privacy',
  terms: '/terms',
  cookies: '/cookies',
} as const;
export type PublicPageId = keyof typeof PUBLIC_PAGE_PATHS;
export interface PublicPageRoute {
  readonly page: PublicPageId;
  readonly language: Language;
}

/**
 * The URL prefix each locale's public documents live under.
 *
 * English keeps the bare path, because it was the site's only language when
 * these addresses were first published and the links are still in the wild.
 * Every other locale is a prefix of its own.
 */
export const PUBLIC_LOCALE_PREFIXES: Readonly<Record<Language, string>> = {
  en: '',
  uk: '/uk',
  ru: '/ru',
};

/** The locales a public document is published in, in URL-matching order. */
export const PUBLIC_LOCALES = Object.keys(PUBLIC_LOCALE_PREFIXES) as readonly Language[];

export function publicPagePath(page: PublicPageId, language: Language): string {
  const path = PUBLIC_PAGE_PATHS[page];
  const prefix = PUBLIC_LOCALE_PREFIXES[language];
  if (prefix === '') return path;
  return `${prefix}${path === '/' ? '' : path}`;
}
/** Match nginx URI decoding, slash merging and dot segments only for known public documents. */
function normalizedPublicPath(pathname: string): string | null {
  if (!pathname.startsWith('/')) return null;
  try {
    const decoded = decodeURIComponent(pathname);
    if (
      Array.from(decoded).some(
        (character) =>
          character === '\\' || character.charCodeAt(0) <= 0x20 || character.charCodeAt(0) === 0x7f,
      )
    )
      return null;
    const segments: string[] = [];
    for (const segment of decoded.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        if (segments.length === 0) return null;
        segments.pop();
      } else segments.push(segment);
    }
    return '/' + segments.join('/');
  } catch {
    return null;
  }
}
export function publicPageRoute(pathname: string): PublicPageRoute | null {
  const path = normalizedPublicPath(pathname);
  for (const page of Object.keys(PUBLIC_PAGE_PATHS) as PublicPageId[]) {
    for (const language of PUBLIC_LOCALES) {
      if (path === publicPagePath(page, language)) return { page, language };
    }
  }
  return null;
}
export function hasPrivateEntry(search: string): boolean {
  const params = new URLSearchParams(search);
  return ['verify_email', 'reset_token', 'request_id'].some((key) => params.has(key));
}
/** HTTP origin-form targets start with a path, even when it begins with two slashes. */
function publicRequestTarget(
  target: string,
): { readonly pathname: string; readonly search: string; readonly hash: string } | null {
  if (!target.startsWith('/')) return null;
  const fragment = target.indexOf('#');
  const hash = fragment < 0 ? '' : target.slice(fragment);
  const withoutHash = fragment < 0 ? target : target.slice(0, fragment);
  const query = withoutHash.indexOf('?');
  return {
    pathname: query < 0 ? withoutHash : withoutHash.slice(0, query),
    search: query < 0 ? '' : withoutHash.slice(query),
    hash,
  };
}
/** Preview applies nginx's normalization only when it names a known public document. */
export function publicRequestRewrite(target: string): string | null {
  const parsed = publicRequestTarget(target);
  if (parsed === null) return null;
  const route = publicPageRoute(parsed.pathname);
  return route === null ? null : publicPagePath(route.page, route.language) + parsed.search;
}
/**
 * The locale an `?lang=` alias on a bare public path names, and the canonical
 * path it belongs on.
 *
 * One entry, because one such address was ever published: `?lang=uk` is how
 * the eight public documents were addressed before the `/uk` prefix existed,
 * and those links are still shared. A locale added after the prefixes exist
 * gets no alias — it is linked by its own path, and this map is only here to
 * keep the old links working.
 */
const PUBLIC_LOCALE_ALIASES: Readonly<Record<string, Language>> = {
  'lang=uk': 'uk',
};

/** Only a bare public path's own locale alias migrates; account links retain their exact URL. */
export function legacyPublicRedirect(url: string): string | null {
  const parsed = publicRequestTarget(url);
  if (parsed === null) return null;
  const route = publicPageRoute(parsed.pathname);
  const raw = parsed.search.slice(1).split('&');
  const languages = raw.filter((part) => part === 'lang' || part.startsWith('lang='));
  const alias = languages.length === 1 ? (languages[0] ?? '') : '';
  const language = PUBLIC_LOCALE_ALIASES[alias];
  if (
    route?.language !== 'en' ||
    language === undefined ||
    hasPrivateEntry(parsed.search) ||
    raw.some((part) => /%[0-9a-f]{2}/i.test(part.split('=')[0] ?? ''))
  )
    return null;
  const remaining = raw.filter((part) => part !== alias).join('&');
  return `${publicPagePath(route.page, language)}${remaining ? '?' + remaining : ''}${parsed.hash}`;
}
/** A marker never contains user data and is accepted only for the actual public URL. */
export function matchingPublicSnapshot(
  marker: string | null,
  pathname: string,
  search: string,
  hash = '',
): PublicPageRoute | null {
  const route = publicPageRoute(pathname);
  if (
    route === null ||
    hasPrivateEntry(search) ||
    hash === '#styleguide' ||
    hash === '#integrations'
  )
    return null;
  return marker === `${route.page}:${route.language}` ? route : null;
}
