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

  it('NFC: «Café» составным и готовым é — одно значение', () => {
    // Текст, набранный на macOS, приходит в NFD; та же строка из CMS — в NFC.
    // Разными их делает только кодировка, и читатель разницы не видит.
    const nfc = siteContext({
      pages: [
        pageWith({ path: '/a.html', title: 'Caf\u00e9 menu' }),
        pageWith({ path: '/b.html', title: 'Cafe\u0301 menu' }),
      ],
    });
    expect(duplicateValueOf(nfc.crawl.pages[1]!, 'title')).toBe('Caf\u00e9 menu');
    expect(groupOf(nfc, 'title', '/a.html')).toEqual([url('/a.html'), url('/b.html')]);
  });

  it('сущности раскрываются: «Tom &amp; Jerry» и «Tom & Jerry» — одно значение', () => {
    const entities = siteContext({
      pages: [
        {
          path: '/a.html',
          html:
            '<!doctype html><html lang="en"><head><title>A &amp; B</title></head>' +
            '<body><p>Tom &amp; Jerry, and nothing else on this page at all.</p></body></html>',
        },
        {
          path: '/b.html',
          html:
            '<!doctype html><html lang="en"><head><title>A & B</title></head>' +
            '<body><p>Tom & Jerry, and nothing else on this page at all.</p></body></html>',
        },
      ],
    });
    expect(duplicateValueOf(entities.crawl.pages[0]!, 'visible-text')).toBe(
      'Tom & Jerry, and nothing else on this page at all.',
    );
    expect(groupOf(entities, 'title', '/a.html')).toEqual([url('/a.html'), url('/b.html')]);
    expect(groupOf(entities, 'visible-text', '/a.html')).toEqual([url('/a.html'), url('/b.html')]);
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
    expect(unclaimedDuplicatesOf(built, url('/a.html'))).toEqual({
      count: 1,
      listed: [url('/b.html')],
    });
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toEqual({
      count: 1,
      listed: [url('/a.html')],
    });
  });

  it('canonical за пределы группы находку не снимает', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/elsewhere.html') }),
      pageWith({ path: '/b.html', title: 'Shared title' }),
    ]);
    expect(unclaimedDuplicatesOf(built, url('/a.html'))).toEqual({
      count: 1,
      listed: [url('/b.html')],
    });
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toEqual({
      count: 1,
      listed: [url('/a.html')],
    });
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
    expect(unclaimedDuplicatesOf(built, url('/b.html'))).toEqual({
      count: 2,
      listed: [url('/a.html'), url('/c.html')],
    });
  });
});

