// Группировка дублей сама по себе: что считается значением, кто попадает в
// группу и как сайт снимает находку через canonical. Правила, которые на этом
// стоят, — в seo/duplicate-metadata.test.ts и content/duplicate-content.test.ts,
// а вопросы личности находки — в seo/duplicate-identity.test.ts.

import { describe, expect, it } from 'vitest';

import { siteContext } from '../testing/fixture-harness.js';
import { url } from '../testing/link-fixtures.js';
import {
  duplicateIndex,
  duplicateValueOf,
  listedDuplicates,
  MAX_LISTED_DUPLICATES,
  unclaimedDuplicatesOf,
  type DuplicateValueKind,
} from './duplicate-groups.js';

/** Страница с заданными title, description, canonical и текстом body. */
function pageWith(options: {
  readonly path: string;
  readonly title?: string;
  readonly description?: string;
  readonly canonical?: string;
  readonly body?: string;
  readonly depth?: number;
}): {
  readonly path: string;
  readonly html: string;
  readonly depth: number;
} {
  const head = [
    options.title === undefined ? '' : `<title>${options.title}</title>`,
    options.description === undefined
      ? ''
      : `<meta name="description" content="${options.description}">`,
    options.canonical === undefined ? '' : `<link rel="canonical" href="${options.canonical}">`,
  ].join('');
  return {
    path: options.path,
    depth: options.depth ?? 0,
    html:
      `<!doctype html><html lang="en"><head>${head}</head>` +
      `<body><h1>Heading</h1><p>${options.body ?? `Body of ${options.path}`}</p></body></html>`,
  };
}

/** Адреса группы этого адреса; null — страница ни с кем значение не делит. */
function groupOf(ctx: ReturnType<typeof siteContext>, kind: DuplicateValueKind, path: string) {
  return duplicateIndex(ctx, kind).groups.get(url(path))?.addresses ?? null;
}

describe('нормализация значения', () => {
  const ctx = siteContext({
    pages: [
      pageWith({ path: '/spaced.html', title: '  Pricing\n   and   plans  ' }),
      pageWith({ path: '/tight.html', title: 'Pricing and plans' }),
      pageWith({ path: '/cased.html', title: 'pricing and plans' }),
      pageWith({ path: '/blank.html', title: '   ' }),
      pageWith({ path: '/absent.html' }),
    ],
  });

  it('схлопывает пробелы и обрезает края', () => {
    expect(duplicateValueOf(ctx.crawl.pages[0]!, 'title')).toBe('Pricing and plans');
    expect(groupOf(ctx, 'title', '/spaced.html')).toEqual([
      url('/spaced.html'),
      url('/tight.html'),
    ]);
  });

  it('регистр сохраняет: «pricing» и «Pricing» — разные заголовки', () => {
    // Выдача показывает заголовок как написан, и объявить их одним значило бы
    // придумать дубль там, где его нет.
    expect(groupOf(ctx, 'title', '/cased.html')).toBeNull();
  });

  it('пустое и отсутствующее значение группой не бывает', () => {
    // Отсутствующий title — предмет SEO-ONPAGE-001; десять страниц без него не
    // дубли друг друга.
    expect(duplicateValueOf(ctx.crawl.pages[3]!, 'title')).toBe('');
    expect(groupOf(ctx, 'title', '/blank.html')).toBeNull();
    expect(groupOf(ctx, 'title', '/absent.html')).toBeNull();
  });

  it('видимый текст читается без script и style', () => {
    const scripted = siteContext({
      pages: [
        {
          path: '/a.html',
          html:
            '<!doctype html><html lang="en"><head><title>A</title>' +
            '<style>.x{color:red}</style></head><body><p>Shared body text</p>' +
            '<script>console.log("a")</script></body></html>',
        },
        {
          path: '/b.html',
          html:
            '<!doctype html><html lang="en"><head><title>B</title></head>' +
            '<body><script>console.log("b")</script><p>Shared   body\ntext</p></body></html>',
        },
      ],
    });
    expect(groupOf(scripted, 'visible-text', '/a.html')).toEqual([url('/a.html'), url('/b.html')]);
  });
});

