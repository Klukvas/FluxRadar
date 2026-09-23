// Конфигурация запроса в доказательстве покрытия: что считается «тем же
// прогоном», а что — другим (§14, run-context.ts).
//
// Каждый тест про scope — это способ солгать владельцу «мы это починили»:
// URL, отброшенный фильтром обхода, не попадает ни в один список CrawlResult,
// и правило, чей спрос — множество увиденных URL, читает его исчезновение как
// удаление страницы с сайта.

import { scanScopeSchema } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import {
  UNKNOWN_RUN_CONTEXT,
  crawlRequestContext,
  crawlScopeKey,
  sameRequestContext,
} from './run-context.ts';

/** Scope ровно так, как его разбирает API: с дефолтами схемы. */
function scope(input: Record<string, unknown> = {}): ReturnType<typeof scanScopeSchema.parse> {
  return scanScopeSchema.parse({ includeSubdomains: false, ...input });
}

const BASE = scope();

describe('отпечаток scope обхода', () => {
  it('тот же scope — тот же отпечаток', () => {
    expect(crawlScopeKey(scope({ urlPatterns: ['/blog/*'] }))).toBe(
      crawlScopeKey(scope({ urlPatterns: ['/blog/*'] })),
    );
  });

  it('порядок и дубли шаблонов на смысл не влияют', () => {
    // Краулер матчит каждый шаблон по отдельности, поэтому перестановка — это
    // тот же обход, и запрещать из-за неё закрытие находок незачем.
    expect(crawlScopeKey(scope({ urlPatterns: ['/blog/*', '/shop/*', '/blog/*'] }))).toBe(
      crawlScopeKey(scope({ urlPatterns: ['/shop/*', '/blog/*'] })),
    );
  });

  it('пустой список шаблонов равен отсутствию списка', () => {
    // isPathnameAllowedByPatterns: пустой include пропускает всё (scope.ts).
    expect(crawlScopeKey(scope({ urlPatterns: [], excludePatterns: [] }))).toBe(
      crawlScopeKey(BASE),
    );
  });

  it.each([
    ['include-шаблон', { urlPatterns: ['/blog/*'] }],
    ['exclude-шаблон', { excludePatterns: ['/shop/*'] }],
    ['другой exclude-шаблон', { excludePatterns: ['/shop/item'] }],
    ['поддомены', { includeSubdomains: true }],
    ['глубину', { maxDepth: 2 }],
    ['политику query-параметров', { queryPolicy: 'include' }],
  ])('меняет отпечаток: %s', (_name, narrowing) => {
    expect(crawlScopeKey(scope(narrowing))).not.toBe(crawlScopeKey(BASE));
  });

  it('maxDepth=0 отличается от «без ограничения глубины»', () => {
    expect(crawlScopeKey(scope({ maxDepth: 0 }))).not.toBe(crawlScopeKey(BASE));
  });

  it.each([
    ['лимит страниц', { maxPages: 500 }],
    ['игнорирование robots.txt', { respectRobots: false, robotsOverrideConfirmed: true }],
  ])('не меняет отпечаток: %s', (_name, change) => {
    // URL за лимитом попадает в skippedOverLimit, закрытый robots.txt — в
    // blockedByRobots: оба остаются в спросе правила, и политика видит их как
    // «данных нет», а не как починку. Гасить из-за них сравнение целиком —
    // лишняя строгость, которая просто перестала бы закрывать находки.
    expect(crawlScopeKey(scope(change))).toBe(crawlScopeKey(BASE));
  });
});

describe('совпадение конфигураций', () => {
  it('тот же запрос совпадает сам с собой', () => {
    const context = crawlRequestContext(BASE);
    expect(sameRequestContext(context, crawlRequestContext(BASE))).toBe(true);
  });

  it('суженный обход не совпадает с полным', () => {
    expect(
      sameRequestContext(
        crawlRequestContext(scope({ excludePatterns: ['/shop/*'] })),
        crawlRequestContext(BASE),
      ),
    ).toBe(false);
  });

  it('mobile-прогон не совпадает с desktop-прогоном', () => {
    expect(
      sameRequestContext(
        crawlRequestContext(scope({ userAgent: 'mobile' })),
        crawlRequestContext(BASE),
      ),
    ).toBe(false);
  });

  // Три способа прочитать один и тот же адрес и получить другие данные. Каждый
  // пришёл из своей дорожки, и ни одна не знала об этом файле: без них
  // перенастроенный прогон закрывает находки, которые он не перепроверял.
  it('рендеренный прогон не совпадает со статическим', () => {
    expect(
      sameRequestContext(
        crawlRequestContext(scope({ renderJs: true })),
        crawlRequestContext(scope({ renderJs: false })),
      ),
    ).toBe(false);
  });

  it('другой метод API-проверки — другое измерение', () => {
    const asGet = scope({ apiChecks: [{ method: 'GET', url: 'https://example.com/api/health' }] });
    const asHead = scope({
      apiChecks: [{ method: 'HEAD', url: 'https://example.com/api/health' }],
    });
    expect(sameRequestContext(crawlRequestContext(asGet), crawlRequestContext(asHead))).toBe(false);
  });

  it('другой набор ожидаемых статусов — другой оракул', () => {
    const expecting200 = scope({
      apiChecks: [{ method: 'GET', url: 'https://example.com/api/health', expectedStatus: [200] }],
    });
    const expecting404 = scope({
      apiChecks: [{ method: 'GET', url: 'https://example.com/api/health', expectedStatus: [404] }],
    });
    expect(
      sameRequestContext(crawlRequestContext(expecting200), crawlRequestContext(expecting404)),
    ).toBe(false);
    // Порядок в списке ничего не значит: это набор, а не последовательность.
    expect(
      crawlScopeKey(
        scope({
          apiChecks: [
            { method: 'GET', url: 'https://example.com/api/health', expectedStatus: [200, 204] },
          ],
        }),
      ),
    ).toBe(
      crawlScopeKey(
        scope({
          apiChecks: [
            { method: 'GET', url: 'https://example.com/api/health', expectedStatus: [204, 200] },
          ],
        }),
      ),
    );
  });

  it('другая привязка Bing — другое свойство, а не другая страница', () => {
    const context = crawlRequestContext(BASE);
    expect(
      sameRequestContext(
        { ...context, bingSiteUrl: 'https://example.com/' },
        { ...context, bingSiteUrl: 'https://shop.example.com/' },
      ),
    ).toBe(false);
    expect(
      sameRequestContext(
        { ...context, bingSiteUrl: 'https://example.com/' },
        { ...context, bingSiteUrl: 'https://example.com/' },
      ),
    ).toBe(true);
  });

  it('прогон без записанного scope сравнению не подлежит', () => {
    // Доказательства, записанные до того, как scope вошёл в контекст: null не
    // совпадает ни с чем, включая другой null, — находка остаётся открытой.
    const legacy = { ...crawlRequestContext(BASE), crawlScope: null };
    expect(sameRequestContext(legacy, crawlRequestContext(BASE))).toBe(false);
    expect(sameRequestContext(crawlRequestContext(BASE), legacy)).toBe(false);
    expect(sameRequestContext(UNKNOWN_RUN_CONTEXT, UNKNOWN_RUN_CONTEXT)).toBe(false);
  });

  it('контекста прошлого прогона нет вовсе — не совпадение', () => {
    expect(sameRequestContext(crawlRequestContext(BASE), undefined)).toBe(false);
  });
});
