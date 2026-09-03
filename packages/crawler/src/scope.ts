// Проверки области сканирования (T-07, план §3): origin/поддомены,
// include/exclude-шаблоны, валидация параметров scope.

import type { CrawlScope } from './types.js';

/** Валидирует scope до старта обхода; возвращает разобранный origin. */
export function validateScope(scope: CrawlScope): URL {
  let origin: URL;
  try {
    origin = new URL(scope.origin);
  } catch (error) {
    throw new Error(`crawl: scope.origin is not an absolute URL: ${JSON.stringify(scope.origin)}`, {
      cause: error,
    });
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new Error(`crawl: scope.origin must be http(s), got "${origin.protocol}"`);
  }
  if (!Number.isInteger(scope.maxPages) || scope.maxPages < 1) {
    throw new Error(`crawl: scope.maxPages must be a positive integer, got ${scope.maxPages}`);
  }
  if (scope.maxDepth !== undefined && (!Number.isInteger(scope.maxDepth) || scope.maxDepth < 0)) {
    throw new Error(`crawl: scope.maxDepth must be a non-negative integer, got ${scope.maxDepth}`);
  }
  return origin;
}

/** host в scope: сам origin-host либо его поддомен при includeSubdomains. */
export function isHostInScope(
  hostname: string,
  originHostname: string,
  includeSubdomains: boolean,
): boolean {
  if (hostname === originHostname) {
    return true;
  }
  return includeSubdomains && hostname.endsWith(`.${originHostname}`);
}

/**
 * Include/exclude-шаблоны по pathname: exclude сильнее include; при заданных
 * includePatterns требуется совпадение хотя бы с одним. Шаблон — полное
 * совпадение, `*` матчит любую последовательность символов (включая `/`).
 */
export function isPathnameAllowedByPatterns(pathname: string, scope: CrawlScope): boolean {
  const excluded = (scope.excludePatterns ?? []).some((pattern) =>
    matchesGlob(pattern, pathname),
  );
  if (excluded) {
    return false;
  }
  const includes = scope.includePatterns ?? [];
  if (includes.length === 0) {
    return true;
  }
  return includes.some((pattern) => matchesGlob(pattern, pathname));
}

function matchesGlob(pattern: string, pathname: string): boolean {
  const regexBody = pattern.split('*').map(escapeRegExp).join('[^]*');
  return new RegExp(`^${regexBody}$`).test(pathname);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
