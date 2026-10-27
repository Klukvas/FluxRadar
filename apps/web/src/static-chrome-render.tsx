import { renderToString } from 'react-dom/server';
import type { Language } from './i18n';
import { SiteFooter, SiteHeader } from './site-chrome';

export type StaticChromeState = {
  readonly language: Language;
  readonly active: 'blog' | 'knowledge-base';
  readonly isIndex: boolean;
};

export function staticChromeState(html: string): StaticChromeState {
  return {
    language: /<html\b[^>]*\slang="uk"/.test(html) ? 'uk' : 'en',
    active: /data-content-section="knowledge-base"/.test(html) ? 'knowledge-base' : 'blog',
    isIndex: /data-blog-page="index"/.test(html),
  };
}

/** Only a same-origin, path-shaped script URL may be injected into the page. */
const SAFE_CLIENT_URL = /^\/[\w./-]+$/;

/** Only the two explicit slots are rendered; article HTML and SEO are opaque. */
export function renderStaticChrome(html: string, clientUrl: string): string {
  if (!SAFE_CLIENT_URL.test(clientUrl)) {
    throw new Error(`Static chrome rejects an unsafe client URL: ${clientUrl}`);
  }
  const state = staticChromeState(html);
  const header = renderToString(
    <SiteHeader
      variant="public"
      active={state.active}
      language={state.language}
      onLanguageChange={() => undefined}
      signedIn={false}
    />,
  );
  const footer = renderToString(<SiteFooter language={state.language} />);
  for (const slot of ['site-header', 'site-footer']) {
    if (html.split(`<!-- ${slot} -->`).length !== 2) {
      throw new Error(`Static chrome requires exactly one ${slot} slot`);
    }
  }
  const headerAttributes = `data-language="${state.language}" data-active="${state.active}"`;
  const footerAttributes = `data-language="${state.language}"`;
  return html
    .replace('<!-- site-header -->', `<div id="site-header-root" ${headerAttributes}>${header}</div>`)
    .replace('<!-- site-footer -->', `<div id="site-footer-root" ${footerAttributes}>${footer}</div>`)
    .replace('</head>', '<link rel="stylesheet" href="/site-chrome.css" /></head>')
    .replace('</body>', `<script type="module" src="${clientUrl}"></script></body>`);
}
