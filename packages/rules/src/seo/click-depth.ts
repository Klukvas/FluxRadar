// Глубина клика: BFS от точки входа по ссылкам, которые правило действительно
// прочитало. Спрашивает SEO-TECH-010; результат кэшируется на CrawlResult и
// набор точек входа, потому что обход у правил один на весь прогон.

import type { CrawlResult } from '@fluxradar/crawler';

import type { SiteContext } from '../engine/types.js';
import { leftCrawlScope } from './crawl-scope.js';
import {
  addressAliases,
  entryPageUrls,
  linkSourcePages,
  pageLinks,
  redirectAliases,
  snapshotByNormalizedUrl,
} from './site-index.js';

const clickDepthCache = new WeakMap<CrawlResult, Map<string, ReadonlyMap<string, number>>>();

/**
 * Глубина клика каждой страницы от точки входа — BFS по прочитанным ссылкам.
 *
 * Считает правило, а не обход: depth снимка это длина пути от БЛИЖАЙШЕГО seed-а
 * обхода, а seed-ом служит и каждый URL из sitemap (crawler.ts enqueue(url, 1)).
 * На сайте, чей sitemap перечисляет все страницы, такая глубина всегда ≤ 1 и о
 * навигации не говорит ничего. Здесь же корень ровно один — точка входа, — и
 * рёбра только те, которые правило действительно прочитало.
 *
 * КЛЮЧ КАРТЫ — АДРЕС ДОКУМЕНТА, и под ним же лежит глубина каждого его снимка.
 * Редирект прозрачен: ссылка на `/about` ведёт к странице `/about/`
 * (redirectAliases), поэтому переход считается один раз, а не дважды, и
 * спросить о странице можно любой из двух форм. Иначе документ, чей снимок обход
 * держит только под `/about`, оставался бы без глубины ровно тогда, когда сайт
 * ссылается на него написанным адресом назначения, — а TECH-010 всё равно
 * называет такую страницу проверенной: он объявил бы её измеренной, ничего не
 * измерив, и прошлая находка о всё ещё глубокой странице закрылась бы как
 * исправленная (§14). ИНВАРИАНТ: страница, попавшая в checkedTargets TECH-010,
 * либо получила здесь глубину, либо до неё действительно не дойти ссылками —
 * если у её адреса есть источник с глубиной, глубина обязана быть и у неё.
 *
 * Страница, до которой от точки входа ссылками не дойти, в карте отсутствует: у
 * неё нет глубины, а не «глубина большая» — это предмет TECH-009, а не TECH-010.
 *
 * Снимок, уехавший редиректом за область обхода, глубины не получает и ссылок
 * не отдаёт (leftCrawlScope): «эта страница в четырёх переходах от вашей
 * главной» о чужом сайте — утверждение не о навигации владельца, а о чужой.
 */
export function clickDepthsFromEntry(ctx: SiteContext): ReadonlyMap<string, number> {
  const { crawl } = ctx;
  const entryUrls = entryPageUrls(ctx);
  const entryKey = [...entryUrls].sort().join(' ');
  const byEntry = clickDepthCache.get(crawl) ?? new Map<string, ReadonlyMap<string, number>>();
  const cached = byEntry.get(entryKey);
  if (cached !== undefined) {
    return cached;
  }
  const depths = breadthFirstDepths(crawl, entryUrls);
  byEntry.set(entryKey, depths);
  clickDepthCache.set(crawl, byEntry);
  return depths;
}

function breadthFirstDepths(
  crawl: CrawlResult,
  entryUrls: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const snapshots = snapshotByNormalizedUrl(crawl);
  const aliases = redirectAliases(crawl);
  const aliasesByAddress = addressAliases(crawl);
  const linkSources = new Set(linkSourcePages(crawl).map((page) => page.normalizedUrl));
  const depths = new Map<string, number>();
  const queue: string[] = [];

  /**
   * Снимки, которыми обход держит документ по этому адресу: свой снимок адреса
   * и адреса, уводящие на него редиректом. Чужая страница не представляет
   * документ сайта, поэтому редирект за область обхода отсеян.
   */
  const snapshotsOfAddress = (address: string): readonly string[] =>
    [...(snapshots.has(address) ? [address] : []), ...(aliasesByAddress.get(address) ?? [])].filter(
      (key) => {
        const snapshot = snapshots.get(key);
        return snapshot !== undefined && !leftCrawlScope(snapshot, crawl);
      },
    );

  /** Дойти до документа по адресу target за depth переходов. */
  const reach = (target: string | undefined, depth: number): void => {
    if (target === undefined) {
      return;
    }
    const address = aliases.get(target) ?? target;
    if (depths.has(address)) {
      return;
    }
    const keys = snapshotsOfAddress(address);
    if (keys.length === 0) {
      return; // адрес, которого обход не читал, либо страница чужого сайта
    }
    depths.set(address, depth);
    // Оба конца пути называются адресом документа, но спросить о глубине вправе
    // и держатель снимка (TECH-010 судит снимки), поэтому ключей столько же,
    // сколько адресов у документа. Ссылки читает каждый снимок: у второго
    // адреса они те же, а вот источником ссылок бывает не всякий (404 по адресу
    // назначения при живом редиректе на него).
    for (const key of keys) {
      depths.set(key, depth);
      queue.push(key);
    }
  };

  for (const entry of entryUrls) {
    reach(entry, 0);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    // Ссылки отдаёт только страница самого сайта: непрочитанная не отдаёт их
    // вовсе, а уехавшая за область обхода — не свои (linkSourcePages).
    const page =
      current === undefined || !linkSources.has(current) ? undefined : snapshots.get(current);
    if (current === undefined || page === undefined) {
      continue;
    }
    const depth = depths.get(current) ?? 0;
    for (const link of pageLinks(page, crawl)) {
      reach(link.crawlTarget, depth + 1);
    }
  }
  return depths;
}
