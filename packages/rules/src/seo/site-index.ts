// Индексы уровня обхода для правил, которым нужен контекст всего сайта
// (TECH-006 битые ссылки, TECH-008 противоречие noindex, TECH-009/010/011
// перелинковка). Строятся один раз на CrawlResult (WeakMap-кэш) — правила
// остаются чистыми функциями от ctx.
//
// Ключ адреса здесь тот же, что у обхода: сначала queryPolicy, потом
// normalizeUrl v1 (crawlKey). Правило, нормализующее ссылку иначе, чем краулер,
// спрашивает его о несуществующем адресе: под queryPolicy 'ignore' (default
// профиля) ссылка `/p?page=2` ведёт на прочитанную страницу `/p`, а не в
// пустоту.

import type { CrawlResult, CrawlScope, PageSnapshot } from '@fluxradar/crawler';
import { applyQueryPolicy, isCloudflareEmailObfuscationUrl } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import type { SiteContext } from '../engine/types.js';
import { hasHttpResponse, isSuccessfulHtmlPage } from '../engine/types.js';
import { leftCrawlScope } from './crawl-scope.js';
import { parsePage } from './dom.js';

export interface PageLink {
  /** href как он записан в разметке (селектор для evidence). */
  readonly rawHref: string;
  /** Абсолютный нормализованный target (normalizeUrl v1), как написан в разметке. */
  readonly normalizedTarget: string;
  /**
   * Тот же target под ключом дедупа обхода: query-политика применена.
   *
   * Отличается от normalizedTarget только при queryPolicy 'ignore', и тогда
   * именно этот ключ совпадает с normalizedUrl снимков. Оба поля нужны рядом:
   * вердикт о СТРАНИЦЕ (TECH-008/009/010/011) выносится по ключу обхода, а
   * вердикт о самой ССЫЛКЕ (TECH-006 «ссылка ведёт на 404») — по адресу, как он
   * написан в разметке, потому что снимок `/p` о статусе `/p?page=2` не
   * свидетельствует (D-152).
   */
  readonly crawlTarget: string;
}

/**
 * Кэш ссылок: сначала обход, потом снимок.
 *
 * Ключ обхода нельзя кэшировать на одном снимке: crawlTarget зависит от
 * queryPolicy ОБХОДА, и снимок, прочитанный сначала правилом одного прогона, а
 * потом правилом другого, отдал бы второму ключи первого.
 */
const pageLinksCache = new WeakMap<CrawlResult, WeakMap<PageSnapshot, readonly PageLink[]>>();

/**
 * <a href> страницы: разрешение против finalUrl; мусор и не-http(s) отброшены.
 * Кэш на снимок: результат нужен и TECH-006 (по страницам), и TECH-008/009/011
 * (через internalLinkSources) — извлекаем и нормализуем один раз.
 */
export function pageLinks(page: PageSnapshot, crawl: CrawlResult): readonly PageLink[] {
  const byPage = pageLinksCache.get(crawl) ?? new WeakMap<PageSnapshot, readonly PageLink[]>();
  const cached = byPage.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const links = parsePage(page)
    .querySelectorAll('a')
    .map((anchor) => anchor.getAttribute('href')?.trim())
    .filter((href): href is string => href !== undefined && href !== '')
    .map((rawHref) => toPageLink(rawHref, page.finalUrl, crawl.scope))
    .filter((link): link is PageLink => link !== null);
  byPage.set(page, links);
  pageLinksCache.set(crawl, byPage);
  return links;
}

function toPageLink(rawHref: string, baseUrl: string, scope: CrawlScope): PageLink | null {
  let resolved: URL;
  try {
    resolved = new URL(rawHref, baseUrl);
  } catch {
    return null; // мусорный href — штатный веб, не ссылка сайта
  }
  // Cloudflare подменяет защищённый email ссылкой на свой endpoint и
  // разворачивает её hex-хвост в mailto: уже в браузере
  // (isCloudflareEmailObfuscationUrl): страницей сайта такой адрес не бывает, и
  // ссылкой — тоже. Отброшен он ЗДЕСЬ, а не только в обходе, потому что снимок
  // endpoint-а у прогона уже может быть — его ставил в очередь прежний краулер,
  // его мог перечислить sitemap, — и тогда SEO-TECH-006 показывал бы чужой 404
  // на каждой странице, которая прячет за ним адрес почты.
  if (isCloudflareEmailObfuscationUrl(resolved)) {
    return null;
  }
  const normalizedTarget = resolveAndNormalize(rawHref, baseUrl);
  if (normalizedTarget === null) {
    return null;
  }
  const crawlTarget = crawlKey(rawHref, baseUrl, scope) ?? normalizedTarget;
  return { rawHref, normalizedTarget, crawlTarget };
}

