// Дубль title, объяснённый языковыми версиями (language-alternates.ts).
// Положительные случаи — что сайт объявил и правило приняло; отрицательные —
// ровно то, что заявлением не является и находку не снимает.

import { describe, expect, it } from 'vitest';

import { siteContext, type FixturePageInput } from '../testing/fixture-harness.js';
import { runSeoRule } from '../testing/fixture-harness.js';
import { paths } from '../testing/link-fixtures.js';

interface Alternate {
  readonly hreflang: string;
  readonly href: string;
}

/**
 * Страница вакансии: английское название должности в title, локализованный
 * текст, canonical на себя и объявленные языковые версии.
 */
function jobPage(options: {
  readonly path: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string;
  readonly alternates?: readonly Alternate[];
  readonly canonical?: string | null;
}): FixturePageInput {
  const alternates = (options.alternates ?? [])
    .map(
      (alternate) =>
        `<link rel="alternate" hreflang="${alternate.hreflang}" href="${alternate.href}">`,
    )
    .join('');
  const canonical =
    options.canonical === null
      ? ''
      : `<link rel="canonical" href="${options.canonical ?? options.path}">`;
  return {
    path: options.path,
    html:
      `<!doctype html><html lang="${options.lang}"><head><title>${options.title}</title>` +
      `${canonical}${alternates}</head>` +
      `<body><h1>${options.title}</h1><p>${options.body}</p></body></html>`,
  };
}

const EN = '/en/jobs/backend.html';
const UK = '/uk/jobs/backend.html';
const TITLE = 'Senior Backend Engineer — Example';

/** Пара «английская и украинская версия одной вакансии» с настраиваемыми hreflang. */
function localizedPair(options: {
  readonly fromEn?: readonly Alternate[];
  readonly fromUk?: readonly Alternate[];
}): FixturePageInput[] {
  return [
    jobPage({
      path: EN,
      lang: 'en',
      title: TITLE,
      body: 'We are looking for an engineer who works with Node.js and Postgres.',
      alternates: options.fromEn ?? [],
    }),
    jobPage({
      path: UK,
      lang: 'uk',
      title: TITLE,
      body: 'Шукаємо інженера, який працює з Node.js та Postgres.',
      alternates: options.fromUk ?? [],
    }),
  ];
}

const MUTUAL_EN_UK = {
  fromEn: [
    { hreflang: 'en', href: EN },
    { hreflang: 'uk', href: UK },
  ],
  fromUk: [
    { hreflang: 'en', href: EN },
    { hreflang: 'uk', href: UK },
  ],
};

