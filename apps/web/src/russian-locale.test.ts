// The Russian locale, end to end at the seams a reader actually meets.
//
// Russian was added as an interface language only: the audit report, the PDF
// and every email stay Ukrainian (`report-language.ts`). That split is what
// this file pins, in four parts — the URLs, the grammar, the copy, and the
// boundary where a request leaves for the API.

import { describe, expect, it } from 'vitest';

import { actionPlanCopy } from './action-plan-copy';
import { copy, isLanguage, languageOptions, readLanguageParam, type Language } from './i18n';
import { ruCountForm, ruPagesAccusative, ruPagesOf, takesRuSingular } from './i18n.ru';
import {
  PUBLIC_LOCALES,
  PUBLIC_PAGE_PATHS,
  legacyPublicRedirect,
  matchingPublicSnapshot,
  publicPagePath,
  publicPageRoute,
  type PublicPageId,
} from './public-page-routing';
import { reportLanguage, ukrainianReportCopy } from './report-language';
import { OG_LOCALES, pageMetadata, pageStructuredData, publicPageUrl } from './seo';

describe('the Russian locale has its own public addresses', () => {
  it('is offered in the switcher under its own name', () => {
    expect(languageOptions.map((option) => option.value)).toEqual(['en', 'uk', 'ru']);
    expect(languageOptions.find((option) => option.value === 'ru')?.label).toBe('Русский');
    expect(PUBLIC_LOCALES).toContain('ru');
    expect(isLanguage('ru')).toBe(true);
    expect(isLanguage('be')).toBe(false);
  });

  it('prefixes every public page with /ru', () => {
    const paths = (Object.keys(PUBLIC_PAGE_PATHS) as PublicPageId[]).map((page) =>
      publicPagePath(page, 'ru'),
    );
    expect(paths).toEqual([
      '/ru',
      '/ru/faq',
      '/ru/checks',
      '/ru/bot',
      '/ru/example-report',
      '/ru/privacy',
      '/ru/terms',
      '/ru/cookies',
    ]);
  });

  it.each([
    ['/ru', 'home'],
    ['/ru/', 'home'],
    ['/ru/faq', 'faq'],
    ['/ru/faq/', 'faq'],
    ['/ru/checks', 'checks'],
    ['/ru/example-report', 'exampleReport'],
    ['/ru/privacy', 'privacy'],
    ['/ru/terms', 'terms'],
    ['/ru/cookies', 'cookies'],
    ['/ru/bot', 'bot'],
  ])('reads %s back as the Russian %s page', (path, page) => {
    expect(publicPageRoute(path)).toEqual({ page, language: 'ru' });
  });

  // The same normalization the Ukrainian paths get, so nginx and the client
  // agree on what a Russian URL is.
  it.each(['/ru//checks', '/ru/./checks', '/ru/other/../checks', '/%72u/checks'])(
    'normalizes %s to the Russian coverage page',
    (path) => {
      expect(publicPageRoute(path)).toEqual({ page: 'checks', language: 'ru' });
      expect(matchingPublicSnapshot('checks:ru', path, '')?.language).toBe('ru');
    },
  );

  it('rejects a path that only looks Russian', () => {
    expect(publicPageRoute('/rules')).toBeNull();
    expect(publicPageRoute('/ru/profiles')).toBeNull();
    expect(publicPageRoute('/blog/ru')).toBeNull();
  });

  it('refuses a snapshot marker from another locale', () => {
    expect(matchingPublicSnapshot('checks:uk', '/ru/checks', '')).toBeNull();
    expect(matchingPublicSnapshot('checks:ru', '/uk/checks', '')).toBeNull();
  });

  // `?lang=ru` is not an address this locale has: a Russian reader arrives on
  // `/ru`, and nothing on the site or in an ad writes the query form. The
  // redirect therefore carries the one alias that was published, `?lang=uk`,
  // and an invented `?lang=ru` on a bare path stays on the English document —
  // the same answer in the dev server and in production.
  it('gives a Russian query alias no public address of its own', () => {
    expect(legacyPublicRedirect('/checks?lang=ru')).toBeNull();
    expect(legacyPublicRedirect('/?lang=ru&utm_source=instagram')).toBeNull();
    // And the alias that was published still migrates, from the same code.
    expect(legacyPublicRedirect('/checks?lang=uk')).toBe('/uk/checks');
  });

  it('reads ?lang=ru as a language on a workspace address', () => {
    expect(readLanguageParam('?lang=ru')).toBe('ru');
    expect(readLanguageParam('?lang=ru&lang=en')).toBeNull();
    expect(readLanguageParam('?lang=rus')).toBeNull();
  });
});