const snapshotIndexCache = new WeakMap<CrawlResult, ReadonlyMap<string, PageSnapshot>>();

/** normalizedUrl → снимок обхода (первый выигрывает — краулер дедупит сам). */
export function snapshotByNormalizedUrl(crawl: CrawlResult): ReadonlyMap<string, PageSnapshot> {
  const cached = snapshotIndexCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map<string, PageSnapshot>();
  for (const page of crawl.pages) {
    if (!index.has(page.normalizedUrl)) {
      index.set(page.normalizedUrl, page);
    }
  }
  snapshotIndexCache.set(crawl, index);
  return index;
}

const aliasCache = new WeakMap<CrawlResult, ReadonlyMap<string, string>>();

/**
 * Запрошенный адрес → адрес, по которому страница на самом деле живёт.
 *
 * Редирект — это заявление сайта «эта страница здесь»: ссылка на `/about`,
 * отвечающий 301 на `/about/`, ведёт на страницу `/about/`. Без этой карты
 * правила графа считают входящие ссылки по буквальному адресу и получают две
 * ложные картины: страница-цель редиректа выглядит orphan-ом, а сам адрес
 * редиректа — страницей, которую держит одна ссылка.
 */
export function redirectAliases(crawl: CrawlResult): ReadonlyMap<string, string> {
  const cached = aliasCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const aliases = new Map<string, string>();
  for (const page of crawl.pages) {
    const final = crawlKey(page.finalUrl, page.finalUrl, crawl.scope);
    if (final !== null && final !== page.normalizedUrl) {
      aliases.set(page.normalizedUrl, final);
    }
  }
  aliasCache.set(crawl, aliases);
  return aliases;
}

/**
 * Адрес, под которым в графе ссылок живёт документ по этому адресу.
 *
 * Редирект — это заявление сайта «страница здесь», поэтому и цель ссылки, и
 * страница-источник приводятся к адресу назначения. Один документ обход держит
 * под двумя ключами всякий раз, когда sitemap перечисляет `/p/`, а навигация
 * ссылается на `/p`: краулер ставит `/p` в очередь (в `seen` лежит только
 * `/p/`) и получает второй снимок через 301. Без приведения обоих концов такой
 * документ считался бы двумя разными источниками ссылки, а собственный адрес
 * страницы — ссылкой на неё саму.
 *
 * Один переход, а не цепочка: finalUrl снимка — уже конец цепочки редиректов
 * (safe-fetch проходит её целиком), поэтому у адреса назначения своего
 * назначения не бывает. Итерация здесь добавила бы только шанс зациклиться на
 * ручной фикстуре, которой обход соответствовать не обязан.
 */
export function canonicalAddress(crawl: CrawlResult, url: string): string {
  return redirectAliases(crawl).get(url) ?? url;
}

const addressAliasCache = new WeakMap<CrawlResult, ReadonlyMap<string, readonly string[]>>();

/**
 * Обратный индекс к redirectAliases: адрес, по которому живёт документ →
 * запрошенные адреса, уводящие на него редиректом.
 *
 * Нужен там, где ответ ищут по адресу НАЗНАЧЕНИЯ, а снимок у обхода есть только
 * под запрошенным: sitemap перечисляет `/about`, навигация ссылается на
 * `/about/`, и второго снимка не бывает вовсе (markFinalUrlSeen). Спросить
 * «что обход знает о странице /about/» иначе нечем, и правило, спросившее
 * только snapshotByNormalizedUrl, получило бы «ничего».
 *
 * Порядок адресов — лексикографический: он определяет, какой снимок обходят
 * первым, и зависеть от порядка очереди краулера не вправе.
 */
