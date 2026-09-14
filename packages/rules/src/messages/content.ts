// Content Quality finding messages (CONTENT-*).

import type { FindingMessageCatalog } from './catalog.js';

export const CONTENT_MESSAGES = {
  'content-003.evidence': {
    en: 'Visible text length is {length}, below the minimum of {minimum} characters for a page with real content: "{preview}"',
    uk: 'Довжина видимого тексту — {length}, це менше за мінімум для змістовної сторінки ({minimum} символів): "{preview}"',
  },
  'content-003.recommendation': {
    en: 'Add meaningful text to the page, or keep it out of search results with noindex if it is a utility page.',
    uk: 'Додайте на сторінку змістовний текст або закрийте її від індексації (noindex), якщо це службова сторінка.',
  },
  // A broken media reference fails in one of four ways. A page whose media all
  // fail the same way (the usual case: one broken image) gets a short sentence
  // for that way; only a mix gets the full breakdown, with "—" for a way nothing
  // failed in.
  'content-004.evidence.unreachable': {
    en: 'Unreachable media ({count}): {items}',
    uk: 'Недоступні медіафайли ({count}): {items}',
  },
  'content-004.evidence.http-error': {
    en: 'Media that returns an HTTP error ({count}): {items}',
    uk: 'Медіафайли, що повертають помилку HTTP ({count}): {items}',
  },
  'content-004.evidence.html-response': {
    en: 'Media links that return an HTML page instead of a file ({count}): {items}',
    uk: 'Посилання на медіафайли, що повертають HTML-сторінку замість файлу ({count}): {items}',
  },
  'content-004.evidence.unconfirmed': {
    en: 'Internal media the crawl could not confirm ({count}): {items}',
    uk: 'Внутрішні медіафайли, не підтверджені обходом ({count}): {items}',
  },
  'content-004.evidence.mixed': {
    en: 'Broken media: {count}. Unreachable: {unreachable}. HTTP error: {httpErrors}. Returns an HTML page instead of media: {htmlResponses}. Internal, not confirmed by the crawl: {unconfirmed}.',
    uk: 'Битих медіафайлів: {count}. Недоступні: {unreachable}. Помилка HTTP: {httpErrors}. Повертають HTML-сторінку замість медіафайлу: {htmlResponses}. Внутрішні, не підтверджені обходом: {unconfirmed}.',
  },
  'content-004.recommendation': {
    en: 'Replace or remove the broken media links: a broken image spoils a page more visibly than any other content problem.',
    uk: 'Замініть або видаліть биті посилання на медіафайли: зламане зображення псує сторінку помітніше, ніж будь-яка інша проблема з контентом.',
  },
} as const satisfies FindingMessageCatalog;