describe('топология canonical: заявление должно чем-то кончаться', () => {
  // Молчать о странице, НА КОТОРУЮ указали, правильно ровно тогда, когда
  // указавший дошёл до конца цепочки внутри группы. Цепочка, уходящая наружу, и
  // петля сообщают, что настоящая версия есть, и не сообщают какая: до этой
  // ревизии обе давали группу, о которой не отчитывалось ни одно правило.
  const index = (pages: readonly ReturnType<typeof pageWith>[]) =>
    duplicateIndex(siteContext({ pages: [...pages] }), 'title');

  const reported = (built: ReturnType<typeof index>, path: string) =>
    unclaimedDuplicatesOf(built, url(path)) !== null;

  it('названная страница сама указывает наружу группы — говорят обе', () => {
    // /b назвала настоящей /a, а /a говорит, что настоящая не она: настоящей не
    // названа ни одна, и снимать находку не с чего.
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/elsewhere.html') }),
      pageWith({ path: '/b.html', title: 'Shared title', canonical: url('/a.html') }),
      pageWith({ path: '/elsewhere.html', title: 'A title of its own' }),
    ]);
    expect(reported(built, '/a.html')).toBe(true);
    expect(reported(built, '/b.html')).toBe(true);
  });

  it('петля canonical-ов — говорят обе', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/b.html') }),
      pageWith({ path: '/b.html', title: 'Shared title', canonical: url('/a.html') }),
    ]);
    expect(reported(built, '/a.html')).toBe(true);
    expect(reported(built, '/b.html')).toBe(true);
  });

  it('цепочка c → b → a с canonical на себя у a — молчат все три', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/a.html') }),
      pageWith({ path: '/b.html', title: 'Shared title', canonical: url('/a.html') }),
      pageWith({ path: '/c.html', title: 'Shared title', canonical: url('/b.html') }),
    ]);
    // Сайт назвал настоящей /a, и до неё дошли обе остальные.
    expect(reported(built, '/a.html')).toBe(false);
    expect(reported(built, '/b.html')).toBe(false);
    expect(reported(built, '/c.html')).toBe(false);
  });

  it('цепочка, уходящая из группы, — говорят все её страницы', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/elsewhere.html') }),
      pageWith({ path: '/b.html', title: 'Shared title', canonical: url('/a.html') }),
      pageWith({ path: '/c.html', title: 'Shared title', canonical: url('/b.html') }),
      pageWith({ path: '/elsewhere.html', title: 'A title of its own' }),
    ]);
    expect(reported(built, '/a.html')).toBe(true);
    expect(reported(built, '/b.html')).toBe(true);
    expect(reported(built, '/c.html')).toBe(true);
  });

  it('страница, ведущая в петлю, находку тоже получает', () => {
    const built = index([
      pageWith({ path: '/a.html', title: 'Shared title', canonical: url('/b.html') }),
      pageWith({ path: '/b.html', title: 'Shared title', canonical: url('/a.html') }),
      pageWith({ path: '/c.html', title: 'Shared title', canonical: url('/a.html') }),
    ]);
    // /c назвала настоящей /a, но /a своей настоящей версии так и не нашла.
    expect(reported(built, '/c.html')).toBe(true);
  });

  it('canonical на непрочитанный адрес члена группы — заявление наружу', () => {
    // Обход прочитал /a/, а copy указывает на /a: без снимка /a краулер не
    // знает, что это одна страница, и правило не вправе знать больше.
    const built = index([
      pageWith({ path: '/a/', title: 'Shared title' }),
      pageWith({ path: '/copy.html', title: 'Shared title', canonical: url('/a') }),
    ]);
    expect(reported(built, '/a/')).toBe(true);
    expect(reported(built, '/copy.html')).toBe(true);
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
    const ctx = siteContext({
      pages: ['/e', '/d', '/c', '/b', '/a'].map((path) =>
        pageWith({ path: `${path}.html`, title: 'One title for five pages' }),
      ),
    });
    const duplicates = unclaimedDuplicatesOf(duplicateIndex(ctx, 'title'), url('/e.html'));
    // Счёт — вся группа, список — только её голова: одно не подменяет другое.
    expect(duplicates?.count).toBe(4);
    expect(duplicates?.listed).toHaveLength(MAX_LISTED_DUPLICATES);
    expect(duplicates?.listed).toEqual([url('/a.html'), url('/b.html'), url('/c.html')]);
  });

  it('свой адрес в список не попадает, даже если он первый по алфавиту', () => {
    const ctx = siteContext({
      pages: ['/a', '/b', '/c', '/d'].map((path) =>
        pageWith({ path: `${path}.html`, title: 'One title for four pages' }),
      ),
    });
    expect(unclaimedDuplicatesOf(duplicateIndex(ctx, 'title'), url('/a.html'))).toEqual({
      count: 3,
      listed: [url('/b.html'), url('/c.html'), url('/d.html')],
    });
  });

  it('группа в 20 000 страниц отвечает каждому её члену за доли секунды', () => {
    // Сайт с общим шаблоном — это одна группа размером со сайт, и вопрос ей
    // задают на каждой странице. Ответ, перечисляющий партнёров, стоил бы
    // квадрат размера группы: 20 000 страниц — 3.3 с на одно правило из трёх,
    // и 50 000 страниц превратили бы скан в минуты чистого перебора.
    const ctx = siteContext({
      pages: Array.from({ length: 20_000 }, (_, position) =>
        pageWith({ path: `/p${String(position).padStart(6, '0')}.html`, title: 'One title' }),
      ),
    });
    const index = duplicateIndex(ctx, 'title');
    const startedAt = performance.now();
    let answered = 0;
    let listedTotal = 0;
    for (const address of index.addresses) {
      const duplicates = unclaimedDuplicatesOf(index, address);
      if (duplicates === null) {
        continue;
      }
      answered += duplicates.count === 19_999 ? 1 : 0;
      listedTotal += duplicates.listed.length;
    }
    const elapsedMs = performance.now() - startedAt;

    expect(answered).toBe(20_000);
    expect(listedTotal).toBe(20_000 * MAX_LISTED_DUPLICATES);
    // Порог щедрый нарочно: он ловит возврат к перебору группы (секунды на
    // порядок больше), а не разницу между быстрой и медленной машиной CI.
    expect(elapsedMs).toBeLessThan(2000);
  }, 60_000);
});