export function addressAliases(crawl: CrawlResult): ReadonlyMap<string, readonly string[]> {
  const cached = addressAliasCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const byAddress = new Map<string, string[]>();
  for (const [requested, address] of redirectAliases(crawl)) {
    const existing = byAddress.get(address);
    if (existing === undefined) {
      byAddress.set(address, [requested]);
      continue;
    }
    existing.push(requested);
  }
  for (const requested of byAddress.values()) {
    requested.sort((left, right) => left.localeCompare(right));
  }
  addressAliasCache.set(crawl, byAddress);
  return byAddress;
}

const linkSourcesCache = new WeakMap<CrawlResult, ReadonlyMap<string, ReadonlySet<string>>>();

/**
 * Адрес страницы → адреса страниц (2xx HTML), ссылающихся на неё.
 *
 * Оба конца каждой ссылки приведены к адресу документа (canonicalAddress), и
 * ссылка засчитывается ровно один раз: для вопроса «сколько ссылок держит
 * страницу» `/p` и `/p/` — один документ, и спросить о нём вправе как правило,
 * судящее адрес из sitemap, так и правило, судящее прочитанный снимок.
 *
 * Источники — ровно linkSourcePages: страница, уехавшая редиректом за область
 * обхода, ссылок сайту не даёт, потому что и краулер их с неё не берёт.
 */
export function internalLinkSources(crawl: CrawlResult): ReadonlyMap<string, ReadonlySet<string>> {
  const cached = linkSourcesCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const sources = new Map<string, Set<string>>();
  const credit = (target: string, source: string): void => {
    const existing = sources.get(target);
    if (existing === undefined) {
      sources.set(target, new Set([source]));
      return;
    }
    existing.add(source);
  };
  for (const page of linkSourcePages(crawl)) {
    const source = canonicalAddress(crawl, page.normalizedUrl);
    for (const link of pageLinks(page, crawl)) {
      credit(canonicalAddress(crawl, link.crawlTarget), source);
    }
  }
  linkSourcesCache.set(crawl, sources);
  return sources;
}

const sitemapUrlsCache = new WeakMap<CrawlResult, ReadonlySet<string>>();

/** URL из sitemap-seed-ов обхода под ключом обхода (queryPolicy применена). */
export function sitemapNormalizedUrls(crawl: CrawlResult): ReadonlySet<string> {
  const cached = sitemapUrlsCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = new Set(
    crawl.sitemapUrls
      .map((url) => crawlKey(url, url, crawl.scope))
      .filter((url): url is string => url !== null),
  );
  sitemapUrlsCache.set(crawl, normalized);
  return normalized;
}

/**
 * Все снимки обхода, которые правило может спросить о чужом URL.
 *
 * Это входы CONTENT-004: любой снимок media — вердикт (transport-сбой,
 * 4xx/5xx, HTML вместо картинки), а его отсутствие означает «не проверяли».
 * Пропавший снимок делает находку невидимой, ничего не починив, поэтому
 * политика Resolved сравнивает именно этот набор (§14,
 * RuleEvaluation.inputTargets).
 */
export function crawledTargets(crawl: CrawlResult): readonly string[] {
  return [...snapshotByNormalizedUrl(crawl).keys()];
}

/**
 * Снимки, на которые получен HTTP-ответ.
 *
 * Входы SEO-TECH-006: «ссылка битая» это вывод из статуса цели, и снимок с
 * transport-сбоем говорит о ней ровно столько же, сколько отсутствующий —
 * ничего (D-152). Поэтому такая цель входом не считается, и прогон, у которого
 * она перестала отвечать, прошлую находку не закрывает.
 */
export function respondingTargets(crawl: CrawlResult): readonly string[] {
  return [...snapshotByNormalizedUrl(crawl).values()]
    .filter((page) => hasHttpResponse(page))
    .map((page) => page.normalizedUrl);
}

/**
 * Все цели внутренних ссылок, о которых правило спрашивало обход.
 *
 * Это спрос SEO-TECH-006: правило смотрит снимок КАЖДОЙ ссылки загруженных
 * страниц. Цель, которой здесь больше нет, сайтом больше не упоминается — и
 * прошлая находка о ней говорит об удалённой ссылке, а не о потерянном снимке
 * (§14, RuleEvaluation.requestedInputs).
 */
