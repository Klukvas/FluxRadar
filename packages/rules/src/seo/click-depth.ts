// Глубина клика: BFS от точки входа по ссылкам, которые правило действительно
// прочитало. Спрашивает SEO-TECH-010; результат кэшируется на CrawlResult и
// набор точек входа, потому что обход у правил один на весь прогон.

import type { CrawlResult } from '@fluxradar/crawler';

import type { SiteContext } from '../engine/types.js';
import { leftCrawlScope } from './crawl-scope.js';
import {
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
 * Редирект прозрачен: ссылка на `/about` ведёт к странице `/about/`
 * (redirectAliases), поэтому переход считается один раз, а не дважды. Страница,
 * до которой от точки входа ссылками не дойти, в карте отсутствует: у неё нет
 * глубины, а не «глубина большая» — это предмет TECH-009, а не TECH-010.
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
  const linkSources = new Set(linkSourcePages(crawl).map((page) => page.normalizedUrl));
  const depths = new Map<string, number>();
  const queue: string[] = [];
  for (const entry of entryUrls) {
    if (snapshots.has(entry)) {
      depths.set(entry, 0);
      queue.push(entry);
    }
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
    // Обе формы адреса проходят по очереди, а не через временный массив на
    // каждую ссылку: снимок у обхода бывает под любой из них, а ссылок на
    // сайте столько же, сколько строк в его разметке.
    const visit = (target: string | undefined): void => {
      if (target === undefined || depths.has(target)) {
        return;
      }
      const snapshot = snapshots.get(target);
      if (snapshot === undefined || leftCrawlScope(snapshot, crawl)) {
        return;
      }
      depths.set(target, depth + 1);
      queue.push(target);
    };
    for (const link of pageLinks(page, crawl)) {
      visit(link.crawlTarget);
      visit(aliases.get(link.crawlTarget));
    }
  }
  return depths;
}
