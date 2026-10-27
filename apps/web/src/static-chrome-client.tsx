import { useEffect, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import type { Language } from './i18n';
import { SiteFooter, SiteHeader } from './site-chrome';
import { readStaticSession } from './static-chrome-session';

export const CONTENT_LANGUAGE_EVENT = 'fluxradar:content-language';
export const CONTENT_LANGUAGE_REQUEST = 'fluxradar:content-language-request';

function readDetail(event: Event): Language | null {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  return detail === 'en' || detail === 'uk' ? detail : null;
}

function StaticChrome({ root, footer }: { readonly root: HTMLElement; readonly footer: boolean }) {
  const initialLanguage = root.dataset.language === 'uk' ? 'uk' : 'en';
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    // Hydration starts with the SSR language. The legacy content filter may have
    // already applied the query/preference before this module was downloaded.
    const current = document.documentElement.lang;
    if (current === 'en' || current === 'uk') setLanguage(current);
    const sync = (event: Event) => {
      const value = readDetail(event);
      if (value !== null) setLanguage(value);
    };
    document.addEventListener(CONTENT_LANGUAGE_EVENT, sync);
    return () => document.removeEventListener(CONTENT_LANGUAGE_EVENT, sync);
  }, []);
  useEffect(() => {
    if (footer) return undefined;
    let disposed = false;
    void readStaticSession().then((session) => {
      if (disposed) return;
      setSignedIn(session === 'signed-in');
    });
    return () => {
      disposed = true;
    };
  }, [footer, root]);
  if (footer) return <SiteFooter language={language} />;
  return (
    <SiteHeader
      variant="public"
      active={root.dataset.active ?? 'blog'}
      language={language}
      signedIn={signedIn}
      onLanguageChange={(value) => {
        document.dispatchEvent(new CustomEvent(CONTENT_LANGUAGE_REQUEST, { detail: value }));
      }}
    />
  );
}

for (const id of ['site-header-root', 'site-footer-root']) {
  const root = document.getElementById(id);
  if (root !== null)
    hydrateRoot(root, <StaticChrome root={root} footer={id === 'site-footer-root'} />);
}
