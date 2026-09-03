// Извлечение ссылок обхода из HTML (T-07): href всех <a>,
// разрешение относительных URL против finalUrl, только http(s).

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
