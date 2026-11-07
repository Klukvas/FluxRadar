import { renderToString } from 'react-dom/server';

import { App } from './App';
import { initialPublicRoute } from './app-routes';
import type { Language } from './i18n';
import {
  PUBLIC_LOCALES,
  PUBLIC_PAGE_PATHS,
  publicPagePath,
  type PublicPageRoute,
  type PublicPageId,
} from './public-page-routing';
import { renderStaticPageHead } from './static-page-heads';

/**
 * What a reader with JavaScript turned off is told, and the navigation they get.
 *
 * The blog and the knowledge base are written in Ukrainian only, so the
 * Russian document links a Russian reader at the Ukrainian originals and says
 * which language they are in, the same way the English one does.
 */
const NO_SCRIPT_COPY: Readonly<
  Record<
    Language,
    {
      readonly notice: string;
      readonly navigation: string;
      readonly pages: Readonly<Record<'home' | 'checks' | 'exampleReport' | 'faq' | 'bot', string>>;
      readonly knowledgeBase: string;
    }
  >
> = {
  en: {
    notice:
      'JavaScript is required to sign in and start an audit. Public information remains readable below.',
    navigation: 'Site navigation',
    pages: {
      home: 'Home',
      checks: 'Audit coverage',
      exampleReport: 'Example report',
      faq: 'FAQ',
      bot: 'Crawler policy',
    },
    knowledgeBase: 'Knowledge base (Ukrainian)',
  },
  uk: {
    notice: 'Для входу й запуску перевірки потрібен JavaScript. Публічні матеріали доступні нижче.',
    navigation: 'Навігація сайтом',
    pages: {
      home: 'Головна',
      checks: 'Перелік перевірок',
      exampleReport: 'Приклад звіту',
      faq: 'Питання й відповіді',
      bot: 'Політика краулера',
    },
    knowledgeBase: 'База знань',
  },
  ru: {
    notice:
      'Для входа и запуска проверки нужен JavaScript. Публичные материалы читаются и без него.',
    navigation: 'Навигация по сайту',
    pages: {
      home: 'Главная',
      checks: 'Перечень проверок',
      exampleReport: 'Пример отчёта',
      faq: 'Вопросы и ответы',
      bot: 'Политика краулера',
    },
    knowledgeBase: 'База знаний (на украинском)',
  },
};

function noScriptNavigation(language: Language): string {
  const text = NO_SCRIPT_COPY[language];
  const links = (['home', 'checks', 'exampleReport', 'faq', 'bot'] as const)
    .map((id) => `<a href="${publicPagePath(id, language)}">${text.pages[id]}</a>`)
    .join('');
  return `<noscript><p>${text.notice}</p><nav class="public-noscript-nav" aria-label="${text.navigation}">${links}<a href="/knowledge-base">${text.knowledgeBase}</a></nav></noscript>`;
}

export function staticPublicFiles(
  template: string,
): readonly { readonly fileName: string; readonly html: string }[] {
  return (Object.keys(PUBLIC_PAGE_PATHS) as PublicPageId[]).flatMap((page) =>
    PUBLIC_LOCALES.map((language) => {
      const route: PublicPageRoute = { page, language };
      const path = publicPagePath(page, language);
      const content = renderToString(
        <App initialRoute={initialPublicRoute(route)} initialLanguage={language} />,
      );
      const noScript = noScriptNavigation(language);
      const head = renderStaticPageHead(template, page, language);
      if (!head.includes('<div id="root"></div>'))
        throw new Error('Public prerender requires exactly one empty root');
      return {
        fileName: path === '/' ? 'index.html' : `${path.slice(1)}/index.html`,
        html: head.replace(
          '<div id="root"></div>',
          `<div id="root" data-public-snapshot="${page}:${language}">${content}</div>${noScript}`,
        ),
      };
    }),
  );
}
