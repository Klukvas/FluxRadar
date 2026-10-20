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
export function publicPagePath(page: PublicPageId, language: Language): string {
  const path = PUBLIC_PAGE_PATHS[page];
  return language === 'en' ? path : `/uk${path === '/' ? '' : path}`;
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
    for (const language of ['en', 'uk'] as const) {
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
/** Only the eight old public locale aliases migrate; account links retain their exact URL. */
export function legacyPublicRedirect(url: string): string | null {
  const parsed = publicRequestTarget(url);
  if (parsed === null) return null;
  const route = publicPageRoute(parsed.pathname);
  const raw = parsed.search.slice(1).split('&');
  const languages = raw.filter((part) => part === 'lang' || part.startsWith('lang='));
  if (
    route?.language !== 'en' ||
    languages.length !== 1 ||
    languages[0] !== 'lang=uk' ||
    hasPrivateEntry(parsed.search) ||
    raw.some((part) => /%[0-9a-f]{2}/i.test(part.split('=')[0] ?? ''))
  )
    return null;
  const remaining = raw.filter((part) => part !== 'lang=uk').join('&');
  return `${publicPagePath(route.page, 'uk')}${remaining ? '?' + remaining : ''}${parsed.hash}`;
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
