// Assembling the GEO evidence snapshot from what this scan already read.
//
// Nothing here fetches anything new: the pages come from the crawl the scan
// already did, and the profile fields from the row the owner filled in. The two
// stay separated all the way to the evaluator, because "the owner typed this"
// and "the page said this" are very different grades of evidence, and a verdict
// that mixes them is worth less than no verdict.

import { buildGeoEvidenceSnapshot, brandIsHostname } from '@fluxradar/ai';
import type { GeoEvidencePage, GeoEvidenceSnapshot } from '@fluxradar/ai';
import type { PageSnapshot } from '@fluxradar/crawler';
import { analyzeUxStatic, validJsonLdObjects } from '@fluxradar/rules';
import type { SiteContext } from '@fluxradar/rules';
import type { SiteProfile } from '@prisma/client';

/** How many author-declared statements one page may contribute. */
const MAX_JSON_LD_PER_PAGE = 2;
const JSON_LD_FIELDS = ['name', 'legalName', 'description', 'slogan', 'areaServed'] as const;

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function jsonLdType(entry: Record<string, unknown>): string | null {
  const type = entry['@type'];
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) {
    const first = type.find((value) => typeof value === 'string');
    return typeof first === 'string' ? first : null;
  }
  return null;
}

/**
 * One JSON-LD object as a line of text, or nothing.
 *
 * Only descriptive fields are kept, and the snapshot labels the whole thing as
 * an author's own declaration: a site can put any name it likes in its markup,
 * and a judge must never be able to confirm a business from it as though it had
 * been verified.
 */
function jsonLdStatement(entry: Record<string, unknown>): string | null {
  const parts = JSON_LD_FIELDS.flatMap((field) => {
    const value = stringField(entry[field]);
    return value === null ? [] : [`${field}=${value}`];
  });
  if (parts.length === 0) return null;
  const type = jsonLdType(entry);
  return [...(type === null ? [] : [`@type=${type}`]), ...parts].join('; ');
}

function structuredDataOf(page: PageSnapshot | undefined): readonly string[] {
  if (page === undefined) return [];
  return validJsonLdObjects(page)
    .flatMap((entry) => {
      const statement = jsonLdStatement(entry);
      return statement === null ? [] : [statement];
    })
    .slice(0, MAX_JSON_LD_PER_PAGE);
}

/** The crawled pages, in crawl order, as evidence the evaluator can cite. */
export function geoEvidencePages(ctx: SiteContext): readonly GeoEvidencePage[] {
  // The UX analyser already turns a page snapshot into title, headings and
  // visible text. A second extractor here would drift from it for no gain.
  const snapshotsByUrl = new Map(ctx.crawl.pages.map((page) => [page.finalUrl, page]));
  return analyzeUxStatic(ctx).pages.map((page) => ({
    url: page.url,
    title: page.title,
    headings: page.headings,
    visibleText: page.visibleText,
    structuredData: structuredDataOf(snapshotsByUrl.get(page.url)),
  }));
}

/** The one snapshot every evaluator of this scan is handed, unchanged. */
export function buildScanEvidence(
  ctx: SiteContext,
  profile: SiteProfile,
  siteHostname: string,
): GeoEvidenceSnapshot {
  return buildGeoEvidenceSnapshot({
    siteDomain: siteHostname,
    // A profile nobody named carries its hostname in `name`. That is not a
    // brand anyone confirmed, and it must not become evidence of one.
    brandIsHostname: brandIsHostname(profile.name, siteHostname),
    profile: {
      brand: profile.name,
      industry: profile.industry,
      region: profile.region,
      language: profile.language,
      businessDescription: profile.businessDescription,
      offerings: profile.offerings,
      targetLanguages: profile.targetLanguages,
      targetAudience: profile.targetAudience,
    },
    pages: geoEvidencePages(ctx),
  });
}
