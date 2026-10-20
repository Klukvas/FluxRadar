import { renderToString } from 'react-dom/server';

import { App } from './App';
import { initialPublicRoute } from './app-routes';
import {
  PUBLIC_PAGE_PATHS,
  publicPagePath,
  type PublicPageRoute,
  type PublicPageId,
} from './public-page-routing';
import { renderStaticPageHead } from './static-page-heads';

export function staticPublicFiles(
  template: string,
): readonly { readonly fileName: string; readonly html: string }[] {
  return (Object.keys(PUBLIC_PAGE_PATHS) as PublicPageId[]).flatMap((page) =>
    (['en', 'uk'] as const).map((language) => {
      const route: PublicPageRoute = { page, language };
      const path = publicPagePath(page, language);
      const content = renderToString(
        <App initialRoute={initialPublicRoute(route)} initialLanguage={language} />,
      );
      const noScript = `<noscript><p>${language === 'uk' ? 'Для входу й запуску перевірки потрібен JavaScript. Публічні матеріали доступні нижче.' : 'JavaScript is required to sign in and start an audit. Public information remains readable below.'}</p><nav class="public-noscript-nav" aria-label="${language === 'uk' ? 'Навігація сайтом' : 'Site navigation'}">${(['home', 'checks', 'exampleReport', 'faq', 'bot'] as const).map((id) => `<a href="${publicPagePath(id, language)}">${{ en: { home: 'Home', checks: 'Audit coverage', exampleReport: 'Example report', faq: 'FAQ', bot: 'Crawler policy' }, uk: { home: 'Головна', checks: 'Перелік перевірок', exampleReport: 'Приклад звіту', faq: 'Питання й відповіді', bot: 'Політика краулера' } }[language][id]}</a>`).join('')}<a href="/knowledge-base">${language === 'uk' ? 'База знань' : 'Knowledge base (Ukrainian)'}</a></nav></noscript>`;
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