export function linkTargets(crawl: CrawlResult): readonly string[] {
  return [
    ...new Set(
      crawl.pages
        .filter((page) => isSuccessfulHtmlPage(page))
        .flatMap((page) => pageLinks(page, crawl).map((link) => link.normalizedTarget)),
    ),
  ];
}

/**
 * Все URL, которые обход вообще увидел: загруженные, не влезшие в лимит,
 * закрытые robots.txt, упавшие с ошибкой и пришедшие из sitemap.
 *
 * Это спрос правил, чей вердикт строится на наборе страниц (SEO-TECH-007,
 * SEO-TECH-008): страница, которой здесь нет, больше не существует для сайта —
 * ни ссылки, ни sitemap на неё не ведут. А страница, которая здесь есть, но
 * снимка не получила, — потерянные данные, и находку закрывать нельзя.
 *
 * Адрес назначения редиректа входит наравне с запрошенным: обход прочитал
 * страницу именно там, и правила графа называют её именно так
 * (canonicalAddress). Спрос обязан оставаться надмножеством входов — иначе
 * вход, названный адресом документа, выглядел бы снятым сайтом, и находка
 * закрывалась бы без доказательства.
 */
export function discoveredTargets(crawl: CrawlResult): readonly string[] {
  return [
    ...new Set([
      ...crawl.pages.map((page) => page.normalizedUrl),
      ...redirectAliases(crawl).values(),
      ...crawl.skippedOverLimit,
      ...crawl.blockedByRobots,
      ...crawl.errors.map((error) => error.url),
      ...sitemapNormalizedUrls(crawl),
    ]),
  ];
}

/**
 * Псевдо-вход «sitemap обхода прочитан».
 *
 * У SEO-TECH-008 sitemap — источник, а не наблюдение: если прогон его прочитал,
 * то исчезновение страницы из sitemap — настоящая починка противоречия. А вот
 * прогон, не нашедший sitemap вовсе, о нём ничего не доказывает.
 */
export const SITEMAP_INPUT = 'sitemap:read';

function resolveAndNormalize(href: string, baseUrl: string): string | null {
  try {
    return normalizeUrl(new URL(href, baseUrl).href);
  } catch {
    return null; // не-http(s) схема, userinfo и прочий мусор веба — не target
  }
}

/** Ключ, под которым обход дедупил бы этот адрес: queryPolicy → normalizeUrl. */
export function crawlKey(href: string, baseUrl: string, scope: CrawlScope): string | null {
  try {
    return normalizeUrl(applyQueryPolicy(new URL(href, baseUrl), scope.queryPolicy).href);
  } catch {
    return null;
  }
}

/**
 * Адреса точки входа обхода: запрошенный и тот, на который он уводит редиректом.
 *
 * Её входящие ссылки ничего не говорят о доступности, поэтому ни TECH-009, ни
 * TECH-011 о ней не судят: «на главную никто не ссылается» — утверждение о
 * навигации сайта, а не о том, что страницу нельзя найти. Берётся именно
 * ctx.origin, а не всякая страница глубины 0: явный seed владельца говорит, как
 * МЫ нашли страницу, а не как на неё ссылается сайт. Адрес назначения редиректа
 * исключается вместе с ним: `https://site/` → `https://site/en/` это одна
 * страница, и судить её под вторым именем значило бы объявить главную orphan-ом.
 */
export function entryPageUrls(ctx: SiteContext): ReadonlySet<string> {
  const entry = normalizeUrl(ctx.origin);
  const requested = crawlKey(entry, entry, ctx.crawl.scope) ?? entry;
  const alias = redirectAliases(ctx.crawl).get(requested);
  return new Set(alias === undefined ? [requested] : [requested, alias]);
}