describe('SEO-ONPAGE-004 и объявленные языковые версии', () => {
  it('молчит о паре, которую сайт объявил версиями друг друга на разных языках', () => {
    expect(
      paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages: localizedPair(MUTUAL_EN_UK) }))),
    ).toEqual([]);
  });

  it('читает href заявления ключом обхода: query-хвост его не ломает', () => {
    // queryPolicy 'ignore' — профиль по умолчанию: `?lang=uk` ведёт на ту же
    // прочитанную страницу, и заявление указывает на члена группы.
    const pages = localizedPair({
      fromEn: [{ hreflang: 'uk', href: `${UK}?lang=uk` }],
      fromUk: [{ hreflang: 'en', href: `${EN}?lang=en` }],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([]);
  });

  it('молчит обо всех членах трёхъязычного набора', () => {
    const DE = '/de/jobs/backend.html';
    const all: readonly Alternate[] = [
      { hreflang: 'en', href: EN },
      { hreflang: 'uk', href: UK },
      { hreflang: 'de', href: DE },
    ];
    const pages = [
      jobPage({ path: EN, lang: 'en', title: TITLE, body: 'English body', alternates: all }),
      jobPage({ path: UK, lang: 'uk', title: TITLE, body: 'Український текст', alternates: all }),
      jobPage({ path: DE, lang: 'de', title: TITLE, body: 'Deutscher Text', alternates: all }),
    ];
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([]);
  });

  it('односторонняя ссылка заявлением не является', () => {
    const pages = localizedPair({ fromEn: [{ hreflang: 'uk', href: UK }] });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('один и тот же язык с двух сторон — противоречие, а не заявление', () => {
    const pages = localizedPair({
      fromEn: [{ hreflang: 'uk', href: UK }],
      fromUk: [{ hreflang: 'uk', href: EN }],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('партнёрский hreflang против <html lang> — противоречие, а не заявление', () => {
    // Обе страницы объявлены английскими и несут один английский текст, но
    // ссылаются друг на друга как на разные языки. Взаимность и «языки не
    // пересекаются» тут есть — а объяснения дубля нет: сайт сам себе противоречит.
    const COPY = '/en/jobs/backend-copy.html';
    const body = 'We are looking for an engineer who works with Node.js and Postgres.';
    const pages = [
      jobPage({
        path: EN,
        lang: 'en',
        title: TITLE,
        body,
        alternates: [{ hreflang: 'uk', href: COPY }],
      }),
      jobPage({
        path: COPY,
        lang: 'en',
        title: TITLE,
        body,
        alternates: [{ hreflang: 'en', href: EN }],
      }),
    ];
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([COPY, EN]);
  });

  it('перепутанные self-заявления находку не снимают', () => {
    // Английская страница объявляет себя украинской версией, украинская —
    // английской: о каждой из них заявления расходятся, и находка остаётся.
    const swapped: readonly Alternate[] = [
      { hreflang: 'uk', href: EN },
      { hreflang: 'en', href: UK },
    ];
    const pages = localizedPair({ fromEn: swapped, fromUk: swapped });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('когда страница о своём языке молчит, заявление читается по партнёру', () => {
    // Пустой <html lang> — не противоречие, а отсутствие заявления: взаимные и
    // разноязычные hreflang остаются единственным сказанным о языке.
    const pages = localizedPair({
      fromEn: [{ hreflang: 'uk', href: UK }],
      fromUk: [{ hreflang: 'en', href: EN }],
    }).map((page) => ({
      ...page,
      html: (page.html ?? '').replace(/<html lang="[a-z]*">/, '<html>'),
    }));
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([]);
  });

  it('регион языка не делает страницы разноязычными', () => {
    // `en-us` и `en-gb` делят одну выдачу: одинаковый заголовок у них — дубль.
    const pages = localizedPair({
      fromEn: [
        { hreflang: 'en-us', href: EN },
        { hreflang: 'en-gb', href: UK },
      ],
      fromUk: [
        { hreflang: 'en-us', href: EN },
        { hreflang: 'en-gb', href: UK },
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('мусорный hreflang ничего не объявляет', () => {
    const pages = localizedPair({
      fromEn: [
        { hreflang: 'en_US', href: EN },
        { hreflang: 'ukrainian', href: UK },
      ],
      fromUk: [
        { hreflang: 'en_US', href: EN },
        { hreflang: 'ukrainian', href: UK },
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('x-default языком не считается', () => {
    const pages = localizedPair({
      fromEn: [{ hreflang: 'x-default', href: UK }],
      fromUk: [{ hreflang: 'x-default', href: EN }],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('пустой hreflang и пустой href заявлением не являются', () => {
    const pages = localizedPair({
      fromEn: [
        { hreflang: '', href: UK },
        { hreflang: 'uk', href: '' },
      ],
      fromUk: [
        { hreflang: '', href: EN },
        { hreflang: 'en', href: '' },
      ],
    });
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('третий партнёр по заголовку без заявления оставляет находку всем трём', () => {
    // Сайт объяснил не то совпадение, о котором речь: страница с тем же
    // заголовком, которая ничьей версией не объявлена, остаётся дублем — и для
    // себя, и для обеих локализованных страниц.
    const OTHER = '/en/jobs/copy.html';
    const pages = [
      ...localizedPair(MUTUAL_EN_UK),
      jobPage({ path: OTHER, lang: 'en', title: TITLE, body: 'A stray copy of the vacancy.' }),
    ];
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, OTHER, UK]);
  });

  it('заявление на страницу с другим заголовком находку не снимает', () => {
    const CONTACTS = '/uk/contacts.html';
    const pages = [
      jobPage({
        path: EN,
        lang: 'en',
        title: TITLE,
        body: 'English body',
        alternates: [{ hreflang: 'uk', href: CONTACTS }],
      }),
      jobPage({
        path: UK,
        lang: 'uk',
        title: TITLE,
        body: 'Український текст',
        alternates: [{ hreflang: 'en', href: EN }],
      }),
      jobPage({ path: CONTACTS, lang: 'uk', title: 'Контакти — Example', body: 'Адреса' }),
    ];
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([EN, UK]);
  });

  it('дубль на одном языке остаётся находкой в том же прогоне', () => {
    // Узость проверки: заявленная пара молчит, а две английские страницы с
    // общим заголовком в том же обходе — находки.
    const FIRST = '/en/services/audit.html';
    const SECOND = '/en/services/seo.html';
    const shared = 'SEO services — Example';
    const pages = [
      ...localizedPair(MUTUAL_EN_UK),
      jobPage({ path: FIRST, lang: 'en', title: shared, body: 'What we do.' }),
      jobPage({ path: SECOND, lang: 'en', title: shared, body: 'How we audit.' }),
    ];
    expect(paths(runSeoRule('SEO-ONPAGE-004', siteContext({ pages })))).toEqual([FIRST, SECOND]);
  });

  it('дубль meta description у заявленной пары находкой остаётся', () => {
    // Заявление прочитано только о заголовке: описание SEO-ONPAGE-006 судит
    // по-прежнему, и расширять на него это молчание никто не просил.
    const description = 'Join the Example engineering team.';
    const withDescription = localizedPair(MUTUAL_EN_UK).map((page) => ({
      ...page,
      html: (page.html ?? '').replace(
        '</head>',
        `<meta name="description" content="${description}"></head>`,
      ),
    }));
    expect(paths(runSeoRule('SEO-ONPAGE-006', siteContext({ pages: withDescription })))).toEqual([
      EN,
      UK,
    ]);
  });
});
