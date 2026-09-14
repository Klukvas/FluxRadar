// Static UX/Conversion finding messages (UX-CONV-STATIC-*). AI findings carry
// model-written text and have no codes here.

import type { FindingMessageCatalog } from './catalog.js';

export const UX_MESSAGES = {
  'ux-conv-static-001.evidence': {
    en: 'No h1 heading was present in the fetched entry-page HTML.',
    uk: 'У завантаженому HTML початкової сторінки немає заголовка h1.',
  },
  'ux-conv-static-001.recommendation': {
    en: 'Add one visible h1 that states the page’s main offer or purpose in plain language.',
    uk: 'Додайте один видимий h1, який простими словами називає головну пропозицію або призначення сторінки.',
  },
  'ux-conv-static-002.evidence': {
    en: 'No link, button, or button-like input was present in the fetched entry-page HTML.',
    uk: 'У завантаженому HTML початкової сторінки немає жодного посилання, кнопки чи поля input, що діє як кнопка.',
  },
  'ux-conv-static-002.recommendation': {
    en: 'Provide a visible action that lets visitors continue toward the page’s intended outcome.',
    uk: 'Додайте видиму дію, яка дає відвідувачам змогу рухатися далі до мети цієї сторінки.',
  },
  'ux-conv-static-003.evidence': {
    en: 'Form {form} has no explicit submit control (form controls: {controls}).',
    uk: 'Форма {form} не має явного елемента для надсилання (елементів керування у формі: {controls}).',
  },
  'ux-conv-static-003.recommendation': {
    en: 'Provide a clearly labelled submit control inside the form.',
    uk: 'Додайте всередині форми кнопку надсилання з чітким підписом.',
  },
} as const satisfies FindingMessageCatalog;
