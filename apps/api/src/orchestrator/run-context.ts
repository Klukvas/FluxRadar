// Конфигурация запроса, под которой прогон читал сайт и внешние источники.
//
// Доказательство повторной проверки (run-coverage.ts) хранит URL-ы, но один и
// тот же URL — это разные данные при разной конфигурации:
//   • userAgent: scanScope различает desktop и mobile, и run-attempt шлёт разный
//     User-Agent. Сайт с отдельной мобильной вёрсткой отдаёт по тому же адресу
//     другой HTML, поэтому mobile-прогон не доказывает ничего о находке
//     desktop-прогона (и наоборот).
//   • GA4 property / Search Console site: Analytics-проверки судят не страницу,
//     а привязанное свойство. Перепривязка к другому property даёт те же
//     origin-цели при совершенно других данных.
//   • scope обхода: он решает, какие URL обходу вообще разрешено трогать, и
//     отфильтрованный им URL не попадает НИКУДА — ни в pages, ни в
//     skippedOverLimit, ни в blockedByRobots, ни в errors (crawler.ts:176-189).
//     Для правил, чей спрос — это множество увиденных страниц (SEO-TECH-007,
//     SEO-TECH-008), сузившийся scope выглядит неотличимо от «сайт про эту
//     страницу больше не спрашивает», то есть от починки. Поэтому scope едет в
//     контексте, и прогон с другим scope прошлые находки не закрывает.
//
// Поэтому контекст едет в доказательстве рядом с целями, и политика Resolved
// закрывает находку только когда контекст совпал. Прогон, записавший цели без
// контекста (скан старше этой политики), сравнению не подлежит — это «не
// знаю», и находка остаётся открытой.

import { createHash } from 'node:crypto';

import type { ScanScopeInput } from '@fluxradar/contracts';
import { scanScopeSchema } from '@fluxradar/contracts';
import type { Scan } from '@prisma/client';

import { storedExecutionConfig } from '../profiles/execution-config.ts';

/** Поля запроса, которые меняют смысл одной и той же цели. */
export interface RunRequestContext {
  /** 'desktop' | 'mobile'; null — прогон контекст не записал. */
  readonly userAgent: string | null;
  readonly ga4PropertyId: string | null;
  readonly searchConsoleSiteUrl: string | null;
  /** Отпечаток фильтров обхода (crawlScopeKey); null — прогон его не записал. */
  readonly crawlScope: string | null;
  /**
   * Сайт Bing Webmaster Tools, к которому привязан профиль. Та же причина, что
   * у двух полей выше: проверки судят привязанное свойство, а не страницу.
   */
  readonly bingSiteUrl: string | null;
}

export const UNKNOWN_RUN_CONTEXT: RunRequestContext = {
  userAgent: null,
  ga4PropertyId: null,
  searchConsoleSiteUrl: null,
  crawlScope: null,
  bingSiteUrl: null,
};

/**
 * Версия набора полей отпечатка: новый набор обязан не совпасть со старым.
 *
 * v2 добавила режим рендера и явные API-проверки. Прогон под v1 сравнению с
 * прогоном под v2 не подлежит, и это правильно: ключи не равны, находка
 * остаётся открытой, и ни одна не закрывается по несравнимому материалу.
 */
const CRAWL_SCOPE_KEY_VERSION = 'scope-v2';

/**
 * Отпечаток фильтров обхода: одинаковый scope — одинаковая строка.
 *
 * Входят ровно те поля, из-за которых URL исчезает из обхода бесследно:
 * includeSubdomains и шаблоны (краулер отбрасывает такой URL до recordVariant),
 * maxDepth (слишком глубокий URL нигде не отмечается) и queryPolicy (он меняет
 * саму нормализацию адреса, то есть идентичность цели).
 *
 * maxPages и respectRobots не входят намеренно: URL за лимитом попадает в
 * skippedOverLimit, закрытый robots.txt — в blockedByRobots, и оба остаются в
 * спросе правила. Их потеря уже видна политике как «данных нет», а не как
 * починка, и гасить из-за них сравнение целиком — лишняя строгость.
 *
 * Хранится отпечаток, а не сами значения: сравнение нужно только на равенство,
 * а scope вправе нести до 100 шаблонов по 2 КБ (scanScopeSchema) — они бы
 * поехали в доказательство КАЖДОГО модуля. Порядок и дубли шаблонов на смысл
 * не влияют, поэтому нормализуются до хеша.
 */
