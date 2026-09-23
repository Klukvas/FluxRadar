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

export const MAX_AUDITED_URLS = 3;

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