describe('Russian numerals agree with the nouns after them', () => {
  // The three forms and the 11–14 exception, at the counts a report prints.
  it.each([
    [1, 'страницу'],
    [2, 'страницы'],
    [4, 'страницы'],
    [5, 'страниц'],
    [11, 'страниц'],
    [12, 'страниц'],
    [14, 'страниц'],
    [21, 'страницу'],
    [22, 'страницы'],
    [25, 'страниц'],
    [101, 'страницу'],
    [111, 'страниц'],
  ])('writes %i as %s in the accusative', (count, form) => {
    expect(ruPagesAccusative(count)).toBe(form);
  });

  it.each([
    [1, 'страницы'],
    [2, 'страниц'],
    [5, 'страниц'],
    [11, 'страниц'],
    [21, 'страницы'],
  ])('writes %i as %s in the genitive', (count, form) => {
    expect(ruPagesOf(count)).toBe(form);
  });

  it.each([
    [1, true],
    [2, false],
    [11, false],
    [21, true],
    [111, false],
  ])('knows whether %i takes the singular', (count, singular) => {
    expect(takesRuSingular(count)).toBe(singular);
  });

  // A sentence that counts rules, which the Russian branch wrote as «по 1
  // правилам» for every count ending in 1 but 11.
  it.each([
    [1, 'по 1 правилу'],
    [2, 'по 2 правилам'],
    [5, 'по 5 правилам'],
    [11, 'по 11 правилам'],
    [21, 'по 21 правилу'],
    [111, 'по 111 правилам'],
  ])('writes the Action Plan reach over %i rules as «%s»', (rules, phrase) => {
    expect(actionPlanCopy.ru.reach(0.75, rules)).toContain(phrase);
  });

  it('selects one of three forms for any count', () => {
    for (let count = 0; count <= 200; count += 1) {
      expect(['проверка', 'проверки', 'проверок']).toContain(
        ruCountForm(count, 'проверка', 'проверки', 'проверок'),
      );
    }
    expect(ruCountForm(0, 'проверка', 'проверки', 'проверок')).toBe('проверок');
  });
});

describe('the report document stays Ukrainian for a Russian reader', () => {
  it('maps the Russian interface onto the Ukrainian report', () => {
    expect(reportLanguage('ru')).toBe('uk');
    expect(reportLanguage('uk')).toBe('uk');
    expect(reportLanguage('en')).toBe('en');
  });

  it('gives a two-language catalogue its Russian entry without translating it', () => {
    const catalogue = ukrainianReportCopy({ en: 'Pages', uk: 'Сторінки' });
    expect(catalogue.ru).toBe(catalogue.uk);
    expect(catalogue.ru).not.toBe(catalogue.en);
  });

  // The rule catalogues are the report's own vocabulary and stand beside
  // sentences the API writes in Ukrainian, so they are taken from the Ukrainian
  // branch by reference rather than translated: a reader never gets one rule
  // named twice in two languages.
  it('reads the rule catalogues from the Ukrainian branch', () => {
    expect(copy.ru.report.checks.titles).toBe(copy.uk.report.checks.titles);
    expect(copy.ru.report.checks.notApplicableReasons).toBe(
      copy.uk.report.checks.notApplicableReasons,
    );
  });

  // And the chrome around them is Russian: the owner's decision is that a
  // Russian reader reads a Russian app, including the two screens that frame
  // the report. `russian-copy-parity.test.ts` walks every string of both.
  it('frames that report in Russian chrome', () => {
    expect(copy.ru.report.windowTitle).toBe('Панель отчёта');
    expect(copy.ru.report.retry).toBe('Попробовать ещё раз');
    expect(copy.ru.report.openIssues).toBe('Открыть Центр проблем');
    expect(copy.ru.report.comparison.heading).toBe('Сравнение с предыдущей проверкой');
    expect(copy.ru.issues.windowTitle).toBe('Центр проблем');
    expect(copy.ru.issues.clearFilters).toBe('Сбросить фильтры');
    expect(copy.ru.report).not.toBe(copy.uk.report);
    expect(copy.ru.issues).not.toBe(copy.uk.issues);
  });

  it('still renders every other section in Russian', () => {
    expect(copy.ru.nav.home).toBe('Главная');
    expect(copy.ru.home.hero.submit).toBe('Проверьте свой сайт');
    expect(copy.ru.nav).not.toBe(copy.uk.nav);
  });
});

describe('the Russian pages declare themselves to a crawler', () => {
  it('canonicalizes a Russian page at its own URL', () => {
    expect(pageMetadata('faq', 'ru').canonical).toBe('https://fluxradar.net/ru/faq');
    expect(publicPageUrl('home', 'ru')).toBe('https://fluxradar.net/ru');
  });

  it('declares ru_RU as the Open Graph locale', () => {
    expect(OG_LOCALES.ru).toBe('ru_RU');
  });

  it('lists ru beside en, uk and x-default on every page', () => {
    for (const page of Object.keys(PUBLIC_PAGE_PATHS) as PublicPageId[]) {
      expect(pageMetadata(page, 'ru').alternates).toEqual({
        en: publicPageUrl(page, 'en'),
        uk: publicPageUrl(page, 'uk'),
        ru: publicPageUrl(page, 'ru'),
        'x-default': publicPageUrl(page, 'en'),
      });
      expect(pageMetadata(page, 'ru').indexable).toBe(true);
    }
  });

  it('declares the Russian FAQ as Russian structured data', () => {
    const data = pageStructuredData('faq', 'ru') as {
      inLanguage: string;
      url: string;
      mainEntity: { name: string }[];
    };
    expect(data.inLanguage).toBe('ru');
    expect(data.url).toBe('https://fluxradar.net/ru/faq');
    expect(data.mainEntity).toHaveLength(
      copy.ru.faq.sections.flatMap((section) => section.entries).length,
    );
    expect(data.mainEntity[0]?.name).toBe(copy.ru.faq.sections[0]?.entries[0]?.question);
  });

  it('keeps the signed-in workspace out of the index in Russian too', () => {
    const workspace = pageMetadata('workspace', 'ru');
    expect(workspace.indexable).toBe(false);
    expect(workspace.canonical).toBeNull();
  });
});

describe('every interface language reaches the same pages', () => {
  it.each(PUBLIC_LOCALES as readonly Language[])('routes every public page in %s', (language) => {
    for (const page of Object.keys(PUBLIC_PAGE_PATHS) as PublicPageId[]) {
      const path = publicPagePath(page, language);
      expect(publicPageRoute(path)).toEqual({ page, language });
    }
  });
});