describe('canonical — это ответ сайта, а не нарушение', () => {
  const index = (pages: readonly ReturnType<typeof pageWith>[]) =>
    duplicateIndex(siteContext({ pages: [...pages] }), 'title');

  it('canonical на другого члена группы снимает находку с обоих концов', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title' }),
      pageWith({ path: '/b.html', title: 'Shared title', canonical: url('/a.html') }),
    ]);
    // /b объявила себя дублем, /a названа настоящей — сказать нечего ни о ком.
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toBeNull();
    expect(unclaimedDuplicatesOf(built, url('/a.html'))).toBeNull();
  });

  it('canonical на себя внутри группы находку не снимает', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/a.html') }),
      pageWith({ path: '/b.html', title: 'Shared title', canonical: url('/b.html') }),
    ]);
    // Обе говорят «я оригинал»: заявления о дубле нет ни у одной.
    expect(unclaimedDuplicatesOf(built, url('/a.html'))).toEqual([url('/b.html')]);
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toEqual([url('/a.html')]);
  });

  it('canonical за пределы группы находку не снимает', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/elsewhere.html') }),
      pageWith({ path: '/b.html', title: 'Shared title' }),
    ]);
    expect(unclaimedDuplicatesOf(built, url('/a.html'))).toEqual([url('/b.html')]);
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toEqual([url('/a.html')]);
  });

  it('canonical разбирается ключом обхода: query-параметры не делают адрес чужим', () => {
    // queryPolicy фикстуры — производственная 'ignore': canonical
    // `/a.html?utm_source=x` это адрес /a.html, а не несуществующий адрес с
    // параметром. Правило, нормализующее иначе, спросило бы группу о члене,
    // которого в ней нет, и находку бы не сняло.
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title' }),
      pageWith({
        path: '/b.html',
        title: 'Shared title',
        canonical: `${url('/a.html')}?utm_source=x`,
      }),
    ]);
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toBeNull();
    expect(unclaimedDuplicatesOf(built, url('/a.html'))).toBeNull();
  });

  it('в группе из трёх молчат заявивший и названный, говорит третий', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title' }),
      pageWith({ path: '/b.html', title: 'Shared title' }),
      pageWith({ path: '/c.html', title: 'Shared title', canonical: url('/a.html') }),
    ]);
    expect(unclaimedDuplicatesOf(built, url('/c.html'))).toBeNull();
    expect(unclaimedDuplicatesOf(built, url('/a.html'))).toBeNull();
    // /b делит заголовок с /a и canonical-ом ни с кем не связана.
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toEqual([url('/a.html'), url('/c.html')]);
  });
});

describe('состав группы', () => {
  it('снимок, уехавший редиректом за область обхода, страницей сайта не бывает', () => {
    const ctx = siteContext({
      pages: [
        pageWith({ path: '/a.html', title: 'Shared title' }),
        {
          ...pageWith({ path: '/go', title: 'Shared title' }),
          finalPath: 'https://partner.example/landing',
          redirectChain: [
            { url: url('/go'), status: 302, location: 'https://partner.example/landing' },
          ],
        },
      ],
    });
    // «У этой страницы неуникальный заголовок» о чужом сайте было бы
    // утверждением не о сайте владельца (leftCrawlScope).
    expect(duplicateIndex(ctx, 'title').groups.size).toBe(0);
    expect(duplicateIndex(ctx, 'title').addresses).toEqual([url('/a.html')]);
  });

  it('не-200 и не-HTML в группировку не идут', () => {
    const ctx = siteContext({
      pages: [
        pageWith({ path: '/a.html', title: 'Shared title' }),
        { ...pageWith({ path: '/gone.html', title: 'Shared title' }), status: 404 },
        { ...pageWith({ path: '/broken.html', title: 'Shared title' }), fetchError: 'ECONNRESET' },
      ],
    });
    expect(duplicateIndex(ctx, 'title').groups.size).toBe(0);
  });

  it('адреса группы отсортированы, а не в порядке очереди обхода', () => {
    const ctx = siteContext({
      pages: [
        pageWith({ path: '/z.html', title: 'Shared title' }),
        pageWith({ path: '/a.html', title: 'Shared title' }),
        pageWith({ path: '/m.html', title: 'Shared title' }),
      ],
    });
    expect(groupOf(ctx, 'title', '/m.html')).toEqual([
      url('/a.html'),
      url('/m.html'),
      url('/z.html'),
    ]);
  });

  it('три вида значения группируются независимо друг от друга', () => {
    const ctx = siteContext({
      pages: [
        pageWith({ path: '/a.html', title: 'Same', description: 'Only here', body: 'Text A' }),
        pageWith({ path: '/b.html', title: 'Same', description: 'Shared copy', body: 'Text B' }),
        pageWith({ path: '/c.html', title: 'Other', description: 'Shared copy', body: 'Text B' }),
      ],
    });
    expect(groupOf(ctx, 'title', '/a.html')).toEqual([url('/a.html'), url('/b.html')]);
    expect(groupOf(ctx, 'meta-description', '/b.html')).toEqual([url('/b.html'), url('/c.html')]);
    expect(groupOf(ctx, 'visible-text', '/b.html')).toEqual([url('/b.html'), url('/c.html')]);
    expect(groupOf(ctx, 'meta-description', '/a.html')).toBeNull();
    expect(groupOf(ctx, 'visible-text', '/a.html')).toBeNull();
  });
});

describe('ограниченный список партнёров', () => {
  it('называет первые по алфавиту и не растёт вместе с группой', () => {
    const partners = ['/e', '/d', '/c', '/b', '/a'].map((path) => url(path)).toSorted();
    expect(listedDuplicates(partners)).toHaveLength(MAX_LISTED_DUPLICATES);
    expect(listedDuplicates(partners)).toEqual([url('/a'), url('/b'), url('/c')]);
  });
});
