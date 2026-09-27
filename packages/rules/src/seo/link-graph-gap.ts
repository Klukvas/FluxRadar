// Полнота графа внутренних ссылок одного обхода: единственный вопрос этого
// файла — «можно ли вообще судить о входящих ссылках по тому, что прочитано».
// Его спрашивают SEO-TECH-009/010/011, и ответ кэшируется на CrawlResult.

import type { CrawlResult, CrawlScope } from '@fluxradar/crawler';
import { isHostInScope, isPathnameAllowedByPatterns } from '@fluxradar/crawler';

import type { SiteContext } from '../engine/types.js';
import { hostnameOf } from './crawl-scope.js';
import { crawlKey, linkSourcePages, pageLinks } from './site-index.js';

/**
 * Почему граф внутренних ссылок этого обхода нельзя считать полным.
 *
 * Вывод «на эту страницу никто не ссылается» держится на том, что ссылки
 * ПРОЧИТАНЫ у каждой страницы сайта. Любой непрочитанный документ мог нести
 * ровно ту ссылку, которой правило не нашло, поэтому SEO-TECH-009/010/011 при
 * непустом пробеле молчат (и отчитываются Not applicable — см. шапки правил).
 */
export type LinkGraphGap =
  /** URL-ы не влезли в лимит тарифа: skippedOverLimit. */
  | 'page-limit'
  /** Обход прервали паузой или отменой — очередь осталась необработанной. */
  | 'stopped'
  /** Страница не отдала тела: transport-сбой или остановка хоста (D-030). */
  | 'unread-page'
  /**
   * Ссылка на адрес, который обход считал своим, но нигде о нём не отчитался.
   *
   * Так выглядит расхождение между тем, что обход обещал прочитать, и тем, что
   * прочитал: адрес прошёл все фильтры scope, но снимка, лимита, robots.txt или
   * ошибки под ним нет. Адрес, отброшенный самим scope (чужой хост, шаблоны
   * include/exclude, maxDepth), пробелом НЕ считается — см. isDeliberatelyUncrawled.
   */
  | 'unreached-url';

const gapCache = new WeakMap<CrawlResult, LinkGraphGap | null>();

/**
 * Пробел зависит только от обхода, поэтому считается один раз на CrawlResult:
 * его спрашивает и site-правило (однажды), и page-правило TECH-010 — у каждой
 * страницы, а «есть ли среди 50 тысяч страниц недочитанная» сама по себе задача
 * на весь набор.
 */
export function linkGraphGap(ctx: SiteContext): LinkGraphGap | null {
  const { crawl } = ctx;
  if (gapCache.has(crawl)) {
    return gapCache.get(crawl) ?? null;
  }
  const gap = computeLinkGraphGap(crawl);
  gapCache.set(crawl, gap);
  return gap;
}

/**
 * Последний из пробелов — внутренняя ссылка, о судьбе которой обход молчит,
 * хотя обещал её пройти.
 *
 * Сравнение идёт по ключу обхода и по фильтрам обхода (crawl.scope), поэтому
 * «пробел» здесь означает ровно одно: адрес, который краулер поставил бы в
 * очередь, нигде в его отчёте не появился. Это страховка от расхождения правил
 * с краулером, а не отчёт об области: всё, что scope отбрасывает сам,
 * отсеивается раньше (isDeliberatelyUncrawled).
 */
