// Shared metadata for prerendered public documents and client navigation.
import { publicPagePath, type PublicPageId } from './public-page-routing';
export { PUBLIC_PAGE_PATHS, type PublicPageId } from './public-page-routing';
import { copy, type Language } from './i18n';

export const SITE_ORIGIN = 'https://fluxradar.net';

/** Everything else is behind sign-in and is deliberately not indexable. */
export type SeoPageId = PublicPageId | 'workspace';

export const OG_LOCALES: Readonly<Record<Language, string>> = { en: 'en_US', uk: 'uk_UA' };

/** Marks the tags this module owns, so a re-render replaces them instead of stacking. */
export const MANAGED_ATTRIBUTE = 'data-fluxradar-seo';

function isPublicPage(page: SeoPageId): page is PublicPageId {
  return page !== 'workspace';
}

/**
 * The absolute URL a public page has in one language.
 *
 * English uses the bare path; Ukrainian uses /uk and /uk/<page>.
 */
export function publicPageUrl(page: PublicPageId, language: Language): string {
  return `${SITE_ORIGIN}${publicPagePath(page, language)}`;
}

export interface PageMetadata {
  readonly title: string;
  readonly description: string;
  /** Absolute canonical of the page as it is currently rendered. */
  readonly canonical: string | null;
  /** `hreflang` → absolute URL, including `x-default`. */
  readonly alternates: Readonly<Record<string, string>>;
  readonly indexable: boolean;
}

export function pageMetadata(page: SeoPageId, language: Language): PageMetadata {
  const seo = copy[language].seo;
  if (!isPublicPage(page)) {
    return {
      title: seo.workspaceTitle,
      description: seo.home.description,
      canonical: null,
      alternates: {},
      indexable: false,
    };
  }
  return {
    title: seo[page].title,
    description: seo[page].description,
    canonical: publicPageUrl(page, language),
    alternates: {
      en: publicPageUrl(page, 'en'),
      uk: publicPageUrl(page, 'uk'),
      'x-default': publicPageUrl(page, 'en'),
    },
    indexable: true,
  };
}

/**
 * Structured data for a page, or null when the page has nothing to declare.
 *
 * Only what the page actually shows is described: the FAQ page publishes the
 * questions and answers a reader can see on it, and the home page publishes the
 * two reports it sells at the prices it prints. No rating, review, certification
 * or availability claim is invented.
 */
export function pageStructuredData(page: SeoPageId, language: Language): object | null {
  if (page === 'faq') return faqPageStructuredData(language);
  if (page === 'home') return homeStructuredData(language);
  return null;
}

function faqPageStructuredData(language: Language): object {
  const t = copy[language].faq;
  const questions = t.sections.flatMap((section) =>
    section.entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer.join(' ') },
    })),
  );
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${publicPageUrl('faq', language)}#faq`,
    name: t.title,
    inLanguage: language,
    url: publicPageUrl('faq', language),
    mainEntity: questions,
  };
}

function homeStructuredData(language: Language): object {
  const t = copy[language].pricing;
  const products = [t.cards.basic, t.cards.complete].map((card) => ({
    '@type': 'Service',
    name: `FluxRadar ${card.title}`,
    description: card.description,
    provider: { '@id': `${SITE_ORIGIN}/#organization` },
    serviceType: 'Public website audit',
    offers: {
      '@type': 'Offer',
      price: card.price.replace(/[^\d.]/g, ''),
      priceCurrency: 'USD',
      url: publicPageUrl('home', language),
    },
  }));
  return { '@context': 'https://schema.org', '@graph': products };
}

/** Writes the metadata of one page into `<head>`, replacing whatever was there. */
export function applyPageMetadata(page: SeoPageId, language: Language): void {
  const meta = pageMetadata(page, language);

  document.title = meta.title;
  upsertMeta('name', 'description', meta.description);
  upsertMeta('property', 'og:title', meta.title);
  upsertMeta('property', 'og:description', meta.description);
  upsertMeta('property', 'og:locale', OG_LOCALES[language]);
  upsertMeta('name', 'twitter:title', meta.title);
  upsertMeta('name', 'twitter:description', meta.description);

  if (meta.canonical === null) {
    removeCanonical();
    upsertMeta('name', 'robots', 'noindex, nofollow');
  } else {
    upsertCanonical(meta.canonical);
    upsertMeta('property', 'og:url', meta.canonical);
    removeManaged('meta[name="robots"]');
  }

  removeManaged('link[rel="alternate"]');
  for (const [hreflang, href] of Object.entries(meta.alternates)) {
    const link = document.createElement('link');
    link.setAttribute('rel', 'alternate');
    link.setAttribute('hreflang', hreflang);
    link.setAttribute('href', href);
    link.setAttribute(MANAGED_ATTRIBUTE, 'alternate');
    document.head.append(link);
  }

  removeManaged('script[type="application/ld+json"]');
  const structuredData = pageStructuredData(page, language);
  if (structuredData !== null) {
    const script = document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.setAttribute(MANAGED_ATTRIBUTE, 'structured-data');
    script.textContent = JSON.stringify(structuredData);
    document.head.append(script);
  }
}

function upsertMeta(keyAttribute: 'name' | 'property', key: string, value: string): void {
  const selector = `meta[${keyAttribute}="${key}"]`;
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  const element = existing ?? document.createElement('meta');
  element.setAttribute(keyAttribute, key);
  element.setAttribute('content', value);
  element.setAttribute(MANAGED_ATTRIBUTE, key);
  if (existing === null) document.head.append(element);
}

function upsertCanonical(href: string): void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const element = existing ?? document.createElement('link');
  element.setAttribute('rel', 'canonical');
  element.setAttribute('href', href);
  element.setAttribute(MANAGED_ATTRIBUTE, 'canonical');
  if (existing === null) document.head.append(element);
}

function removeCanonical(): void {
  document.head.querySelector('link[rel="canonical"]')?.remove();
}

/**
 * Removes only the marked tags: the ones this module added and the ones the
 * build wrote into a page's static head, never the unmarked site-wide ones
 * shipped in `index.html`.
 */
function removeManaged(selector: string): void {
  for (const element of document.head.querySelectorAll(`${selector}[${MANAGED_ATTRIBUTE}]`)) {
    element.remove();
  }
}
