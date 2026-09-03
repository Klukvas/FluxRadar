// Доступ к заголовкам PageSnapshot для passive-правил (T-09): безопасный
// case-insensitive поиск и разбор Set-Cookie. safe-fetch отдаёт заголовки
// lowercase (node IncomingHttpHeaders) и склеивает повторы через ', ' —
// сплиттер обязан не резать запятую внутри Expires (RFC 6265).

import type { PageSnapshot } from '@fluxradar/crawler';

/** Значение заголовка (case-insensitive); null — заголовка нет. */
export function headerValue(page: PageSnapshot, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(page.headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return null;
}

/**
 * Отдельные значения Set-Cookie из склеенного заголовка. Новая кука начинается
 * с `name=` сразу после запятой; запятая внутри Expires (`Wed, 21 Oct ...`)
 * таким паттерном не матчится — дата после неё не содержит `=` до `;`.
 */
export function setCookieValues(page: PageSnapshot): readonly string[] {
  const raw = headerValue(page, 'set-cookie');
  if (raw === null || raw.trim() === '') {
    return [];
  }
  return raw
    .split(/,(?=\s*[^\s;,=]+=)/)
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

export interface ParsedCookie {
  readonly name: string;
  /** Атрибуты lowercase без значений: secure, httponly, samesite, path, ... */
  readonly attributes: ReadonlySet<string>;
}

/** Имя и набор атрибутов одной куки; value намеренно не возвращается (секрет). */
export function parseSetCookie(value: string): ParsedCookie {
  const [pair = '', ...attributeParts] = value.split(';');
  const name = pair.split('=')[0]?.trim() ?? '';
  const attributes = new Set(
    attributeParts
      .map((part) => part.split('=')[0]?.trim().toLowerCase() ?? '')
      .filter((part) => part !== ''),
  );
  return { name, attributes };
}