function computeLinkGraphGap(crawl: CrawlResult): LinkGraphGap | null {
  if (crawl.skippedOverLimit.length > 0) {
    return 'page-limit';
  }
  if (crawl.stoppedEarly || crawl.pendingQueue.length > 0) {
    return 'stopped';
  }
  if (crawl.errors.length > 0 || crawl.pages.some((page) => page.fetchError !== undefined)) {
    return 'unread-page';
  }
  const accounted = accountedUrls(crawl);
  // Хост origin-а разбирается один раз на обход, а не на каждую ссылку каждой
  // страницы: на сайте в 50 тысяч страниц это миллионы разборов URL. Origin,
  // который не разбирается вовсе, краулер и не обходил — тогда ни один адрес
  // пробелом не считается.
  const originHostname = hostnameOf(crawl.scope.origin);
  if (originHostname === null) {
    return null;
  }
  // Ссылки читаются ровно у тех страниц, у которых их читают правила
  // (linkSourcePages): адрес, на который ссылается чужая страница, уведшая
  // редиректом за область, обход и не обещал читать — а пробел погасил бы все
  // три правила на целом сайте.
  const unreached = linkSourcePages(crawl).some((page) =>
    pageLinks(page, crawl).some(
      (link) =>
        !accounted.has(link.crawlTarget) &&
        !isDeliberatelyUncrawled(crawl.scope, originHostname, link.crawlTarget, page.depth + 1),
    ),
  );
  return unreached ? 'unreached-url' : null;
}

/**
 * Адрес, который обход и не собирался читать, — решение области, а не пробел.
 *
 * Три причины, и все три — выбор владельца, записанный в scope:
 *  • чужой хост (включая свой поддомен при includeSubdomains=false): обход туда
 *    не ходит, и требовать от него blog.example.com значило бы молчать на каждом
 *    сайте с поддоменом. Проверка по хосту, а не по origin: http- и https-форма
 *    одного хоста для scope краулера — одна область (isHostInScope);
 *  • pathname, отброшенный шаблонами include/exclude;
 *  • ссылка глубже maxDepth: краулер отбрасывает её при постановке в очередь
 *    (enqueue), и глубина ссылки — это глубина несущей её страницы + 1. Очередь
 *    обхода — BFS, поэтому первый раз адрес обнаруживается на своей минимальной
 *    глубине: «глубже maxDepth хотя бы на этой странице» и есть «глубже
 *    maxDepth вообще».
 *
 * Считать такой адрес пробелом означало бы гасить TECH-009/010/011 на любом
 * сайте, у которого есть ссылка на шаг глубже maxDepth (в профиле по умолчанию
 * maxDepth = 5) — то есть почти на каждом, и молча. Цена решения честна и
 * названа в самой находке: её evidence говорит «ни одна из N ПРОЧИТАННЫХ
 * страниц не ссылается», а не «на странице нет ссылок вообще». Пробелом
 * остаётся только то, что обход читать СОБИРАЛСЯ и не прочитал: лимит тарифа,
 * пауза, упавшая страница — там неизвестна не область, а сам ответ сайта.
 */
function isDeliberatelyUncrawled(
  scope: CrawlScope,
  originHostname: string,
  url: string,
  linkDepth: number,
): boolean {
  if (scope.maxDepth !== undefined && linkDepth > scope.maxDepth) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true; // адрес, который краулер и разобрать бы не смог, он не просил
  }
  return (
    !isHostInScope(parsed.hostname, originHostname, scope.includeSubdomains) ||
    !isPathnameAllowedByPatterns(parsed.pathname, scope)
  );
}

/**
 * URL-ы, о которых обход что-то сказал: снимок, лимит, robots.txt или ошибка.
 *
 * finalUrl снимка входит наравне с запрошенным: страницу, на которую вёл
 * redirect, обход прочитал (markFinalUrlSeen), и ссылка прямо на неё пробелом
 * не является.
 */
function accountedUrls(crawl: CrawlResult): ReadonlySet<string> {
  const accounted = new Set<string>([
    ...crawl.skippedOverLimit,
    ...crawl.blockedByRobots,
    ...crawl.errors.map((error) => error.url),
  ]);
  for (const page of crawl.pages) {
    accounted.add(page.normalizedUrl);
    const final = crawlKey(page.finalUrl, page.finalUrl, crawl.scope);
    if (final !== null) {
      accounted.add(final);
    }
  }
  return accounted;
}