/**
 * Страницы sitemap, о которых правило вообще вправе судить.
 *
 * Только успешно загруженный HTML: URL из sitemap, отдавший 404, — предмет
 * SEO-TECH-003, а не разговора о перелинковке. URL, уехавший редиректом на
 * другой адрес, тоже не кандидат: страница живёт по адресу назначения, ссылки
 * ведут туда же, и «на этот URL никто не ссылается» сказало бы о содержимом
 * sitemap (SEO-TECH-005), а не о доступности страницы.
 *
 * Именно поэтому здесь isOwnAddress, а не isJudgeablePage: снимок, судимый под
 * адресом назначения, для TECH-011 — та же страница, а для TECH-009 — другая
 * запись sitemap. Его evidence называет адрес из sitemap, и сказать о
 * нём «sitemap перечисляет /about/» было бы неправдой: sitemap перечисляет
 * /about, а это уже находка SEO-TECH-005.
 *
 * Отсюда же следует, что у кандидата TECH-009 canonicalAddress всегда равен его
 * собственному адресу: судить под адресом назначения тут нечего, и раздвоить
 * личность находки между прогонами (как это было у TECH-011) невозможно.
 *
 * Порядок — по normalizedUrl, чтобы набор findings не зависел от порядка
 * очереди обхода.
 */
export function sitemapPages(crawl: CrawlResult): readonly PageSnapshot[] {
  const sitemap = sitemapNormalizedUrls(crawl);
  const snapshots = snapshotByNormalizedUrl(crawl);
  return [...sitemap]
    .map((url) => snapshots.get(url))
    .filter((page): page is PageSnapshot => page !== undefined && isOwnAddress(page, crawl))
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl));
}

/** Снимок 2xx HTML, отданный по самому запрошенному адресу, а не через редирект. */
export function isOwnAddress(page: PageSnapshot, crawl: CrawlResult): boolean {
  return isSuccessfulHtmlPage(page) && !redirectAliases(crawl).has(page.normalizedUrl);
}

/**
 * Снимок, о СТРАНИЦЕ которого правило графа вправе судить, и под каким адресом.
 *
 * Обычный случай — снимок по своему адресу (isOwnAddress). Но на сайте без
 * sitemap, чья навигация ссылается на `/about`, а сервер уводит на `/about/`,
 * второго снимка не бывает вовсе: краулер помечает адрес назначения
 * прочитанным (markFinalUrlSeen) и отдельно его не запрашивает. Такой снимок —
 * единственное, что обход знает о странице, и молчать о ней значило бы не
 * судить о целом классе сайтов. Поэтому он судится под адресом назначения — и
 * только пока своего снимка у назначения нет: иначе один документ получил бы
 * вердикт дважды.
 *
 * И только пока назначение лежит В ОБЛАСТИ обхода: редирект на чужой хост
 * оставляет снимок чужой страницы (leftCrawlScope), а «страницу держит одна
 * ссылка» о ней было бы утверждением о чужом сайте.
 */
export function isJudgeablePage(page: PageSnapshot, crawl: CrawlResult): boolean {
  if (!isSuccessfulHtmlPage(page) || leftCrawlScope(page, crawl)) {
    return false;
  }
  const alias = redirectAliases(crawl).get(page.normalizedUrl);
  return alias === undefined || !snapshotByNormalizedUrl(crawl).has(alias);
}

const addressJudgeCache = new WeakMap<CrawlResult, ReadonlySet<PageSnapshot>>();

/**
 * По одному снимку на адрес документа: тот, кто о СТРАНИЦЕ и судит.
 *
 * Два запрошенных адреса могут вести на один и тот же отдельно не прочитанный
 * документ (`/deep` и `/deep.html` → `/deep/`), и оба снимка судимы под адресом
 * назначения (isJudgeablePage). Вердикт такой документ получает один: иначе
 * одна страница пришла бы в отчёт дважды под одним именем, а знаменатель
 * правила («N страниц проверено») посчитал бы снимки вместо страниц.
 *
 * Судит лексикографически первый адрес — и Set сохраняет именно этот порядок,
 * поэтому набор findings не зависит от порядка очереди обхода.
 */
