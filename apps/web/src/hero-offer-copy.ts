// Copy for the slider beside the home page's form: what a report holds, one
// topic per slide.
//
// Kept beside `i18n.ts` rather than inside it, the way `action-plan-copy.ts`
// is: that file is past the size anyone can review, and this block is read as
// one window. The numbers are not written here. Every count is a function
// argument filled from the source list it counts (`hero-offer-content.ts`), and
// the salon's own data — the question, the answers, the security rows — is in
// `example-offer-fixture.ts`, so the copy only carries the words around them.
//
// Written for a shop owner: no standard, header or record name on a slide.
// `hero-offer.test.tsx` refuses them.

import { russianHeroOfferCopy } from './hero-offer-copy.ru';
import type { Language } from './i18n';
import { ukCountForm } from './i18n';

/** The five topics, in the order the tabs list them. */
export const OFFER_SLIDE_IDS = ['report', 'ai', 'security', 'plan', 'developer'] as const;
export type OfferSlideId = (typeof OFFER_SLIDE_IDS)[number];

export interface HeroOfferCopy {
  readonly windowTitle: string;
  readonly tablistLabel: string;
  /** What a screen reader calls the whole window instead of "region". */
  readonly roleDescription: string;
  readonly tabs: Readonly<Record<OfferSlideId, string>>;
  readonly previous: string;
  readonly next: string;
  readonly position: (current: number, total: number) => string;
  readonly stop: string;
  readonly resume: string;
  /** "Basic and Complete": the last two names of a list, joined. */
  readonly joinNames: (first: string, last: string) => string;
  /** The caption a paid slide ends on, naming the plans that include it. */
  readonly inPlans: (plans: string) => string;
  readonly report: {
    /**
     * What the plans include, said as the plans' offer: the full example's
     * own SEO section shows fewer checks for the salon, because not every
     * check applies to every site.
     */
    readonly includes: (checks: number, plans: string, planCount: number) => string;
  };
  readonly ai: {
    readonly title: string;
    readonly lead: string;
    readonly questionLabel: string;
    readonly mentioned: string;
    readonly cited: (page: string) => string;
    readonly optInChip: string;
    readonly optInDetail: string;
    readonly includes: (asked: number, optional: number) => string;
  };
  readonly security: {
    readonly title: string;
    readonly lead: string;
    readonly passed: string;
    /** What each check the example shows found, in an owner's words, keyed by rule id. */
    readonly rows: Readonly<Record<string, string>>;
    readonly includes: (checks: number) => string;
  };
  readonly plan: {
    readonly title: string;
    readonly lead: string;
    readonly includes: string;
  };
  readonly developer: {
    readonly title: string;
    readonly lead: string;
    readonly includes: string;
    /**
     * Said when the browser refuses the clipboard. The whole message then
     * takes the extract's place above the button, so it points up.
     */
    readonly copyFailed: string;
  };
}

const EN: HeroOfferCopy = {
  windowTitle: 'What you get',
  tablistLabel: 'What the report includes',
  roleDescription: 'carousel',
  tabs: {
    report: 'Report',
    ai: 'AI assistants',
    security: 'Security',
    plan: 'Action plan',
    developer: 'For your developer',
  },
  previous: 'Previous slide',
  next: 'Next slide',
  position: (current, total) => `${current} of ${total}`,
  stop: 'Stop',
  resume: 'Play automatically',
  joinNames: (first, last) => `${first} and ${last}`,
  inPlans: (plans) => `In ${plans}.`,
  report: {
    includes: (checks, plans, planCount) =>
      `${plans} ${planCount === 1 ? 'includes' : 'include'} ${checks} checks for Google search across the whole site.`,
  },
  ai: {
    title: 'Do AI assistants know about you?',
    lead: 'We ask them what a customer would ask and show whether their answer names you and links to your site.',
    questionLabel: 'Question:',
    mentioned: 'NAMED YOU',
    cited: (page) => `Linked to ${page}`,
    optInChip: 'IF YOU CHOOSE',
    optInDetail: 'We ask them only if you tick them before paying.',
    includes: (asked, optional) => `${asked} AI assistants, plus ${optional} more if you choose.`,
  },
  security: {
    title: 'Is your site safe for customers?',
    lead: 'What the report checked on the salon’s site. We only look at what anyone can see from outside: nothing is broken into, and no passwords are needed.',
    passed: 'IN ORDER',
    rows: {
      'SEC-PASSIVE-001':
        'The secure-connection certificate is valid, so browsers show visitors no warning.',
      'SEC-PASSIVE-003': 'Browsers are told to always use the secure address (https).',
      'SEC-PASSIVE-007':
        'The salon’s email is protected against forgery, so a stranger cannot easily send emails in its name.',
    },
    includes: (checks) => `${checks} security checks of what is visible from outside.`,
  },
  plan: {
    title: 'Where to start? An action plan from AI',
    lead: 'When you ask, AI (Claude) turns the report’s findings into a short list: what to fix first, step by step.',
    includes: 'An AI action plan.',
  },
  developer: {
    title: 'Not into websites? You don’t need to be',
    lead: 'Every problem is explained in plain words, with a ready message you can forward to your developer.',
    includes: 'Why it matters and what to do is written next to every problem.',
    copyFailed:
      'The task could not be copied automatically. Select the message above and copy it yourself.',
  },
};

