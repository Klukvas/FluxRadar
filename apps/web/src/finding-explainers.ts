// What a security finding means, for an owner who does not run servers.
//
// The three header checks are the ones that fill a report: a site that sends no
// Content-Security-Policy sends none on every page, so one missing line of
// server configuration arrives as hundreds of findings whose only text is
// `The HTML response has no Content-Security-Policy`.
//
// So each entry answers, in the owner's words, what was found, why it is worth
// a developer's time, the one thing the owner can do, and what one finding
// counts — the rules do not all count the same thing. Header names, attribute
// names and server wording belong to the developer, so they stay out of here
// and live in the finding's technical details instead.
//
// Deliberately narrow about what the scanner knows: it reads the response a
// public page sent back. A finding is a safeguard that is not switched on —
// never a claim that the site has been exploited.

import type { Language } from './i18n';

export interface FindingExplainer {
  /** What the check found, without naming a header or an attribute. */
  readonly what: string;
  /** Why it is worth a developer's time — no attack claims, no promises. */
  readonly why: string;
  /** The one thing the owner can do about it. */
  readonly fix: string;
  /** What one finding of this rule is, so the count can be read correctly. */
  readonly count: string;
}

const EXPLAINERS: Readonly<Record<string, Readonly<Record<Language, FindingExplainer>>>> = {
  'SEC-ASVS-001': {
    en: {
      what: 'These pages do not tell the browser which outside sources it may load content from.',
      why: 'That instruction is an extra safeguard: where it is set, the browser loads scripts and other content only from the places you listed.',
      fix: 'Ask your website developer to set this protection up on the server and to check that the site still works as before. The specifics are in the technical details.',
      count: 'One finding for each page where it is not set.',
    },
    uk: {
      what: 'Ці сторінки не повідомляють браузеру, з яких сторонніх джерел йому можна завантажувати вміст.',
      why: 'Це додатковий запобіжник: там, де його задано, браузер завантажує скрипти та інший вміст лише з перелічених вами місць.',
      fix: 'Попросіть розробника налаштувати цей захист на сервері та перевірити, що сайт працює як раніше. Точний перелік є в технічних деталях.',
      count: 'Одна знахідка на кожну сторінку, де його не задано.',
    },
  },
  'SEC-PASSIVE-002': {
    en: {
      what: 'Some of the extra browser protection settings are not switched on for these pages.',
      why: 'These settings help limit unwanted embedding of your pages and the passing of information to other sites.',
      fix: 'Ask your website developer to set this protection up on the server and to check that the site still works as before. The specifics are in the technical details.',
      count: 'One finding for each page that was missing something.',
    },
    uk: {
      what: 'На цих сторінках не задано частину додаткових налаштувань захисту браузера.',
      why: 'Такі налаштування допомагають обмежити небажане вбудовування сторінок і передачу інформації стороннім сайтам.',
      fix: 'Попросіть розробника налаштувати захист на сервері та перевірити, що сайт працює як раніше. Точний перелік є в технічних деталях.',
      count: 'Одна знахідка на кожну сторінку, якій чогось бракувало.',
    },
  },
  'SEC-PASSIVE-005': {
    en: {
      what: 'A cookie these pages set is missing some of the limits a browser can put on how it is used. The cookie’s value is not shown in the finding evidence.',
      why: 'Those limits make such a cookie harder to read, or to send along from another site.',
      fix: 'Ask your website developer to review this cookie and add the missing limits where it carries a sign-in or private data; leaving one off is sometimes a deliberate choice that keeps the site working. The specifics are in the technical details.',
      count:
        'One finding for each cookie on each page, so a page can appear more than once and there can be more findings than pages.',
    },
    uk: {
      what: 'Cookie, яку встановлюють ці сторінки, має не всі обмеження на її використання, які вміє браузер. Значення cookie не показується в доказах знахідки.',
      why: 'Такі обмеження ускладнюють читання цієї cookie та її надсилання з інших сайтів.',
      fix: 'Попросіть розробника переглянути цю cookie й додати відсутні обмеження там, де вона несе вхід в акаунт чи приватні дані; інколи обмеження свідомо лишають вимкненим, щоб сайт працював. Точний перелік є в технічних деталях.',
      count:
        'Одна знахідка на кожну cookie на кожній сторінці, тож сторінка може зʼявитися кілька разів, а знахідок може бути більше, ніж сторінок.',
    },
  },
};

/** The plain-language explanation of a rule, or null for a rule that has none. */
export function findingExplainer(ruleId: string, language: Language): FindingExplainer | null {
  return EXPLAINERS[ruleId]?.[language] ?? null;
}

/**
 * Whether this rule is explained in plain language — the condition for folding
 * its raw evidence and recommendation away under the technical disclosure.
 */
export function hasFindingExplainer(ruleId: string): boolean {
  return EXPLAINERS[ruleId] !== undefined;
}
