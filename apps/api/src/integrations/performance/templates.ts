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

const NUMERIC_ID_PATTERN = /^\d+$/;

export const NUMERIC_PLACEHOLDER = '{id}';
export const UUID_PLACEHOLDER = '{uuid}';
export const DATE_PLACEHOLDER = '{date}';
export const SLUG_PLACEHOLDER = '{slug}';

/** A UUID segment, collapsed — or null when this segment is not one. */
export function collapseUuidSegment(segment: string): string | null {
  return UUID_PATTERN.test(segment) ? UUID_PLACEHOLDER : null;
}

/**
 * A date-shaped segment, collapsed — or null when this segment is not one.
 *
 * Checked before the numeric-id rule: a bare four-digit year (`/2024/`) would
 * otherwise be indistinguishable from a four-digit numeric id, and a URL that
 * carries a date in its path almost always means the date, not an id that
 * happens to be four digits.
 */
export function collapseDateSegment(segment: string): string | null {
  if (
    FULL_DATE_PATTERN.test(segment) ||
    YEAR_MONTH_PATTERN.test(segment) ||
    YEAR_PATTERN.test(segment)
  ) {
    return DATE_PLACEHOLDER;
  }
  return null;
}

/**
 * A purely numeric segment (an id), collapsed — or null when it is not one.
 *
 * Checked after `collapseDateSegment`: a bare four-digit segment (`/1234/`)
 * is classified as a year, not an id, because a path date is the more common
 * real-world case. This is a deliberate, documented ambiguity — there is no
 * way to tell a product id `1234` from the year 1234 from the path alone.
 */
export function collapseNumericSegment(segment: string): string | null {
  return NUMERIC_ID_PATTERN.test(segment) ? NUMERIC_PLACEHOLDER : null;
}

/**
 * A slug that follows a known listing prefix (`/blog/<slug>`, `/product/<slug>`),
 * collapsed — or null when the previous segment is not a recognised prefix, or
 * there is no previous segment.
 */
export function collapseSlugSegment(
  segment: string,
  previousSegment: string | null,
): string | null {
  if (previousSegment === null) return null;
  return SLUG_PREFIXES.has(previousSegment.toLowerCase()) ? SLUG_PLACEHOLDER : null;
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
 * not just the immediate previous one — so `/blog/2024/hello-world` still
 * reads `hello-world` as a slug of `blog` even though a collapsed `{date}`
 * segment sits between them.
 */
export function templateKeyFor(url: string): string {
  const path = pathOnly(url);
  if (path === null) return url;
  if (path === '/') return '/';
  const rawSegments = path.split('/').filter((segment) => segment !== '');
  const classified: string[] = [];
  let lastLiteralSegment: string | null = null;
  for (const segment of rawSegments) {
    const collapsed =
      collapseUuidSegment(segment) ??
      collapseDateSegment(segment) ??
      collapseNumericSegment(segment) ??
      collapseSlugSegment(segment, lastLiteralSegment);
    if (collapsed === null) {
      const literal = segment.toLowerCase();
      classified.push(literal);
      lastLiteralSegment = literal;
    } else {
      classified.push(collapsed);
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