const UK: HeroOfferCopy = {
  windowTitle: 'Що ви отримаєте',
  tablistLabel: 'Що є у звіті',
  roleDescription: 'карусель',
  tabs: {
    report: 'Звіт',
    ai: 'ШІ-помічники',
    security: 'Безпека',
    plan: 'План дій',
    developer: 'Розробнику',
  },
  previous: 'Попередній слайд',
  next: 'Наступний слайд',
  position: (current, total) => `${current} з ${total}`,
  stop: 'Зупинити',
  resume: 'Гортати автоматично',
  joinNames: (first, last) => `${first} і ${last}`,
  inPlans: (plans) => `У ${plans}.`,
  report: {
    includes: (checks, plans, planCount) =>
      `${plans} ${planCount === 1 ? 'містить' : 'містять'} ${checks} ${ukCountForm(checks, 'перевірку', 'перевірки', 'перевірок')} для пошуку Google на всьому сайті.`,
  },
  ai: {
    title: 'Чи знають про вас ШІ-помічники?',
    lead: 'Ставимо їм питання, яке поставив би клієнт, і показуємо, чи назвали вони вас у відповіді та чи послалися на ваш сайт.',
    questionLabel: 'Питання:',
    mentioned: 'НАЗВАВ ВАС',
    cited: (page) => `Послався на сторінку ${page}`,
    optInChip: 'ЗА ВАШИМ ВИБОРОМ',
    optInDetail: 'Запитуємо їх, лише якщо ви самі позначите їх перед оплатою.',
    includes: (asked, optional) =>
      `${asked} ${ukCountForm(asked, 'ШІ-помічник', 'ШІ-помічники', 'ШІ-помічників')} і ще ${optional} за вашим вибором.`,
  },
  security: {
    title: 'Чи безпечно клієнту на вашому сайті?',
    lead: 'Що звіт перевірив на сайті салону. Дивимося лише на те, що видно ззовні: нічого не зламуємо й паролів не просимо.',
    passed: 'УСЕ ГАРАЗД',
    rows: {
      'SEC-PASSIVE-001':
        'Сертифікат захищеного зʼєднання чинний, тож браузер не лякає відвідувачів попередженням.',
      'SEC-PASSIVE-003': 'Браузерам сказано завжди відкривати сайт за захищеною адресою (https).',
      'SEC-PASSIVE-007':
        'Пошта салону захищена від підробки, тож чужа людина не зможе просто так надіслати листа від його імені.',
    },
    includes: (checks) =>
      `${checks} ${ukCountForm(checks, 'перевірка', 'перевірки', 'перевірок')} безпеки того, що видно ззовні.`,
  },
  plan: {
    title: 'З чого почати? План дій від ШІ',
    lead: 'На ваше прохання ШІ (Claude) збирає знахідки звіту в короткий список: що виправити першим, крок за кроком.',
    includes: 'План дій від ШІ.',
  },
  developer: {
    title: 'Не розбираєтеся в сайтах? І не треба',
    lead: 'Кожну проблему пояснюємо простими словами й даємо готове повідомлення, яке можна переслати розробнику.',
    includes: 'Чому це важливо і що зробити, написано біля кожної проблеми.',
    copyFailed:
      'Не вдалося скопіювати завдання автоматично. Виділіть повідомлення вище й скопіюйте його самі.',
  },
};

export const heroOfferCopy: Readonly<Record<Language, HeroOfferCopy>> = {
  en: EN,
  uk: UK,
  ru: russianHeroOfferCopy,
};
