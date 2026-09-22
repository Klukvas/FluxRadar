import { useEffect } from 'react';

import { trackPageView } from './analytics';
import { seoPageForScreen, type Screen } from './app-routes';
import type { Language } from './i18n';
import { applyPageMetadata } from './seo';

/**
 * What the document says about the screen it shows: its language, its search
 * metadata and a page view.
 */
export function usePageMetadata(
  screen: Screen,
  language: Language,
  selectedScanId: string | null,
): void {
  // The document language is what a screen reader announces the page in and what
  // a browser offers to translate; leaving it on the served default silently
  // mislabels every Ukrainian session.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // Title, description, canonical, social cards and `hreflang` alternates are
  // per screen and per language: `index.html` is served for every route, so a
  // page that does not state its own metadata silently claims to be the home
  // page — including its canonical, which would keep it out of the index.
  useEffect(() => {
    applyPageMetadata(seoPageForScreen(screen), language);
  }, [screen, language]);

  // One page view per screen the visitor lands on, sent after the metadata above
  // so it carries this screen's title. Until the visitor allows analytics the
  // call does nothing at all.
  useEffect(() => {
    trackPageView();
  }, [screen, selectedScanId]);
}