export function crawlScopeKey(scope: ScanScopeInput): string {
  const normalized = {
    includeSubdomains: scope.includeSubdomains,
    maxDepth: scope.maxDepth ?? null,
    queryPolicy: scope.queryPolicy,
    urlPatterns: normalizedPatterns(scope.urlPatterns),
    excludePatterns: normalizedPatterns(scope.excludePatterns),
    // Рендер меняет не набор адресов, а сам материал: один и тот же URL отдаёт
    // разный DOM до и после выполнения скриптов. Находка, закрытая прогоном в
    // другом режиме, закрыта по другой странице.
    renderJs: scope.renderJs === true,
    // Метод и ожидаемые статусы — это и есть оракул REL-API-*: тот же адрес,
    // спрошенный HEAD вместо GET или с другим набором ожиданий, проверен не так.
    apiChecks: normalizedApiChecks(scope.apiChecks),
  };
  const digest = createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
  return `${CRAWL_SCOPE_KEY_VERSION}:${digest}`;
}

/** Пустой список и отсутствие списка — одно и то же для краулера (scope.ts). */
function normalizedPatterns(patterns: readonly string[] | undefined): readonly string[] {
  return [...new Set(patterns ?? [])].toSorted();
}

/**
 * Конфигурация API-проверок в сравнимом виде.
 *
 * Порядок в списке ничего не значит — важен набор; заголовки не входят, потому
 * что REL-API-005 судит их наличие как находку, а не как настройку измерения.
 */
function normalizedApiChecks(
  checks: ScanScopeInput['apiChecks'],
): readonly Readonly<Record<string, unknown>>[] {
  return (checks ?? [])
    .map((check) => ({
      method: check.method,
      url: check.url,
      expectedStatus: [...new Set(check.expectedStatus ?? [])].toSorted((a, b) => a - b),
    }))
    .toSorted((left, right) =>
      `${left.method} ${left.url}`.localeCompare(`${right.method} ${right.url}`),
    );
}

/** Scope прогона: сохранённый execution config приоритетнее сырого scopeJson. */
export function scanScopeOf(scan: Pick<Scan, 'executionConfigJson' | 'scopeJson'>): ScanScopeInput {
  const stored = storedExecutionConfig(scan.executionConfigJson)?.scope;
  if (stored !== undefined) {
    return stored;
  }
  try {
    const parsed = scanScopeSchema.safeParse(JSON.parse(scan.scopeJson));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Невалидный JSON в scopeJson — падаем на дефолт ниже.
  }
  return scanScopeSchema.parse({ includeSubdomains: false });
}

/**
 * Контекст прогона для модулей, читающих сайт. Analytics добавляет к нему свои
 * привязки (analytics-module.ts).
 */
export function crawlRequestContext(scope: ScanScopeInput): RunRequestContext {
  return {
    ...UNKNOWN_RUN_CONTEXT,
    userAgent: scope.userAgent,
    crawlScope: crawlScopeKey(scope),
  };
}

/**
 * Совпадает ли конфигурация двух прогонов.
 *
 * Отсутствующий контекст прошлого прогона — не совпадение: сравнивать не с чем,
 * а «не знаю» обязано оставить находку открытой. Так же читается и прогон, не
 * записавший поле: null не равен ничему, включая другой null.
 */
export function sameRequestContext(
  now: RunRequestContext,
  before: RunRequestContext | undefined,
): boolean {
  if (before === undefined) {
    return false;
  }
  return (
    now.userAgent !== null &&
    now.userAgent === before.userAgent &&
    now.crawlScope !== null &&
    now.crawlScope === before.crawlScope &&
    now.ga4PropertyId === before.ga4PropertyId &&
    now.searchConsoleSiteUrl === before.searchConsoleSiteUrl &&
    now.bingSiteUrl === before.bingSiteUrl
  );
}
