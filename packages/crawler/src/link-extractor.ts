// Извлечение ссылок обхода из HTML (T-07): href всех <a>,
// разрешение относительных URL против finalUrl, только http(s).
// Плюс `MEDIA_SELECTOR` — один селектор на media-пробы обхода (resources.ts) и
// на CONTENT-004, чтобы правило и проверка не расходились в том, что считается
// media страницы.

import { parse } from 'node-html-parser';

/**
 * Возвращает абсолютные http(s)-URL из href всех <a> документа в порядке
 * появления. Относительные ссылки разрешаются против baseUrl (finalUrl
 * страницы); пустые href, не-http(s)-схемы (mailto:, javascript:, tel:)
 * и неразбираемые значения пропускаются.
 */
export function extractLinks(html: string, baseUrl: string): readonly string[] {
  const root = parse(html);
  return root
    .querySelectorAll('a')
    .map((anchor) => anchor.getAttribute('href'))
    .filter((href): href is string => href !== undefined && href.trim() !== '')
    .map((href) => resolveHttpUrl(href.trim(), baseUrl))
    .filter((url): url is string => url !== null);
}

function resolveHttpUrl(href: string, baseUrl: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(href, baseUrl);
  } catch {
    return null; // мусорный href — штатный веб, не ошибка обхода
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return null;
  }
  return resolved.href;
}

/**
 * The media selector CONTENT-004 reads.
 *
 * One constant, used by the rule and by the crawl's media verification, so the
 * set of files a report calls broken is exactly the set the crawl asked about.
 */
export const MEDIA_SELECTOR = 'img[src], source[src], video[src], audio[src]';
