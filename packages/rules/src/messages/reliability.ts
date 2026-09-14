// Reliability finding messages (REL-URL-*, REL-API-*).

import type { FindingMessageCatalog } from './catalog.js';

export const RELIABILITY_MESSAGES = {
  'rel-url-001.evidence': {
    en: '{url} is unreachable: {error}',
    uk: 'Адреса {url} недоступна: {error}',
  },
  'rel-url-001.recommendation': {
    en: 'Check the DNS records, the TLS certificate and that the server is up: the URL must respond within the timeout (10 s per attempt).',
    uk: 'Перевірте DNS-записи, TLS-сертифікат і доступність сервера: URL має відповідати в межах тайм-ауту (10 с на спробу).',
  },
  'rel-url-003.evidence': {
    en: 'HTTP {status} at {url}: server error',
    uk: 'HTTP {status} на {url}: помилка сервера',
  },
  'rel-url-003.recommendation': {
    en: 'Fix the cause of the 5xx response: a server error on a public URL is an availability failure, not a content problem.',
    uk: 'Усуньте причину відповіді 5xx: помилка сервера на публічній адресі означає збій доступності, а не проблему з контентом.',
  },
  'rel-url-009.evidence': {
    en: 'Response time {responseMs} ms exceeds {thresholdMs} ms (HTTP {status} {url})',
    uk: 'Час відповіді {responseMs} мс перевищує {thresholdMs} мс (HTTP {status} {url})',
  },
  'rel-url-009.recommendation': {
    en: 'Speed up the server response with caching, a CDN or backend optimization: the report threshold is {thresholdMs} ms per page.',
    uk: 'Пришвидшіть відповідь сервера за допомогою кешування, CDN або оптимізації бекенду: поріг звіту становить {thresholdMs} мс на сторінку.',
  },
  'rel-api-003.evidence': {
    en: '{method} {url} returned HTTP {status}, expected {expected}',
    uk: '{method} {url} повернув HTTP {status}, очікувався {expected}',
  },
  'rel-api-003.recommendation': {
    en: 'Bring the endpoint back to its expected status, or update expected_status for this check if the new behavior is intentional.',
    uk: 'Поверніть endpoint до очікуваного статусу або оновіть expected_status цієї перевірки, якщо нова поведінка навмисна.',
  },
  'rel-api-005.evidence.blocked': {
    en: '{method} {url}: the check configuration contains credential headers ({headers}); the request was blocked by policy and not sent',
    uk: '{method} {url}: конфігурація перевірки містить заголовки з обліковими даними ({headers}); політика заблокувала запит, і його не надіслано',
  },
  'rel-api-005.evidence.sent': {
    en: '{method} {url}: the check configuration contains credential headers ({headers}); the request was sent despite the policy',
    uk: '{method} {url}: конфігурація перевірки містить заголовки з обліковими даними ({headers}); запит надіслано попри політику',
  },
  'rel-api-005.recommendation': {
    en: 'Remove credentials from the check configuration: only public endpoints that need no authorization are checked (no-credentials policy).',
    uk: 'Приберіть облікові дані з конфігурації перевірки: перевіряються лише публічні endpoints без авторизації (політика no-credentials).',
  },
} as const satisfies FindingMessageCatalog;
