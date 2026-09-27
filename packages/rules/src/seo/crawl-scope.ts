// Область обхода с точки зрения правил графа ссылок: единственный вопрос этого
// файла — «эта прочитанная страница вообще принадлежит сайту, о котором мы
// судим». Его спрашивают site-index.ts (кто кандидат и чьи ссылки считаются
// ссылками сайта) и link-graph-gap.ts (чей адрес считается пробелом).

import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';
import { isHostInScope } from '@fluxradar/crawler';

/** Hostname адреса, либо null, если он не разбирается как URL. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const offScopeCache = new WeakMap<CrawlResult, ReadonlySet<string>>();

/**
 * Уехал ли снимок редиректом за пределы области обхода.
 *
 * Редирект на чужой хост краулер проходит (safe-fetch перепроверяет каждый
 * Location только на SSRF) и снимок сохраняет: redirectChain — это evidence
 * SEO-TECH-005. Но страницей САЙТА этот документ не становится, и сам краулер
 * ссылок с него не берёт (crawler.ts mayUseAsLinkSource, план §25). Правила
 * графа обязаны видеть то же самое: иначе `/go`, отвечающий 302 на
 * https://partner.example/landing, приходит в отчёт как «страницу держит одна
 * ссылка» — утверждение о чужом сайте, — а ссылки чужой страницы засчитываются
 * сайту как его собственные. Под производственным includeSubdomains = false
 * обычная форма этого — `/blog` → https://blog.example.com/.
 *
 * Считается один раз на обход: спрашивают и про каждую страницу, и про каждую
 * цель ссылки, а разбор URL на сайте в 50 тысяч страниц стоит миллионы разборов.
 */
export function leftCrawlScope(page: PageSnapshot, crawl: CrawlResult): boolean {
  return offScopeSnapshots(crawl).has(page.normalizedUrl);
}

function offScopeSnapshots(crawl: CrawlResult): ReadonlySet<string> {
  const cached = offScopeCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const originHostname = hostnameOf(crawl.scope.origin);
  // Обход, чей origin не разбирается, не состоялся вовсе: объявить его страницы
  // чужими значило бы молча погасить все правила графа.
  const offScope = new Set(
    originHostname === null
      ? []
      : crawl.pages
          .filter((page) => !staysInScope(page, originHostname, crawl))
          .map((page) => page.normalizedUrl),
  );
  offScopeCache.set(crawl, offScope);
  return offScope;
}

function staysInScope(page: PageSnapshot, originHostname: string, crawl: CrawlResult): boolean {
  const finalHostname = hostnameOf(page.finalUrl);
  if (finalHostname === null) {
    return true; // ненормализуемый finalUrl — не доказательство ухода за область
  }
  return isHostInScope(finalHostname, originHostname, crawl.scope.includeSubdomains);
}
