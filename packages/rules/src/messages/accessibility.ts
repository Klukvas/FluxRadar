// Accessibility finding messages (A11Y-*).

import type { FindingMessageCatalog } from './catalog.js';

export const ACCESSIBILITY_MESSAGES = {
  'a11y-001.evidence': {
    en: '{selector} sets inline color/background-color with a contrast ratio of {ratio}:1, below the {threshold}:1 threshold.',
    uk: '{selector} задає inline color/background-color з контрастом {ratio}:1 — це нижче за поріг {threshold}:1.',
  },
  'a11y-001.recommendation': {
    en: 'Raise the contrast between text and background to at least 4.5:1 for normal text or 3:1 for large text. Check the final rules from external CSS manually.',
    uk: 'Підвищте контраст між текстом і фоном щонайменше до 4.5:1 для звичайного тексту або 3:1 для великого. Остаточні правила із зовнішніх CSS перевірте вручну.',
  },

  'a11y-002.evidence': {
    en: '<img> elements without alt: {count}. A screen reader announces them as "image" with no description. First one: <img src="{src}">',
    uk: 'Елементів <img> без alt: {count}. Зчитувач екрана оголошує їх як «image» без опису. Перший: <img src="{src}">',
  },
  'a11y-002.recommendation': {
    en: 'Give every meaningful image an informative alt, and give decorative images an explicit empty alt="" so screen readers skip them.',
    uk: 'Додайте кожному змістовному зображенню інформативний alt, а декоративним — явний порожній alt="", щоб зчитувачі екрана їх пропускали.',
  },

  // One code per combination of the three problems, so the evidence names exactly
  // the ones the page has: a <h1> count appears only when it is wrong, and then
  // always as a problem rather than as a neutral number.
  'a11y-003.evidence.missing-lang': {
    en: 'html[lang] is missing or empty.',
    uk: 'html[lang] відсутній або порожній.',
  },
  'a11y-003.evidence.h1-count': {
    en: '<h1> headings on the page: {h1Count}; exactly one is expected.',
    uk: 'Заголовків <h1> на сторінці: {h1Count}, а очікується рівно один.',
  },
  'a11y-003.evidence.skipped-level': {
    en: 'The heading level jumps from h{fromLevel} to h{toLevel}.',
    uk: 'Рівень заголовків перескакує з h{fromLevel} на h{toLevel}.',
  },
  'a11y-003.evidence.missing-lang.h1-count': {
    en: 'html[lang] is missing or empty. <h1> headings on the page: {h1Count}; exactly one is expected.',
    uk: 'html[lang] відсутній або порожній. Заголовків <h1> на сторінці: {h1Count}, а очікується рівно один.',
  },
  'a11y-003.evidence.missing-lang.skipped-level': {
    en: 'html[lang] is missing or empty. The heading level jumps from h{fromLevel} to h{toLevel}.',
    uk: 'html[lang] відсутній або порожній. Рівень заголовків перескакує з h{fromLevel} на h{toLevel}.',
  },
  'a11y-003.evidence.h1-count.skipped-level': {
    en: '<h1> headings on the page: {h1Count}; exactly one is expected. The heading level jumps from h{fromLevel} to h{toLevel}.',
    uk: 'Заголовків <h1> на сторінці: {h1Count}, а очікується рівно один. Рівень заголовків перескакує з h{fromLevel} на h{toLevel}.',
  },
  'a11y-003.evidence.missing-lang.h1-count.skipped-level': {
    en: 'html[lang] is missing or empty. <h1> headings on the page: {h1Count}; exactly one is expected. The heading level jumps from h{fromLevel} to h{toLevel}.',
    uk: 'html[lang] відсутній або порожній. Заголовків <h1> на сторінці: {h1Count}, а очікується рівно один. Рівень заголовків перескакує з h{fromLevel} на h{toLevel}.',
  },
  'a11y-003.recommendation': {
    en: 'Set the page language in html[lang], use exactly one <h1>, and do not skip heading levels without a structural reason.',
    uk: 'Вкажіть мову сторінки в html[lang], використовуйте рівно один <h1> і не пропускайте рівні заголовків без структурної причини.',
  },

  'a11y-004.evidence': {
    en: 'Form control without a label: {selector}. It has no label[for], no wrapping <label>, and no aria-label or aria-labelledby.',
    uk: 'Елемент форми без підпису: {selector}. Немає ні label[for], ні обгортки <label>, ні aria-label чи aria-labelledby.',
  },
  'a11y-004.recommendation': {
    en: 'Connect every form control to a label: <label for="id">, a wrapping <label>, or aria-label/aria-labelledby when there is no visible label.',
    uk: 'Пов’яжіть кожен елемент форми з підписом: <label for="id">, обгортка <label> або aria-label/aria-labelledby, якщо видимого підпису немає.',
  },

  'a11y-005.evidence.positive-tabindex': {
    en: '{selector} uses tabindex > 0.',
    uk: '{selector} використовує tabindex > 0.',
  },
  'a11y-005.evidence.mouse-only': {
    en: '{selector} has an onclick handler but no keyboard handler.',
    uk: '{selector} має обробник onclick, але не має обробника клавіатури.',
  },
  'a11y-005.recommendation': {
    en: 'Do not use tabindex values above zero. For interactive elements, use native buttons and links, or add equivalent keyboard control.',
    uk: 'Не використовуйте tabindex більше за нуль. Для інтерактивних елементів застосовуйте нативні кнопки й посилання або додайте рівноцінне керування з клавіатури.',
  },

  'a11y-006.evidence.stylesheet': {
    en: 'A :focus rule in a <style> block turns off the outline, and no replacement was found.',
    uk: 'Правило :focus у блоці <style> вимикає outline, а заміни не виявлено.',
  },
  'a11y-006.evidence.inline': {
    en: 'An inline style on <{tag}> turns off the outline with no replacement.',
    uk: 'Inline-стиль елемента <{tag}> вимикає outline без заміни.',
  },
  'a11y-006.recommendation': {
    en: 'Keep a visible focus indicator with sufficient contrast, and make sure focus is not hidden under sticky or fixed content (WCAG 2.4.11).',
    uk: 'Збережіть видимий індикатор фокуса з достатнім контрастом і переконайтеся, що фокус не ховається під sticky- чи fixed-контентом (WCAG 2.4.11).',
  },

  'a11y-007.evidence.unknown-role': {
    en: '{selector} has an unknown ARIA role="{role}".',
    uk: '{selector} має невідому ARIA-роль role="{role}".',
  },
  'a11y-007.evidence.missing-reference': {
    en: '{selector} points to ARIA ids that do not exist: {references}.',
    uk: '{selector} посилається на ARIA id, яких немає на сторінці: {references}.',
  },
  'a11y-007.evidence.hidden-focusable': {
    en: '{selector} has aria-hidden="true" but is still in the tab order.',
    uk: '{selector} має aria-hidden="true", але лишається в порядку переходу клавішею Tab.',
  },
  'a11y-007.recommendation': {
    en: 'Use only valid ARIA roles and check that every id referenced by aria-* attributes exists. Do not hide keyboard-focusable elements with aria-hidden="true".',
    uk: 'Використовуйте лише валідні ARIA-ролі та перевіряйте, що всі id, на які посилаються aria-* атрибути, існують. Не приховуйте доступні з клавіатури елементи через aria-hidden="true".',
  },

  'a11y-008.evidence.link-without-href': {
    en: '{selector}: a link without href cannot be reached with the keyboard.',
    uk: '{selector}: посилання без href недоступне з клавіатури.',
  },
  'a11y-008.evidence.missing-name': {
    en: '{selector}: the interactive element has no accessible name.',
    uk: '{selector}: інтерактивний елемент не має доступної назви.',
  },
  'a11y-008.recommendation': {
    en: 'Use a link with href or a button, and give it an accessible name through visible text, aria-label, aria-labelledby or a proper label.',
    uk: 'Використовуйте посилання з href або кнопку й задайте доступну назву видимим текстом, aria-label, aria-labelledby чи коректним label.',
  },

  'a11y-009.evidence': {
    en: '{selector} has aria-invalid="true" but is not linked to an error message.',
    uk: '{selector} має aria-invalid="true", але не пов’язаний із текстом помилки.',
  },
  'a11y-009.recommendation': {
    en: 'Link the invalid control to a clear error message with aria-describedby or aria-errormessage, and update the message after validation.',
    uk: 'Пов’яжіть невалідний елемент зі зрозумілим повідомленням про помилку через aria-describedby або aria-errormessage та оновлюйте повідомлення після валідації.',
  },

  'a11y-010.evidence.missing-main': {
    en: '{selector}: the page has no main landmark.',
    uk: '{selector}: на сторінці немає орієнтира main.',
  },
  'a11y-010.evidence.multiple-main': {
    en: '{selector}: the page has more than one main landmark.',
    uk: '{selector}: на сторінці кілька орієнтирів main.',
  },
  'a11y-010.evidence.untitled-iframe': {
    en: '{selector}: iframe without a title.',
    uk: '{selector}: iframe без title.',
  },
  'a11y-010.evidence.video-without-captions': {
    en: '{selector}: video without a captions or subtitles track.',
    uk: '{selector}: video без доріжки captions чи subtitles.',
  },
  'a11y-010.evidence.unnamed-nav': {
    en: '{selector}: one of several nav landmarks has no accessible name.',
    uk: '{selector}: один із кількох орієнтирів nav не має доступної назви.',
  },
  'a11y-010.recommendation': {
    en: 'Keep a single main landmark, name repeated nav landmarks, and provide a title for each iframe and captions or subtitles for each video.',
    uk: 'Залиште один орієнтир main, дайте назви повторюваним орієнтирам nav, додайте title до iframe та captions чи subtitles до video.',
  },
} as const satisfies FindingMessageCatalog;
