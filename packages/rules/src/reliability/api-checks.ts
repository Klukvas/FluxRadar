// Общая логика API-проверок Reliability (§9 contract v1): детекция
// credentials-заголовков (REL-API-005) и матчинг expected status
// (REL-API-003). Детекция по имени заголовка — значения не читаются
// и в evidence не попадают.

import type { ApiCheck } from '../engine/types.js';

/** Точные имена credentials-заголовков (lowercase). */
const CREDENTIAL_HEADER_NAMES = new Set(['authorization', 'cookie', 'proxy-authorization']);

/** Паттерны «API keys или другие credentials» (§9): api-key/token/secret. */
const CREDENTIAL_NAME_PATTERN = /api[-_]?key|(^|[-_])(token|secret)([-_]|$)/i;

/** Имена credentials-заголовков в конфиге проверки (пусто — конфиг чистый). */
export function credentialHeaderNames(check: ApiCheck): readonly string[] {
  return Object.keys(check.requestHeaders ?? {}).filter(
    (name) => CREDENTIAL_HEADER_NAMES.has(name.toLowerCase()) || CREDENTIAL_NAME_PATTERN.test(name),
  );
}

export function hasCredentialHeaders(check: ApiCheck): boolean {
  return credentialHeaderNames(check).length > 0;
}

/**
 * Verdict precedence §9: фактический статус входит в явно заданный
 * expected_status → pass (в том числе ожидаемые 3xx/404/5xx); без явного
 * списка ожидается любой 2xx.
 */
export function isExpectedStatus(check: ApiCheck, status: number): boolean {
  const expected = check.expectedStatus ?? [];
  if (expected.length === 0) {
    return status >= 200 && status < 300;
  }
  return expected.includes(status);
}

/** Человекочитаемая форма ожидания для evidence. */
export function expectedStatusLabel(check: ApiCheck): string {
  const expected = check.expectedStatus ?? [];
  return expected.length === 0 ? '2xx' : expected.join('/');
}
