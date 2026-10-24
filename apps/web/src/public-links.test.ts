// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { publicPageRoute } from './public-page-routing';
import {
  bodyLinks,
  cleanPath,
  prerenderedDocuments,
  sitemapDocuments,
  sitemapPaths,
  siteUrl,
  staticHtmlDocuments,
  type PublicDocument,
} from './public-site-test-support';

// A production scan of fluxradar.net reported our own pages as weakly linked:
// knowledge-base guides reachable only from the catalog, guides recommending
// themselves under "next step", and internal links to `?lang=` variants that
// either redirect (308) or duplicate a clean URL. These tests read the shipped
// HTML, static and prerendered, the way a crawler does.

/**
 * The blog index filters its articles by language, and only `?lang=` selects
 * the filter: without it the index reopens in the reader's stored language, so
 * a link meant to show the English articles needs `?lang=en`. Both filter URLs
 * declare /blog as canonical, so neither is a duplicate page.
 */
const UKRAINIAN_BLOG_FILTER = '/blog?lang=uk';
const ALLOWED_LANGUAGE_LINKS: ReadonlySet<string> = new Set([
  UKRAINIAN_BLOG_FILTER,
  '/blog?lang=en',
]);

/** Blog and knowledge-base documents are public too, beside the React pages. */
function isPublicDocument(pathname: string): boolean {
  return publicPageRoute(pathname) !== null || /^\/(blog|knowledge-base)(\/|$)/.test(pathname);
}

function languageVariantLinks(page: PublicDocument): readonly string[] {
  return bodyLinks(page.html).filter((href) => {
    const url = siteUrl(href, page.path);
    if (url === null || !url.searchParams.has('lang')) return false;
    if (ALLOWED_LANGUAGE_LINKS.has(`${cleanPath(url.pathname)}${url.search}`)) return false;
    return isPublicDocument(url.pathname);
  });
}

describe('links to public pages', () => {
  const documents = [...staticHtmlDocuments(), ...prerenderedDocuments()];

  it('use the clean public path instead of a ?lang= variant', () => {
    const offenders = documents.flatMap((page) =>
      languageVariantLinks(page).map((href) => `${page.path} → ${href}`),
    );
    expect(offenders).toEqual([]);
  });

  it('keep the Ukrainian blog filter among the language queries', () => {
    const filterLinks = documents.filter((page) =>
      bodyLinks(page.html).includes(UKRAINIAN_BLOG_FILTER),
    );
    expect(filterLinks.length).toBeGreaterThan(0);
  });
});

/** The other sitemap pages linking to each sitemap page, by distinct source. */
function inboundSources(pages: readonly PublicDocument[]): ReadonlyMap<string, Set<string>> {
  const inbound = new Map(pages.map((page) => [page.path, new Set<string>()]));
  for (const page of pages) {
    for (const href of bodyLinks(page.html)) {
      const url = siteUrl(href, page.path);
      // A query makes another URL (the crawler keeps `/blog?lang=uk` apart).
      if (url === null || url.search !== '') continue;
      const target = cleanPath(url.pathname);
      if (target !== page.path) inbound.get(target)?.add(page.path);
    }
  }
  return inbound;
}

function relatedReadingLinks(page: PublicDocument): readonly string[] {
  const asides =
    page.html.match(
      /<aside\b[^>]*\bclass="[^"]*\brelated-reading\b[^"]*"[^>]*>[\s\S]*?<\/aside>/g,
    ) ?? [];
  return asides.flatMap((aside) => bodyLinks(aside));
}

describe('internal links between blog and knowledge-base pages', () => {
  const pages = sitemapDocuments();
  const contentPages = pages.filter((page) => /^\/(blog|knowledge-base)(\/|$)/.test(page.path));

  it('covers every blog and knowledge-base page in the sitemap', () => {
    expect(contentPages.map((page) => page.path)).toEqual(
      sitemapPaths().filter((path) => /^\/(blog|knowledge-base)(\/|$)/.test(path)),
    );
    expect(contentPages.length).toBeGreaterThan(20);
  });

  it.each(contentPages.map((page) => [page.path, page] as const))(
    '%s does not recommend itself under related reading',
    (path, page) => {
      const selfLinks = relatedReadingLinks(page).filter(
        (href) => cleanPath(siteUrl(href, path)?.pathname ?? '') === path,
      );
      expect(selfLinks).toEqual([]);
    },
  );

  // One link from the catalog alone leaves a page "held by a single internal
  // link"; three distinct sources keep it reachable when one of them changes.
  it('reaches every blog and knowledge-base page from at least three other pages', () => {
    const inbound = inboundSources(pages);
    const thin = contentPages.flatMap((page) => {
      const sources = [...(inbound.get(page.path) ?? [])];
      return sources.length >= 3 ? [] : [`${page.path} ← ${sources.join(', ') || 'nothing'}`];
    });
    expect(thin).toEqual([]);
  });
});
