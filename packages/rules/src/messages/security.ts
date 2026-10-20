// Security finding messages (SEC-PASSIVE-*, SEC-ASVS-*).

import type { FindingMessageCatalog } from './catalog.js';

export const SECURITY_MESSAGES = {
  'sec-passive-007.evidence.spf-missing-monitoring': {
    en: 'No SPF record for {domain}. DMARC is in monitoring mode (p=none); spoofed messages are not blocked.',
    uk: 'Для {domain} немає запису SPF. DMARC у режимі спостереження (p=none); підроблені листи не блокуються.',
  },
  'sec-passive-007.evidence.spf-multiple-monitoring': {
    en: 'Multiple SPF records for {domain} cause a permanent SPF error. DMARC is in monitoring mode (p=none); spoofed messages are not blocked.',
    uk: 'Кілька записів SPF для {domain} спричиняють постійну помилку SPF. DMARC у режимі спостереження (p=none); підроблені листи не блокуються.',
  },
  'sec-passive-007.evidence.spf-all-monitoring': {
    en: 'SPF for {domain} permits every sender (+all). DMARC is in monitoring mode (p=none); spoofed messages are not blocked.',
    uk: 'SPF для {domain} дозволяє всіх відправників (+all). DMARC у режимі спостереження (p=none); підроблені листи не блокуються.',
  },

  'sec-passive-001.evidence.mismatch': {
    en: 'TLS certificate does not cover {hostname}. Issuer: {issuer}; expires: {expires}. {detail}',
    uk: 'TLS-сертифікат не відповідає хосту {hostname}. Видавець: {issuer}; завершення: {expires}. {detail}',
  },

  'sec-passive-001.evidence.untrusted': {
    en: 'TLS certificate for {hostname} is not valid for this host or has an untrusted/incomplete chain. Issuer: {issuer}; expires: {expires}. {detail}',
    uk: 'TLS-сертифікат для {hostname} не відповідає цьому хосту або має недовірений/неповний ланцюжок. Видавець: {issuer}; завершення: {expires}. {detail}',
  },
  'sec-passive-001.evidence.not-yet-valid': {
    en: 'TLS certificate for {hostname} is not yet valid. Issuer: {issuer}; expires: {expires}. {detail}',
    uk: 'TLS-сертифікат для {hostname} ще не набув чинності. Видавець: {issuer}; завершення: {expires}. {detail}',
  },
  'sec-passive-001.evidence.expired': {
    en: 'TLS certificate for {hostname} has expired. Issuer: {issuer}; expires: {expires}. {detail}',
    uk: 'TLS-сертифікат для {hostname} прострочений. Видавець: {issuer}; завершення: {expires}. {detail}',
  },
  'sec-passive-001.evidence.expiring': {
    en: 'TLS certificate for {hostname} expires in fewer than 14 days. Issuer: {issuer}; expires: {expires}. {detail}',
    uk: 'TLS-сертифікат для {hostname} спливає менш ніж за 14 днів. Видавець: {issuer}; завершення: {expires}. {detail}',
  },
  'sec-passive-001.recommendation': {
    en: 'Renew the certificate and serve a valid certificate for this hostname with its complete trusted chain.',
    uk: 'Оновіть сертифікат і налаштуйте чинний сертифікат для цього хоста з повним довіреним ланцюжком.',
  },
  'sec-passive-007.evidence.spf-missing': {
    en: 'No SPF record for {domain}.',
    uk: 'Для {domain} немає запису SPF.',
  },
  'sec-passive-007.evidence.spf-multiple': {
    en: 'Multiple SPF records for {domain} cause a permanent SPF error.',
    uk: 'Кілька записів SPF для {domain} спричиняють постійну помилку SPF.',
  },
  'sec-passive-007.evidence.spf-all': {
    en: 'SPF for {domain} permits every sender (+all).',
    uk: 'SPF для {domain} дозволяє всіх відправників (+all).',
  },
  'sec-passive-007.evidence.dmarc-missing': {
    en: 'No DMARC record for {domain}.',
    uk: 'Для {domain} немає запису DMARC.',
  },
  'sec-passive-007.recommendation': {
    en: 'Publish one SPF record authorizing your mail senders and a DMARC record. A p=none policy monitors spoofed mail without blocking it.',
    uk: 'Опублікуйте один запис SPF із дозволеними поштовими відправниками та запис DMARC. Політика p=none лише спостерігає за підробленими листами, не блокуючи їх.',
  },
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
