// Groups a crawl's pages by "page template" so the Performance audit can
// sample a site's page TYPES rather than three arbitrary URLs.
//
// A template key is the URL path with its variable parts collapsed to a
// placeholder: `/blog/2024/hello-world` and `/blog/2025/another-post` become
// the same template (`/blog/{date}/{slug}`), so auditing one of them stands
// in for both. The root path is always its own template — a homepage is never
// "representative" of anything else.
//
// DETERMINISTIC AND O(n). Every URL is classified independently, in one pass,
// with no growing per-URL cache beyond the grouping map itself — this runs
// over a 50,000-page crawl on every scan.

/** Segments that mark the next segment as a slug rather than a literal path part. */
const SLUG_PREFIXES = new Set([
  'blog',
  'blogs',
  'post',
  'posts',
  'article',
  'articles',
  'product',
  'products',
  'category',
  'categories',
  'tag',
  'tags',
  'item',
  'items',
  'user',
  'users',
  'doc',
  'docs',
  'guide',
  'guides',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Full ISO date, year-month, or bare four-digit year — in that priority order. */
const FULL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
const YEAR_PATTERN = /^\d{4}$/;
const PLAUSIBLE_YEAR_MIN = 1970;
const PLAUSIBLE_YEAR_MAX = 2099;

/** A one- or two-digit segment shaped like a calendar month or day (1-31). */
const MONTH_OR_DAY_PATTERN = /^\d{1,2}$/;

const NUMERIC_ID_PATTERN = /^\d+$/;

/**
 * Locale-prefixed routing (`/en/about`, `/uk/about`) always collapses the first
 * path segment: this is the fixed set of two-letter locale codes a site's router
 * plausibly uses, not a general "two lowercase letters" guess that would also
 * eat a real page called `/hi`. Some of these codes are also real words in
 * English (`/it`, the IT department page, being the obvious one) — a false
 * positive this set accepts rather than shrinking the locale list.
 */
const LOCALE_PREFIXES = new Set([
  'en',
  'uk',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'ru',
  'ja',
  'zh',
  'ko',
  'cs',
  'sv',
  'da',
  'no',
  'fi',
  'tr',
  'ar',
  'he',
]);

export const NUMERIC_PLACEHOLDER = '{id}';
export const UUID_PLACEHOLDER = '{uuid}';
export const DATE_PLACEHOLDER = '{date}';
export const SLUG_PLACEHOLDER = '{slug}';
export const LOCALE_PLACEHOLDER = '{locale}';

/** A UUID segment, collapsed — or null when this segment is not one. */
export function collapseUuidSegment(segment: string): string | null {
  return UUID_PATTERN.test(segment) ? UUID_PLACEHOLDER : null;
}

/**
 * An unambiguously date-shaped segment, collapsed — or null when this segment
 * is not one.
 *
 * A bare four-digit segment (`/2024/`) is deliberately NOT collapsed here: on
 * its own it is indistinguishable from a numeric id that happens to be four
 * digits, and this function sees one segment at a time with no neighbours to
 * disambiguate it against. `templateKeyFor` resolves that case itself, via
 * `bareYearHasDateContext`, by looking at the segments around it — a full
 * date or a year-month is unambiguous without that context, so those two
 * still collapse here.
 */
export function collapseDateSegment(segment: string): string | null {
  if (FULL_DATE_PATTERN.test(segment) || YEAR_MONTH_PATTERN.test(segment)) {
    return DATE_PLACEHOLDER;
  }
  return null;
}

/**
 * A purely numeric segment (an id), collapsed — or null when it is not one.
 *
 * A bare four-digit segment (`/1234/`) collapses here, not in
 * `collapseDateSegment`: on its own it is indistinguishable from a year, and
 * `templateKeyFor` is the one place with enough context (`bareYearHasDateContext`)
 * to tell them apart. This is a deliberate, documented ambiguity — there is no
 * way to tell a product id `1234` from the year 1234 from the segment alone.
 */
export function collapseNumericSegment(segment: string): string | null {
  return NUMERIC_ID_PATTERN.test(segment) ? NUMERIC_PLACEHOLDER : null;
}

/**
 * A locale-routing segment (`/en/...`, `/uk/...`), collapsed — or null when the
 * segment is not a known locale code, or it is not the URL's first segment. A
 * locale can only ever open a path, so a matching code deeper in the path (a
 * page literally named `/blog/en`) is left alone.
 */
export function collapseLocaleSegment(segment: string, isFirstSegment: boolean): string | null {
  if (!isFirstSegment) return null;
  return LOCALE_PREFIXES.has(segment.toLowerCase()) ? LOCALE_PLACEHOLDER : null;
}

/**
 * A slug that follows a known listing prefix (`/blog/<slug>`, `/product/<slug>`),
 * collapsed — or null when the previous segment is not a recognised prefix, or
 * there is no previous segment.
 *
 * `afterDateOrId` widens the rule for a dated or id-bearing permalink that has
 * no listing prefix at all (`/2024/03/15/hello-world`): once any ancestor
 * segment in this path collapsed into a `{date}` or `{id}` placeholder, the
 * final literal segment reads as that permalink's slug too, so the whole path
 * collapses to one template instead of one template per post.
 *
 * Deliberate trade-off: this widening is not scoped to the LAST segment only
 * — `templateKeyFor` sets `afterDateOrId` once and leaves it set for every
 * segment after the first collapse, so distinct literal segments under the
 * same numeric parent merge too (`/checkout/123/payment` and
 * `/checkout/123/review` both become `/checkout/{id}/{slug}`). That is the
 * cost of collapsing a whole dated permalink to one template instead of one
 * per post (see H1) — undercounting a handful of merged page types is judged
 * cheaper than overcounting one template per blog post again.
 */
export function collapseSlugSegment(
  segment: string,
  previousSegment: string | null,
  afterDateOrId = false,
): string | null {
  if (afterDateOrId) return SLUG_PLACEHOLDER;
  if (previousSegment === null) return null;
  return SLUG_PREFIXES.has(previousSegment.toLowerCase()) ? SLUG_PLACEHOLDER : null;
}

/**
 * Whether a bare four-digit segment reads as a year rather than a numeric id —
 * true only with date CONTEXT: a neighbouring month/day-shaped segment, or an
 * immediately preceding segment that already collapsed to `{date}`. Without
 * that context a bare four-digit segment is indistinguishable from an id that
 * happens to straddle 1000 (`/product/995` next to `/product/1000`), and
 * guessing "year" split one page template into two.
 */
function bareYearHasDateContext(
  segment: string,
  nextSegment: string | undefined,
  previousWasDate: boolean,
): boolean {
  if (!YEAR_PATTERN.test(segment)) return false;
  const year = Number(segment);
  if (year < PLAUSIBLE_YEAR_MIN || year > PLAUSIBLE_YEAR_MAX) return false;
  return previousWasDate || (nextSegment !== undefined && looksLikeMonthOrDay(nextSegment));
}

function looksLikeMonthOrDay(segment: string): boolean {
  if (!MONTH_OR_DAY_PATTERN.test(segment)) return false;
  const value = Number(segment);
  return value >= 1 && value <= 31;
}

/** The path only, with the query string stripped and no trailing slash. */
function pathOnly(url: string): string | null {
  try {
    const parsed = new URL(url);
    const trimmed = parsed.pathname.replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
  } catch {
    return null;
  }
}

/**
 * The template key for one URL: its path with every variable segment
 * collapsed to a placeholder. Query strings never affect the key. A URL this
 * function cannot parse falls back to the literal string, so it still groups
 * with itself deterministically rather than being dropped.
 *
 * The slug rule looks at the nearest ANCESTOR segment that stayed literal —
 * not just the immediate previous one — so `/blog/my-great-post` still reads
 * `my-great-post` as a slug of `blog` regardless of what sits between them.
 * A dated permalink with no listing prefix at all (`/2024/03/15/hello-world`)
 * is handled separately: once any ancestor collapsed to `{date}` or `{id}`,
 * the trailing literal segment collapses too (`collapseSlugSegment`'s
 * `afterDateOrId`), so the whole path is one template rather than one per post.
 */
export function templateKeyFor(url: string): string {
  const path = pathOnly(url);
  if (path === null) return url;
  if (path === '/') return '/';
  const rawSegments = path.split('/').filter((segment) => segment !== '');
  const classified: string[] = [];
  let lastLiteralSegment: string | null = null;
  let afterDateOrId = false;
  let previousWasDate = false;
  for (const [index, segment] of rawSegments.entries()) {
    const nextSegment = rawSegments[index + 1];
    const dateCollapsed: string | null =
      collapseDateSegment(segment) ??
      (bareYearHasDateContext(segment, nextSegment, previousWasDate) ? DATE_PLACEHOLDER : null);
    const collapsed: string | null =
      collapseUuidSegment(segment) ??
      dateCollapsed ??
      collapseNumericSegment(segment) ??
      collapseLocaleSegment(segment, index === 0) ??
      collapseSlugSegment(segment, lastLiteralSegment, afterDateOrId);
    if (collapsed === null) {
      const literal = segment.toLowerCase();
      classified.push(literal);
      lastLiteralSegment = literal;
      previousWasDate = false;
    } else {
      classified.push(collapsed);
      previousWasDate = collapsed === DATE_PLACEHOLDER;
      if (collapsed === DATE_PLACEHOLDER || collapsed === NUMERIC_PLACEHOLDER) {
        afterDateOrId = true;
      }
    }
  }
  return `/${classified.join('/')}`;
}

export interface TemplateGroup {
  readonly templateKey: string;
  readonly urls: readonly string[];
}

/**
 * Every URL grouped by its template key, in one O(n) pass over `urls`. The
 * result's iteration order is the order templates were first seen, which is
 * itself the order of `urls` — deterministic for a deterministic crawl order,
 * and callers that need "largest group first" sort the returned groups
 * themselves rather than this function guessing what order they want.
 */
export function groupUrlsByTemplate(urls: readonly string[]): readonly TemplateGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, string[]>();
  for (const url of urls) {
    const key = templateKeyFor(url);
    const existing = byKey.get(key);
    if (existing === undefined) {
      order.push(key);
      byKey.set(key, [url]);
    } else {
      existing.push(url);
    }
  }
  return order.map((key) => ({ templateKey: key, urls: byKey.get(key) ?? [] }));
}
