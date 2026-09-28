// Content Quality finding messages (CONTENT-*).

import type { FindingMessageCatalog } from './catalog.js';

export const CONTENT_MESSAGES = {
  // Текст страницы в evidence целиком не влезает и не нужен: читателю хватает
  // его начала, длины и адресов, по которым лежит то же самое. Список адресов
  // ограничен тремя, и текст это говорит: счёт и перечисление расходятся на
  // большой группе. Оговорка «as crawled» называет границу вердикта — canonical
  // на адрес, снимка которого у обхода нет, связать страницу с членом группы не
  // может. Длина считается по раскрытому тексту в форме NFC (`&amp;` — один
  // символ), тому же самому, который меряет CONTENT-003.
  //
  // Причин у находки две, и средняя фраза у них разная — ровно как у дублей
  // title и description (см. seo-onpage-004 в messages/seo.ts и UnclaimedReason
  // в shared/duplicate-groups.ts).
  'content-001.evidence.no-canonical': {
    en: 'Other crawled pages with the same visible text: {count}; at most three are listed here: {pages}. No <link rel="canonical"> ties this page to any of them, as crawled. The text is {length} characters and begins: "{preview}"',
    uk: 'Інших прочитаних сторінок із таким самим видимим текстом: {count}; тут названо не більше трьох: {pages}. <link rel="canonical"> не пов’язує цю сторінку з жодною з них — за тим, як їх прочитав обхід. Текст має {length} символів і починається так: «{preview}»',
  },
  'content-001.evidence.unresolved-chain': {
    en: 'Other crawled pages with the same visible text: {count}; at most three are listed here: {pages}. This page has a <link rel="canonical">, but the chain it starts leaves these pages or loops back and names no final version among them, as crawled. The text is {length} characters and begins: "{preview}"',
    uk: 'Інших прочитаних сторінок із таким самим видимим текстом: {count}; тут названо не більше трьох: {pages}. У цієї сторінки є <link rel="canonical">, але ланцюжок, який вона починає, виходить за межі цих сторінок або замикається в петлю й не називає остаточної версії серед них — за тим, як їх прочитав обхід. Текст має {length} символів і починається так: «{preview}»',
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

  // Two variant codes rather than one template with a `{scale}` parameter:
  // the human-readable scale name differs by language ("Flesch Reading Ease
  // (English)" vs "Oborneva readability (Cyrillic adaptation)"), and a
  // finding's params are the same values in every locale a report renders it
  // in — a raw slug like `flesch-oborneva-uk` would be the only thing that
  // could go in `{scale}` without one locale showing the other's words.
  'content-005.evidence.en-scale': {
    en: 'Readability score is {score} on a 0-100 scale (Flesch Reading Ease, English), below the minimum of {minimum} for text that is easy to follow. Measured over {sentences} sentence(s) and {words} word(s) of paragraph text.',
    uk: 'Оцінка читабельності — {score} за шкалою 0–100 (Flesch Reading Ease, англійська), це нижче мінімуму {minimum} для тексту, який легко сприймається. Вимірено на {sentences} реченні(-ях) і {words} слові(-ах) тексту абзаців.',
  },
  // Honest about what this scale is: Oborneva fit her coefficients on
  // Russian, not Ukrainian, and this rule applies them to Ukrainian text as
  // an approximation (readability.ts) — the copy says so rather than
  // implying a scale built and validated for Ukrainian.
  'content-005.evidence.uk-scale': {
    en: 'Readability score is {score} on a 0-100 scale (Oborneva readability, a Flesch adaptation calibrated on Russian and applied to Ukrainian text as an approximation), below the minimum of {minimum} for text that is easy to follow. Measured over {sentences} sentence(s) and {words} word(s) of paragraph text.',
    uk: 'Оцінка читабельності — {score} за шкалою 0–100 (читабельність за Оборнєвою — адаптація формули Флеша, відкалібрована на російських текстах і застосована тут до українського тексту як наближення), це нижче мінімуму {minimum} для тексту, який легко сприймається. Вимірено на {sentences} реченні(-ях) і {words} слові(-ах) тексту абзаців.',
  },
  'content-005.recommendation': {
    en: 'Shorten sentences, prefer plain words over long or technical ones, and break up dense paragraphs. This scores the text mechanically (sentence and word length); it does not read for meaning.',
    uk: 'Скоротіть речення, віддавайте перевагу простим словам замість довгих чи технічних, розбийте щільні абзаци. Оцінка рахує текст механічно (довжину речень і слів) і не оцінює зміст.',
  },
} as const satisfies FindingMessageCatalog;
