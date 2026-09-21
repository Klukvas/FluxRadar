// Copy for the AI Action Plan: the block on a Complete report, the locked block
// on a Basic one, and the plan's section of the printable client report.
//
// Beside `findings-copy.ts` rather than inside it, as that file is: the plan is
// read together with the findings but has a vocabulary of its own — an Action
// is "settled", never "fixed", because within one scan its count only moves
// when the owner ignores issues or marks them false positives (D-232).

import type { Language } from './i18n';
import type { PlanEffort } from './action-plan';

export type ActionPlanCopy = {
  readonly heading: string;
  readonly aiLabel: string;
  readonly lead: string;
  readonly languageLabel: string;
  readonly generate: string;
  readonly regenerate: (left: number) => string;
  readonly retry: (left: number) => string;
  readonly working: string;
  /** The consent line under Generate and Regenerate: the click is the consent. */
  readonly consent: string;
  readonly running: (language: string) => string;
  readonly failed: string;
  readonly nothingToPlan: string;
  readonly windowClosed: (date: string) => string;
  readonly windowClosedUndated: string;
  readonly limitReached: string;
  readonly otherLanguage: (language: string) => string;
  readonly openOtherLanguage: (language: string) => string;
  readonly generatedAt: (date: string) => string;
  readonly overviewHeading: string;
  readonly actionsHeading: string;
  readonly effort: Readonly<Record<PlanEffort, string>>;
  readonly counts: (open: number, total: number) => string;
  readonly ruleLink: (open: number, total: number) => string;
  readonly settled: string;
  readonly settledNote: string;
  readonly reach: (percent: number, rules: number) => string;
  readonly reachAllSettled: (rules: number) => string;
  readonly caveat: (section: string, status: string) => string;
  readonly errors: {
    readonly busy: string;
    readonly inProgress: string;
    readonly limit: string;
    readonly outdated: string;
    readonly rateLimited: string;
    readonly generic: string;
  };
  readonly locked: {
    readonly heading: string;
    readonly body: string;
    readonly action: string;
  };
  readonly print: {
    readonly heading: string;
    readonly lead: string;
  };
};

