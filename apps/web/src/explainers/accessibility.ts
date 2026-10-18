// Accessibility: what makes a page harder to use with a screen reader or a keyboard.

import { type ExplainedRule } from './types';

export const ACCESSIBILITY_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  'A11Y-003': {
    countsPages: true,
    en: {
      title: 'Page language not set, or headings out of order',
      what: 'On these pages either the page does not say which language it is written in, or its headings do not form a clear outline: there is no main heading, there are several, or a level is skipped.',
      why: 'Screen readers use the page language to pronounce the text, and many of their users move through a page by its headings.',
      fix: 'Ask your website developer to set the page language and to give each page one main heading with sub-headings in order. The technical details say which of the two applies to each page.',
      count: 'One finding for each page, whichever of the two it has.',
    },
    uk: {
      title: 'Не вказано мову сторінки або порушено порядок заголовків',
      what: 'На цих сторінках або не вказано, якою мовою написано сторінку, або заголовки не складаються в чітку структуру: головного заголовка немає, їх кілька чи пропущено рівень.',
      why: 'Програми читання з екрана за мовою сторінки вимовляють текст, а багато їхніх користувачів переходять сторінкою саме за заголовками.',
      fix: 'Попросіть розробника вказати мову сторінки й дати кожній сторінці один головний заголовок із підзаголовками по порядку. Технічні деталі показують, що з цього стосується кожної сторінки.',
      count:
        'Одна знахідка на кожну сторінку, незалежно від того, що саме з цього на ній знайдено.',
    },
  },
  'A11Y-007': {
    countsPages: true,
    en: {
      title: 'Screen-reader hints on these pages are broken',
      what: 'Some elements on these pages carry hints meant for screen readers and other assistive tools, but a hint names a role that does not exist, points to a part of the page that is not there, or hides from those tools something a keyboard user can still reach.',
      why: 'People who use a screen reader or a keyboard rely on these hints to know what an element is and to reach it. A broken hint can make a menu or a button confusing or unusable for them.',
      fix: 'Ask your website developer to correct or remove the broken hint on the element named in the technical details. It is often one shared part of the site, such as the menu, repeated on every page.',
      count:
        'One finding for each page; the technical details name the first broken element on it.',
    },
    uk: {
      title: 'Підказки для програм читання з екрана несправні',
      what: 'Деякі елементи цих сторінок мають підказки для програм читання з екрана та інших допоміжних засобів, але підказка називає роль, якої не існує, посилається на частину сторінки, якої немає, або ховає від цих засобів те, до чого можна дістатися з клавіатури.',
      why: 'Люди, які користуються програмою читання з екрана чи клавіатурою, з цих підказок дізнаються, що це за елемент, і дістаються до нього. Несправна підказка може зробити меню чи кнопку незрозумілими або недоступними для них.',
      fix: 'Попросіть розробника виправити або прибрати несправну підказку на елементі, названому в технічних деталях. Часто це одна спільна частина сайту, наприклад меню, що повторюється на кожній сторінці.',
      count:
        'Одна знахідка на кожну сторінку; технічні деталі називають перший несправний елемент на ній.',
    },
  },
};
