// Which pages get measured, and why it is a handful rather than all of them.
//
// A Lighthouse run costs a minute of provider time and one unit of a shared
// quota, and the audit runs each selected page on two devices more than once. A
// 15-page crawl measured exhaustively would be sixty Lighthouse runs for one
// scan: slow enough to hold the report open, expensive enough to exhaust the
// quota for every other customer, and no more informative than a representative
// few. So the selection is bounded and stated.
//
// It is also DETERMINISTIC. Two scans of the same site must measure the same
// pages, or the report's "is it faster than last time?" compares two different
// things. Nothing here samples randomly or depends on crawl order alone.
//
// T5 adds TEMPLATE sampling on top of the plain URL selection below: instead of
// auditing whichever three shallow pages happen to sort first, the audit picks
// one representative per page TEMPLATE (packages/rules-style URL shape, see
// `templates.ts`), so a site with a blog, a product catalogue and a handful of
// static pages gets a measurement of each kind of page rather than three
// entries from whichever template happens to be shallowest. `selectAuditUrls`
// stays exactly as it was — it is still what a caller gets by default, and
// existing tests and stored comparisons depend on its exact ordering — while
// `selectAuditUrlsByTemplate` is the new entry point `audit.ts` calls.

import { groupUrlsByTemplate, type TemplateGroup } from './templates.ts';

export const MAX_AUDITED_URLS = 3;

/**
 * The template-aware cap: the entry page plus up to seven more representatives,
 * one per template, largest template first. Eight is deliberately larger than
 * the plain three-URL cap — a template sample needs enough seats to cover a
 * typical site's handful of page types (home, listing pages, detail pages, a
 * couple of static pages) without approaching the request budget in
 * audit.ts (`MAX_PAGESPEED_REQUESTS`), which stays the actual hard stop.
 */
export const MAX_AUDITED_URLS_BY_TEMPLATE = 8;

/** Pages that are not what a visitor lands on, and not worth a paid run. */
const EXCLUDED_EXTENSIONS = ['.pdf', '.zip', '.xml', '.json', '.txt', '.rss', '.csv'];

function pathDepth(url: URL): number {
  return url.pathname.split('/').filter((segment) => segment !== '').length;
}

function isMeasurable(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const path = url.pathname.toLowerCase();
  return !EXCLUDED_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function sameOrigin(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * The pages this audit will measure: the origin's entry page first, then the
 * shallowest remaining pages, ties broken alphabetically.
 *
 * Shallowest-first is a stand-in for "most important": a site's top-level
 * sections are what its visitors reach, and a page five levels down is almost
 * never the one whose speed decides whether the site feels slow. The tie-break
 * is what makes the result stable across scans.
 */
export function selectAuditUrls(
  origin: string,
  candidates: readonly string[],
  limit: number = MAX_AUDITED_URLS,
): readonly string[] {
  const entry = normalisedOrigin(origin);
  const others = [...new Set(candidates)]
    .filter((candidate) => isMeasurable(candidate) && sameOrigin(candidate, origin))
    .filter((candidate) => normalisedOrigin(candidate) !== entry)
    .sort((left, right) => {
      const depth = pathDepth(new URL(left)) - pathDepth(new URL(right));
      return depth !== 0 ? depth : left.localeCompare(right);
    });
  return [entry, ...others].slice(0, Math.max(1, limit));
}

/**
 * The entry page as one canonical string, so "https://x.com" and
 * "https://x.com/" are never measured as two different pages.
 */
export function normalisedOrigin(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === '' ? '/' : url.pathname;
    return `${url.origin}${path}${url.search}`;
  } catch {
    return value;
  }
}

/** One page the audit will measure, and which template it stands in for. */
export interface AuditUrlSelection {
  readonly url: string;
  readonly templateKey: string;
  /** How many crawled pages share this template — including `url` itself. */
  readonly representedPages: number;
}

/** The shallowest URL of a template group, ties broken alphabetically. */
function representativeOf(urls: readonly string[]): string {
  const sorted = [...urls].sort((left, right) => {
    const depth = pathDepth(new URL(left)) - pathDepth(new URL(right));
    return depth !== 0 ? depth : left.localeCompare(right);
  });
  // groupUrlsByTemplate never produces an empty group, but the type is still
  // `string | undefined` to the compiler; the entry URL is always valid input.
  const first = sorted[0];
  if (first === undefined) throw new Error('unreachable: empty template group');
  return first;
}

/**
 * The template groups this audit considers at all: the entry page plus every
 * measurable, same-origin candidate, grouped by `templateKey`. Shared by
 * `selectAuditUrlsByTemplate` and `countAuditTemplates` so "how many templates
 * were found" and "which ones got audited" are always counted over the exact
 * same input.
 */
function measurableTemplateGroups(
  origin: string,
  candidates: readonly string[],
): readonly TemplateGroup[] {
  const entry = normalisedOrigin(origin);
  const measurable = [
    ...new Set(
      [entry, ...candidates].filter(
        (candidate) => isMeasurable(candidate) && sameOrigin(candidate, origin),
      ),
    ),
  ];
  return groupUrlsByTemplate(measurable);
}

/**
 * How many distinct page templates the candidate URLs sort into — the
 * denominator for "N of M templates audited", stated regardless of how many of
 * them `selectAuditUrlsByTemplate` actually had room to measure.
 */
export function countAuditTemplates(origin: string, candidates: readonly string[]): number {
  return measurableTemplateGroups(origin, candidates).length;
}

/**
 * The pages this audit will measure, one representative per page template: the
 * entry page always first, then one URL per remaining template, largest
 * template (by crawled page count) first, ties broken by template key so the
 * order is stable across scans. Within a template, the representative is the
 * shallowest URL, ties broken alphabetically — the same rule `selectAuditUrls`
 * uses for the flat list, applied per template instead of across the whole site.
 *
 * DETERMINISTIC AND BOUNDED: `groupUrlsByTemplate` is O(n) over the candidate
 * list, and only `limit` templates are ever turned into a Lighthouse target
 * regardless of how many templates a large site has.
 */
export function selectAuditUrlsByTemplate(
  origin: string,
  candidates: readonly string[],
  limit: number = MAX_AUDITED_URLS_BY_TEMPLATE,
): readonly AuditUrlSelection[] {
  const entry = normalisedOrigin(origin);
  const groups = measurableTemplateGroups(origin, candidates);
  const entryTemplate = groups.find((group) => group.urls.includes(entry));
  const rest = groups
    .filter((group) => group !== entryTemplate)
    .sort((left, right) => {
      const bySize = right.urls.length - left.urls.length;
      return bySize !== 0 ? bySize : left.templateKey.localeCompare(right.templateKey);
    });
  const selections: AuditUrlSelection[] = [];
  if (entryTemplate !== undefined) {
    selections.push({
      url: entry,
      templateKey: entryTemplate.templateKey,
      representedPages: entryTemplate.urls.length,
    });
  } else {
    // The entry page failed `isMeasurable`/`sameOrigin` against its own origin
    // string — practically unreachable, but the entry page is still audited so
    // the audit never silently measures zero pages.
    selections.push({ url: entry, templateKey: '/', representedPages: 1 });
  }
  const bound = Math.max(1, limit);
  for (const group of rest) {
    if (selections.length >= bound) break;
    selections.push({
      url: representativeOf(group.urls),
      templateKey: group.templateKey,
      representedPages: group.urls.length,
    });
  }
  return selections;
}
