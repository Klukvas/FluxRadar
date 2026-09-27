// Content Quality finding messages (CONTENT-*).

import type { FindingMessageCatalog } from './catalog.js';

export const CONTENT_MESSAGES = {
  // Текст страницы в evidence целиком не влезает и не нужен: читателю хватает
  // его начала, длины и адресов, по которым лежит то же самое. Список адресов
  // ограничен тремя, и текст это говорит: счёт и перечисление расходятся на
  // большой группе. Оговорка «as crawled» называет границу вердикта — canonical
  // на адрес, снимка которого у обхода нет, связать страницу с членом группы не
  // может. Длина считается по раскрытому тексту (`&amp;` — один символ), как и
  // у CONTENT-003.
  'content-001.evidence': {
    en: 'Other crawled pages with the same visible text: {count}; at most three are listed here: {pages}. No <link rel="canonical"> ties this page to any of them, as crawled. The text is {length} characters and begins: "{preview}"',
    uk: 'Інших прочитаних сторінок із таким самим видимим текстом: {count}; тут названо не більше трьох: {pages}. <link rel="canonical"> не пов’язує цю сторінку з жодною з них — за тим, як їх прочитав обхід. Текст має {length} символів і починається так: «{preview}»',
  },
  'content-001.recommendation': {
    en: 'Keep one address for this text and point the copies at it with <link rel="canonical">, or rewrite each page around what only it covers. Duplicated pages compete with each other for the same queries.',
    uk: 'Залиште для цього тексту одну адресу, а копії вкажіть на неї через <link rel="canonical">, або перепишіть кожну сторінку про те, що є лише на ній. Сторінки-дублікати конкурують між собою за ті самі запити.',
  },

  'content-003.evidence': {
    en: 'Visible text length is {length}, below the minimum of {minimum} characters for a page with real content: "{preview}"',
    uk: 'Довжина видимого тексту — {length}, це менше за мінімум для змістовної сторінки ({minimum} символів): "{preview}"',
  },
  'content-003.recommendation': {
    en: 'Add meaningful text to the page, or keep it out of search results with noindex if it is a utility page.',
    uk: 'Додайте на сторінку змістовний текст або закрийте її від індексації (noindex), якщо це службова сторінка.',
  },
  // A broken media reference fails in one of three proven ways. A page whose
  // media all fail the same way (the usual case: one broken image) gets a short
  // sentence for that way; only a mix gets the full breakdown, with "—" for a
  // way nothing failed in.
  //
  // The catalog also keeps the two codes of the four-kind era below. Findings
  // stored then still refer to them, and the report renders the stored code
  // rather than the stored sentence: dropping a code would replace an accurate
  // Ukrainian sentence with an English fallback, and re-pointing `mixed` at a
  // three-part template would print "Broken media: 3" and then list one of them.
  // Historical codes are render-only — see RENDER_ONLY_MESSAGE_CODES.
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
  'content-004.evidence.mixed-v2': {
    en: 'Broken media: {count}. Unreachable: {unreachable}. HTTP error: {httpErrors}. Returns an HTML page instead of media: {htmlResponses}.',
    uk: 'Битих медіафайлів: {count}. Недоступні: {unreachable}. Помилка HTTP: {httpErrors}. Повертають HTML-сторінку замість медіафайлу: {htmlResponses}.',
  },
  /** Historical (render-only): the crawl-unconfirmed kind, dropped from the rule. */
  'content-004.evidence.unconfirmed': {
    en: 'Internal media the crawl could not confirm ({count}): {items}',
    uk: 'Внутрішні медіафайли, не підтверджені обходом ({count}): {items}',
  },
  /** Historical (render-only): the four-kind breakdown, including `unconfirmed`. */
  'content-004.evidence.mixed': {
    en: 'Broken media: {count}. Unreachable: {unreachable}. HTTP error: {httpErrors}. Returns an HTML page instead of media: {htmlResponses}. Internal, not confirmed by the crawl: {unconfirmed}.',
    uk: 'Битих медіафайлів: {count}. Недоступні: {unreachable}. Помилка HTTP: {httpErrors}. Повертають HTML-сторінку замість медіафайлу: {htmlResponses}. Внутрішні, не підтверджені обходом: {unconfirmed}.',
  },
  'content-004.recommendation': {
    en: 'Replace or remove the broken media links: a broken image spoils a page more visibly than any other content problem.',
    uk: 'Замініть або видаліть биті посилання на медіафайли: зламане зображення псує сторінку помітніше, ніж будь-яка інша проблема з контентом.',
  },
} as const satisfies FindingMessageCatalog;