export const actionPlanCopy: Record<Language, ActionPlanCopy> = {
  en: {
    heading: 'Action Plan',
    aiLabel: 'AI-generated',
    lead: 'Claude reads this report and writes a short, ordered list of changes for whoever fixes the site, under an overview in plain words you can forward to a client.',
    languageLabel: 'Plan language',
    generate: 'Write the Action Plan',
    regenerate: (left) => `Regenerate (${left} left)`,
    retry: (left) => `Try again (${left} left)`,
    working: 'Starting…',
    consent: 'Rule names, counts and page addresses from this report are sent to Anthropic.',
    running: (language) =>
      `Writing the plan in ${language}… This usually takes a minute or two. You can leave this page and come back.`,
    failed: 'The last attempt did not produce a plan.',
    nothingToPlan: 'Nothing in this report is left open to plan.',
    windowClosed: (date) =>
      `A plan can be written within 3 days after a scan finishes; for this report that ended on ${date}.`,
    windowClosedUndated: 'A plan can no longer be written for this report.',
    limitReached: 'This report has used all of its Action Plans.',
    otherLanguage: (language) => `There is a plan for this report in ${language}.`,
    openOtherLanguage: (language) => `Open the plan in ${language}`,
    generatedAt: (date) => `Written ${date}`,
    overviewHeading: 'Overview',
    actionsHeading: 'Actions',
    effort: { small: 'Under an hour', medium: 'Up to a day', large: 'More than a day' },
    counts: (open, total) => (open === total ? `${total} open` : `${open} open of ${total}`),
    ruleLink: (open, total) =>
      `→ ${open === total ? total : `${open} of ${total}`} ${total === 1 ? 'issue' : 'issues'}`,
    settled: 'Settled',
    settledNote:
      'No issue of this Action is open any more: each was ignored, marked a false positive or resolved.',
    reach: (percent, rules) =>
      `The plan addresses ${percent}% of this report’s open issues, across ${rules} ${rules === 1 ? 'rule' : 'rules'}.`,
    reachAllSettled: (rules) =>
      `Every issue the plan’s ${rules} ${rules === 1 ? 'rule' : 'rules'} found is settled.`,
    caveat: (section, status) =>
      status === 'Partial'
        ? `${section} was only partly checked — the plan may be incomplete.`
        : `${section} could not be checked — the plan may be incomplete.`,
    errors: {
      busy: 'AI is temporarily unavailable. Try again later.',
      inProgress: 'A plan for this report is already being written.',
      limit: 'This report has used all of its Action Plans.',
      outdated: 'This page is out of date. Reload it and try again.',
      rateLimited: 'Too many plans were started in the last hour. Try again later.',
      generic: 'The plan could not be started. Try again.',
    },
    locked: {
      heading: 'AI Action Plan',
      body: 'In a Complete scan of this site, Claude turns the findings into a short, ordered list of changes, with an overview in plain words for your client.',
      action: 'Run Complete for this site',
    },
    print: {
      heading: 'Action Plan',
      lead: 'Written by AI (Claude) from this report’s findings. The counts beside each Action are the report’s at the time of printing.',
    },
  },
  uk: {
    heading: 'План дій',
    aiLabel: 'Створено ШІ',
    lead: 'Claude читає цей звіт і пише короткий упорядкований список змін для того, хто виправлятиме сайт, з оглядом простими словами, який можна переслати клієнту.',
    languageLabel: 'Мова плану',
    generate: 'Скласти план дій',
    regenerate: (left) => `Скласти заново (лишилося ${left})`,
    retry: (left) => `Спробувати ще раз (лишилося ${left})`,
    working: 'Запускаємо…',
    consent: 'Назви правил, кількості та адреси сторінок із цього звіту надсилаються Anthropic.',
    running: (language) =>
      `Складаємо план мовою «${language}»… Зазвичай це хвилина-дві. Можна піти з цієї сторінки й повернутися.`,
    failed: 'Остання спроба не дала плану.',
    nothingToPlan: 'У цьому звіті не лишилося відкритих проблем, які можна спланувати.',
    windowClosed: (date) =>
      `План можна скласти впродовж 3 днів після завершення перевірки; для цього звіту цей строк сплив ${date}.`,
    windowClosedUndated: 'Для цього звіту план уже не можна скласти.',
    limitReached: 'Цей звіт використав усі свої плани дій.',
    otherLanguage: (language) => `Для цього звіту є план мовою «${language}».`,
    openOtherLanguage: (language) => `Відкрити план мовою «${language}»`,
    generatedAt: (date) => `Складено ${date}`,
    overviewHeading: 'Огляд',
    actionsHeading: 'Дії',
    effort: { small: 'До години', medium: 'До дня', large: 'Понад день' },
    counts: (open, total) => (open === total ? `${total} відкрито` : `${open} відкрито з ${total}`),
    ruleLink: (open, total) =>
      `→ ${open === total ? `знахідок: ${total}` : `відкрито ${open} з ${total} знахідок`}`,
    settled: 'Закрито',
    settledNote:
      'Жодна знахідка цієї дії більше не відкрита: кожну проігноровано, позначено хибною або виправлено.',
    reach: (percent, rules) =>
      `План охоплює ${percent}% відкритих проблем цього звіту (правил: ${rules}).`,
    reachAllSettled: (rules) => `Усі знахідки правил цього плану (${rules}) закрито.`,
    caveat: (section, status) =>
      status === 'Partial'
        ? `Розділ «${section}» перевірено лише частково — план може бути неповним.`
        : `Розділ «${section}» не вдалося перевірити — план може бути неповним.`,
    errors: {
      busy: 'ШІ тимчасово недоступний. Спробуйте пізніше.',
      inProgress: 'План для цього звіту вже складається.',
      limit: 'Цей звіт використав усі свої плани дій.',
      outdated: 'Сторінка застаріла. Оновіть її та спробуйте ще раз.',
      rateLimited: 'За останню годину запущено забагато планів. Спробуйте пізніше.',
      generic: 'Не вдалося запустити складання плану. Спробуйте ще раз.',
    },
    locked: {
      heading: 'План дій від ШІ',
      body: 'У перевірці Complete для цього сайту Claude перетворює знахідки на короткий упорядкований список змін з оглядом простими словами для вашого клієнта.',
      action: 'Запустити Complete для цього сайту',
    },
    print: {
      heading: 'План дій',
      lead: 'Складено ШІ (Claude) за знахідками цього звіту. Кількості біля кожної дії — такі, як у звіті на момент друку.',
    },
  },
};
