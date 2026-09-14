// Security finding messages (SEC-PASSIVE-*, SEC-ASVS-*).

import type { FindingMessageCatalog } from './catalog.js';

export const SECURITY_MESSAGES = {
  'sec-passive-002.evidence': {
    en: 'The HTML response is missing security headers ({count}): {headers}',
    uk: 'HTML-відповідь не містить заголовків безпеки ({count}): {headers}',
  },
  'sec-passive-002.recommendation': {
    en: 'Send X-Content-Type-Options: nosniff, Referrer-Policy and framing protection (X-Frame-Options or CSP frame-ancestors) with HTML responses.',
    uk: 'Додайте до HTML-відповідей X-Content-Type-Options: nosniff, Referrer-Policy і захист від вбудовування у фрейми (X-Frame-Options або CSP frame-ancestors).',
  },
  'sec-passive-003.evidence.missing': {
    en: 'The HTTPS homepage response has no Strict-Transport-Security header',
    uk: 'Відповідь головної сторінки через HTTPS не містить заголовка Strict-Transport-Security',
  },
  'sec-passive-003.evidence.no-max-age': {
    en: 'Strict-Transport-Security has no positive max-age: {header}',
    uk: 'Strict-Transport-Security не має додатного max-age: {header}',
  },
  'sec-passive-003.recommendation': {
    en: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains on every HTTPS response, starting with the homepage.',
    uk: 'Надсилайте Strict-Transport-Security: max-age=31536000; includeSubDomains в усіх HTTPS-відповідях, починаючи з головної сторінки.',
  },
  'sec-passive-005.evidence': {
    en: 'Set-Cookie "{cookie}" is missing attributes: {attributes}',
    uk: 'Set-Cookie "{cookie}" не має атрибутів: {attributes}',
  },
  'sec-passive-005.recommendation': {
    en: 'Give cookies the Secure, HttpOnly and SameSite (Lax or Strict) attributes; make exceptions deliberately and only for cookies that do not hold a session.',
    uk: 'Задавайте cookie атрибути Secure, HttpOnly і SameSite (Lax або Strict); винятки робіть свідомо і лише для cookie, які не зберігають сесію.',
  },
  'sec-asvs-001.evidence': {
    en: 'The HTML response has no Content-Security-Policy',
    uk: 'HTML-відповідь не містить Content-Security-Policy',
  },
  'sec-asvs-001.recommendation': {
    en: 'Add a Content-Security-Policy that allows only the sources you need, and roll changes out in report-only mode before tightening the policy.',
    uk: 'Додайте Content-Security-Policy, що дозволяє лише потрібні джерела, і перевіряйте зміни в режимі report-only, перш ніж посилювати політику.',
  },
  'sec-asvs-002.evidence': {
    en: 'The HTML response has no Permissions-Policy',
    uk: 'HTML-відповідь не містить Permissions-Policy',
  },
  'sec-asvs-002.recommendation': {
    en: 'Set a Permissions-Policy that explicitly turns off browser features you do not use, such as camera, microphone and geolocation.',
    uk: 'Задайте Permissions-Policy і явно вимкніть функції браузера, якими не користуєтеся, наприклад camera, microphone і geolocation.',
  },
  'sec-asvs-003.evidence': {
    en: 'The response combines Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true',
    uk: 'Відповідь поєднує Access-Control-Allow-Origin: * з Access-Control-Allow-Credentials: true',
  },
  'sec-asvs-003.recommendation': {
    en: 'Do not combine a wildcard origin with credentialed CORS: list trusted origins explicitly and allow credentials only where they are needed.',
    uk: 'Не поєднуйте wildcard origin із CORS-запитами з credentials: явно перелічуйте довірені origins і дозволяйте credentials лише там, де вони потрібні.',
  },
} as const satisfies FindingMessageCatalog;
