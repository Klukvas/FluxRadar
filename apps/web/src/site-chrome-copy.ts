// The handful of labels several screens share and that used to be written
// straight into the markup as `language === 'uk' ? … : …`.
//
// They are here rather than in `i18n.ts` for the reason the other small
// catalogues are: each is read as one line of chrome, and a third language
// turned every one of those ternaries into something nobody can read. A
// catalogue also puts them inside reach of `copy-parity.test.ts`, which is
// what an inline ternary escaped.
//
// The blog and the knowledge base are written in Ukrainian only. A reader whose
// interface is not Ukrainian is told so in the link itself, the same way the
// English labels already did, rather than being sent to a page in a language
// the site never offered them.

import type { Language } from './i18n';

export type SiteChromeCopy = {
  /** The `Window` chrome's close button, on every screen that is a window. */
  readonly closeWindow: string;
  /** The knowledge base, in the site footers. */
  readonly knowledgeBase: string;
  /** The knowledge base, where the footer has room for what it is for. */
  readonly knowledgeBaseReport: string;
  /** One knowledge-base article: how to read your own report. */
  readonly readYourReport: string;
  /** The coverage page's methodology section, from a footer. */
  readonly howWeAudit: string;
  /** The same section, from the coverage page's own index. */
  readonly methodAndOperator: string;
  /** The same section, where the footer has room for one word only. */
  readonly methodology: string;
  /** The session-check notice on a public page, and its retry button. */
  readonly sessionUncheckable: string;
  readonly retry: string;
  /** The whole-window state for a workspace that cannot reach the API at all. */
  readonly unavailable: {
    readonly title: string;
    readonly body: string;
    readonly retry: string;
  };
};

export const siteChromeCopy: Readonly<Record<Language, SiteChromeCopy>> = {
  en: {
    closeWindow: 'Close window',
    knowledgeBase: 'Knowledge base (Ukrainian)',
    knowledgeBaseReport: 'Knowledge base: use your report (Ukrainian)',
    readYourReport: 'Read your own report (Ukrainian)',
    howWeAudit: 'How we audit',
    methodAndOperator: 'Method and operator',
    methodology: 'Methodology',
    sessionUncheckable: 'Your session could not be checked. This public page is available.',
    retry: 'Retry',
    unavailable: {
      title: 'FluxRadar is unavailable',
      body: 'We could not check your session. Check your connection and try again.',
      retry: 'Try again',
    },
  },
  uk: {
    closeWindow: 'Закрити вікно',
    knowledgeBase: 'База знань',
    knowledgeBaseReport: 'База знань: як працювати зі звітом',
    readYourReport: 'Як читати власний звіт',
    howWeAudit: 'Як ми перевіряємо',
    methodAndOperator: 'Методика й оператор',
    methodology: 'Методика',
    sessionUncheckable: 'Не вдалося перевірити сеанс. Публічна сторінка доступна.',
    retry: 'Повторити',
    unavailable: {
      title: 'Не вдається підключитися до FluxRadar',
      body: 'Перевірте з’єднання та спробуйте ще раз. Ви не вийшли з облікового запису.',
      retry: 'Спробувати ще раз',
    },
  },
  ru: {
    closeWindow: 'Закрыть окно',
    knowledgeBase: 'База знаний (на украинском)',
    knowledgeBaseReport: 'База знаний: как работать с отчётом (на украинском)',
    readYourReport: 'Как читать свой отчёт (на украинском)',
    howWeAudit: 'Как мы проверяем',
    methodAndOperator: 'Методика и оператор',
    methodology: 'Методика',
    sessionUncheckable: 'Не удалось проверить сеанс. Публичная страница доступна.',
    retry: 'Повторить',
    unavailable: {
      title: 'Не удаётся подключиться к FluxRadar',
      body: 'Проверьте соединение и попробуйте ещё раз. Вы не вышли из аккаунта.',
      retry: 'Попробовать ещё раз',
    },
  },
};
