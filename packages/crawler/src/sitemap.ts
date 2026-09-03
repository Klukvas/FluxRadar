// Загрузка и парсинг sitemap.xml (T-07): urlset и sitemapindex,
// один уровень вложенности индекса, суммарный лимит URL.

import type { CrawlFetcher } from './types.js';

/** Потолок страниц из sitemap — защита от гигантских/зацикленных индексов. */
export const SITEMAP_MAX_URLS = 1000;

const LOC_PATTERN = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
const SITEMAP_INDEX_PATTERN = /<sitemapindex[\s>]/i;

/**
 * Скачивает sitemap по URL и возвращает страницы из него.
 * sitemapindex разворачивается на один уровень: вложенные sitemap-ы
 * скачиваются, их собственные index-записи не разворачиваются.
 * isSitemapUrlAllowed фильтрует и корневой, и дочерние sitemap-URL до фетча:
 * sitemapindex не должен уводить обход на чужой host (план §25 crawl safety).
 * Не-200 ответ верхнего уровня → пустой список (sitemap опционален);
 * ошибка вложенного sitemap пропускает только его.
 */
export async function fetchSitemapUrls(
  sitemapUrl: string,
  fetcher: CrawlFetcher,
  maxUrls: number = SITEMAP_MAX_URLS,
  isSitemapUrlAllowed: (url: string) => boolean = () => true,
): Promise<readonly string[]> {
  if (!isSitemapUrlAllowed(sitemapUrl)) {
    return [];
  }
  const rootBody = await fetchBody(sitemapUrl, fetcher);
  if (rootBody === null) {
    return [];
  }
  if (!SITEMAP_INDEX_PATTERN.test(rootBody)) {
    return extractLocs(rootBody).slice(0, maxUrls);
  }

  const childUrls = extractLocs(rootBody);
  const collected: string[] = [];
  for (const childUrl of childUrls) {
    if (collected.length >= maxUrls) {
      break;
    }
    if (!isSitemapUrlAllowed(childUrl)) {
      continue; // чужой host в sitemapindex — не фетчим (scope, план §25)
    }
    const childBody = await fetchBody(childUrl, fetcher);
    if (childBody === null || SITEMAP_INDEX_PATTERN.test(childBody)) {
      continue; // вложенный индекс глубже 1 уровня не разворачиваем
    }
    collected.push(...extractLocs(childBody).slice(0, maxUrls - collected.length));
  }
  return collected;
}

async function fetchBody(url: string, fetcher: CrawlFetcher): Promise<string | null> {
  try {
    const response = await fetcher(url);
    return response.status === 200 ? response.body : null;
  } catch {
    // Отсутствие/недоступность sitemap — штатная ситуация, обход продолжается.
    return null;
  }
}

function extractLocs(xml: string): readonly string[] {
  return [...xml.matchAll(LOC_PATTERN)]
    .map((match) => decodeXmlEntities(match[1] ?? ''))
    .filter((loc) => loc !== '');
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
