// Извлечение ссылок обхода из HTML (T-07): href всех <a>,
// разрешение относительных URL против finalUrl, только http(s).
// Плюс `MEDIA_SELECTOR` — один селектор на media-пробы обхода (resources.ts) и
// на CONTENT-004, чтобы правило и проверка не расходились в том, что считается
// media страницы.

import { parse } from 'node-html-parser';

/**
 * Возвращает абсолютные http(s)-URL из href всех <a> документа в порядке
 * появления. Относительные ссылки разрешаются против baseUrl (finalUrl
 * страницы); пустые href, не-http(s)-схемы (mailto:, javascript:, tel:),
 * неразбираемые значения и подменённый Cloudflare-ом email
 * (isCloudflareEmailObfuscationUrl) пропускаются.
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
  if (isCloudflareEmailObfuscationUrl(resolved)) {
    return null;
  }
  return resolved.href;
}

/**
 * Cloudflare's email obfuscation: the protected `mailto:` is replaced by a link
 * to this endpoint, and its hexadecimal fragment is decoded back into the
 * address by Cloudflare's own script in the browser. A visitor never navigates
 * there, so it is neither a page of the site nor a crawl target — and the
 * endpoint answers a crawler with its own error, which used to be reported as a
 * broken link of every page that hides an email this way.
 *
 * ИМЕННО ЭТА ФОРМА, А НЕ ВСЁ ПОХОЖЕЕ. Признаётся только точный путь с непустым
 * hex-хвостом чётной длины — ровно то, что пишет Cloudflare (ключ плюс байты
 * адреса, по два символа на байт). Ссылка без хвоста, с не-hex хвостом или на
 * соседний `/cdn-cgi/...` остаётся обычной ссылкой сайта: заглушить её значило
 * бы спрятать настоящий 404 под чужим именем.
 */
export function isCloudflareEmailObfuscationUrl(url: URL): boolean {
  const encodedEmail = url.hash.slice(1);
  return (
    url.pathname === '/cdn-cgi/l/email-protection' &&
    encodedEmail.length > 0 &&
    encodedEmail.length % 2 === 0 &&
    /^[\da-f]+$/i.test(encodedEmail)
  );
}

/**
 * The media selector CONTENT-004 reads.
 *
 * One constant, used by the rule and by the crawl's media verification, so the
 * set of files a report calls broken is exactly the set the crawl asked about.
 */
export const MEDIA_SELECTOR = 'img[src], source[src], video[src], audio[src]';