export function addressJudges(crawl: CrawlResult): ReadonlySet<PageSnapshot> {
  const cached = addressJudgeCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const judgedAddresses = new Set<string>();
  const judges = new Set<PageSnapshot>();
  for (const page of [...linkSourcePages(crawl)].sort((left, right) =>
    left.normalizedUrl.localeCompare(right.normalizedUrl),
  )) {
    const address = canonicalAddress(crawl, page.normalizedUrl);
    if (!isJudgeablePage(page, crawl) || judgedAddresses.has(address)) {
      continue;
    }
    judgedAddresses.add(address);
    judges.add(page);
  }
  addressJudgeCache.set(crawl, judges);
  return judges;
}

/** Этот ли снимок судит свой адрес документа (addressJudges). */
export function judgesPageAddress(page: PageSnapshot, crawl: CrawlResult): boolean {
  return addressJudges(crawl).has(page);
}

const linkSourcePagesCache = new WeakMap<CrawlResult, readonly PageSnapshot[]>();

/**
 * Страницы обхода, чьи ссылки правило прочитало (и на которых строит вердикт).
 *
 * Это же множество — вход internalLinkSources, поэтому оба правила графа
 * называют входами ровно его.
 *
 * Страница, уехавшая редиректом за область обхода, источником не считается:
 * краулер её ссылок не извлекает (mayUseAsLinkSource), и правило, читающее их
 * как ссылки сайта, приписало бы сайту чужую навигацию — а заодно объявило бы
 * пробелом в графе каждый адрес, на который чужая страница ссылается.
 *
 * Кэш на обход: набор спрашивают и на каждую страницу (inputTargets TECH-010),
 * и на каждую цель ссылки, а фильтр разбирает finalUrl каждого снимка.
 */
export function linkSourcePages(crawl: CrawlResult): readonly PageSnapshot[] {
  const cached = linkSourcePagesCache.get(crawl);
  if (cached !== undefined) {
    return cached;
  }
  const pages = crawl.pages.filter(
    (page) => isSuccessfulHtmlPage(page) && !leftCrawlScope(page, crawl),
  );
  linkSourcePagesCache.set(crawl, pages);
  return pages;
}

/**
 * Те же страницы под адресами документов: два снимка одной страницы (`/p` и
 * `/p/`) — один источник ссылок и один вход правила.
 *
 * Отсюда берутся и inputTargets правил графа, и число в evidence TECH-009
 * («ни одна из N прочитанных страниц»): счёт источников и счёт, названный
 * читателю, обязаны считать одно и то же.
 */
export function linkSourceAddresses(crawl: CrawlResult): readonly string[] {
  return [
    ...new Set(linkSourcePages(crawl).map((page) => canonicalAddress(crawl, page.normalizedUrl))),
  ];
}

const NO_SOURCES: ReadonlySet<string> = new Set<string>();

/**
 * ЧУЖИЕ страницы обхода, ссылающиеся на цель: ссылка страницы на саму себя —
 * не входящая ссылка, и ею не становится, если написана вторым адресом того же
 * документа (`/p/` ссылается на `/p`).
 *
 * Единственное место, где «свой» и «чужой» источник различаются: и счётчик
 * TECH-009/011, и противоречие TECH-008 спрашивают именно об этом наборе.
 */
export function inboundSources(crawl: CrawlResult, target: string): ReadonlySet<string> {
  const address = canonicalAddress(crawl, target);
  const sources = internalLinkSources(crawl).get(address);
  if (sources === undefined) {
    return NO_SOURCES;
  }
  if (!sources.has(address)) {
    return sources;
  }
  return new Set([...sources].filter((source) => source !== address));
}

/**
 * Сколько ЧУЖИХ страниц обхода ссылается на цель.
 *
 * Оба правила графа спрашивают о размере, а не о списке: на сайте в 50 тысяч
 * страниц навигационная цель собирает десятки тысяч источников, и копировать их
 * в массив ради `.length` значило бы строить такой массив на каждую страницу —
 * поэтому набор копируется только там, где документ ссылается сам на себя.
 */
export function inboundSourceCount(crawl: CrawlResult, target: string): number {
  return inboundSources(crawl, target).size;
}

/** Единственная чужая страница-источник, либо null, если их не ровно одна. */
export function soleInboundSource(crawl: CrawlResult, target: string): string | null {
  const sources = inboundSources(crawl, target);
  if (sources.size !== 1) {
    return null;
  }
  for (const source of sources) {
    return source;
  }
  return null;
}
