// Обход сайта (T-07, план §3): BFS от origin + sitemap-seed-ы, дедуп по
// normalizeUrl, robots.txt по умолчанию (+ логируемый override), лимиты
// maxPages/maxDepth, per-host авто-throttle по последовательным 5xx (D-030).

import { MEDIA_PROBE_LIMITS } from '@fluxradar/contracts';
import { normalizeUrl } from '@fluxradar/fingerprint';
import type { EgressProxy, SafeFetchResult } from '@fluxradar/safe-fetch';
import { HostLimiter, safeFetch } from '@fluxradar/safe-fetch';

import { extractLinks } from './link-extractor.js';
import type { BlockedRequestReason, RenderRuntimeResult } from './render/types.js';
import { probeMediaResources } from './resources.js';
import { hostKey, RobotsHostCache } from './robots-host-cache.js';
import { isPathAllowed } from './robots.js';
import { isHostInScope, isPathnameAllowedByPatterns, validateScope } from './scope.js';
import { CRAWLER_USER_AGENT } from './user-agent.js';
import { fetchSitemapUrls, SITEMAP_MAX_URLS } from './sitemap.js';
import type {
  CrawlError,
  CrawlFetcher,
  CrawlQueueEntry,
  CrawlRendering,
  CrawlResult,
  CrawlScope,
  CrawlerLogger,
  PageRendering,
  PageSnapshot,
  ResourceSnapshot,
  RestoredCrawlState,
} from './types.js';

/** ≥ стольких 5xx подряд на host → host останавливается (D-030). */
export const CONSECUTIVE_5XX_HOST_STOP = 5;

/**
 * Block reasons that mean the rendered DOM is missing something the page wanted.
 *
 * The other reasons are policy — a render never posts, never navigates and never
 * loads an image — and a page refused one of those still got the DOM a visitor
 * gets. These three are OUR limits meeting the page's own resources.
 */
const RENDER_COVERAGE_LIMIT_REASONS: readonly BlockedRequestReason[] = [
  'budget',
  'robots-disallowed',
  'ssrf-blocked',
];

export interface CrawlOptions {
  /** Инъекция транспорта (тесты/моки); default — safeFetch с UA краулера. */
  readonly fetcher?: CrawlFetcher;
  /** Per-host rate limiter; default — HostLimiter с лимитами D-030. */
  readonly limiter?: HostLimiter;
  /** Passthrough в safeFetch — только для локального fixture-сайта (D-126). */
  readonly dangerouslyAllowLoopback?: boolean;
  readonly logger?: CrawlerLogger;
  /** done — страниц реально прочитано, total — done + остаток очереди. */
  readonly onProgress?: (url: string, done: number, total: number) => void;
  /** Имя агента для матчинга User-agent групп robots.txt. */
  readonly userAgent?: string;
  /**
   * Отмена обхода: после аборта новых запросов не делается, а обход возвращает
   * то, что успел собрать. Сигнал уходит и в сам транспорт (safeFetch), поэтому
   * текущий запрос тоже прерывается — отменённый скан не ждёт таймаута чужого
   * сервера. Снимок прерванной страницы не записывается: это не evidence.
   *
   * Отличается от `shouldStop` тем, что прерывает запрос в полёте. Пауза —
   * кооперативная и ждёт границы шага, отмена — нет.
   */
  readonly signal?: AbortSignal;
  /**
   * Браузерный рантайм для scope.renderJs. Передаётся уже разрешённым: либо
   * готовый рантайм, либо явная причина недоступности, которая попадёт в
   * отчёт вместо выдуманного DOM.
   */
  readonly renderRuntime?: RenderRuntimeResult;
  /**
   * Внешний сигнал остановки (пауза/отмена скана). Проверяется перед каждым
   * сетевым действием: после паузы обход не отправляет новых запросов.
   */
  readonly shouldStop?: () => boolean;
  /** Frontier из checkpoint-а: URL, известные обходу до паузы. */
  readonly resumeSeeds?: readonly CrawlQueueEntry[];
  /**
   * Страницы и покрытие прошлой попытки. Передаются — обход их не перезапрашивает
   * и продолжает тот же скан; не передаются — обход начинается с нуля.
   */
  readonly restored?: RestoredCrawlState;
  /**
   * Проверять ли доступность media, на которые ссылаются страницы. Отдельный
   * переключатель, потому что это дополнительные запросы к сайту: по умолчанию
   * включено, Free-проверка (одна страница) его не использует.
   */
  readonly probeMedia?: boolean;
  /**
   * Egress-прокси обхода: сайты клиентов видят его адрес, а не адрес сервера
   * FluxRadar. Отсутствует — запросы идут напрямую.
   */
  readonly egressProxy?: EgressProxy;
}

interface QueueEntry {
  readonly rawUrl: string;
  readonly normalized: string;
  readonly parsed: URL;
  readonly depth: number;
}

export async function crawl(scope: CrawlScope, options: CrawlOptions = {}): Promise<CrawlResult> {
  return new CrawlRun(scope, options).execute();
}

class CrawlRun {
  private readonly scope: CrawlScope;
  private readonly origin: URL;
  private readonly fetcher: CrawlFetcher;
  private readonly limiter: HostLimiter;
  private readonly logger: CrawlerLogger;
  private readonly userAgent: string;
  private readonly onProgress: ((url: string, done: number, total: number) => void) | undefined;
  private readonly overrideRobots: boolean;
  private readonly signal: AbortSignal | undefined;

  private readonly renderRuntime: RenderRuntimeResult | undefined;
  private readonly shouldStop: () => boolean;
  private readonly resumeSeeds: readonly CrawlQueueEntry[];
  private readonly probeMedia: boolean;
  private readonly dangerouslyAllowLoopback: boolean;
  private readonly restored: RestoredCrawlState | undefined;
  private resources: readonly ResourceSnapshot[] = [];

  private readonly robotsCache: RobotsHostCache;
  private sitemapUrls: readonly string[] = [];
  private readonly rejectedSeeds: CrawlError[] = [];
  private renderedPages = 0;
  private failedRenderPages = 0;
  private stoppedEarly = false;

  private readonly queue: QueueEntry[] = [];
  private readonly seen = new Set<string>();
  /** normalizedUrl → raw-варианты обнаружения (для SEO-TECH-007, T-08). */
  private readonly variantsByNormalized = new Map<string, Set<string>>();
  private readonly pages: PageSnapshot[] = [];
  private readonly skippedOverLimit: string[] = [];
  private readonly blockedByRobots: string[] = [];
  private readonly errors: CrawlError[] = [];
  private readonly stoppedHosts = new Set<string>();
  private readonly consecutive5xxByHost = new Map<string, number>();

  constructor(scope: CrawlScope, options: CrawlOptions) {
    this.scope = scope;
    this.origin = validateScope(scope);
    this.userAgent = options.userAgent ?? CRAWLER_USER_AGENT;
    this.fetcher =
      options.fetcher ??
      buildDefaultFetcher(
        this.userAgent,
        options.dangerouslyAllowLoopback ?? false,
        options.signal,
        options.egressProxy,
      );
    this.limiter = options.limiter ?? new HostLimiter();
    this.robotsCache = new RobotsHostCache(
      (url) => this.fetchThrottled(url),
      (error) => {
        this.errors.push(error);
      },
    );
    this.logger = options.logger ?? consoleWarnLogger;
    this.onProgress = options.onProgress;
    this.signal = options.signal;
    this.renderRuntime = options.renderRuntime;
    // Пауза и отмена сходятся в одну проверку: всё, что умеет остановиться на
    // границе шага, обязано останавливаться и по отмене — иначе отменённый скан
    // продолжал бы обход до конца очереди.
    this.shouldStop = (): boolean => (options.shouldStop?.() ?? false) || this.isCancelled();
    this.resumeSeeds = options.resumeSeeds ?? [];
    this.probeMedia = options.probeMedia ?? true;
    this.dangerouslyAllowLoopback = options.dangerouslyAllowLoopback ?? false;
    this.restored = options.restored;
    const wantsOverride = scope.respectRobots === false;
    // Fail-safe (план §3): без явного подтверждения robots.txt соблюдается.
    this.overrideRobots = wantsOverride && scope.robotsOverrideConfirmed === true;
    if (wantsOverride && !this.overrideRobots) {
      this.logger.warn(
        'crawl: respectRobots=false проигнорирован — нет robotsOverrideConfirmed, robots.txt соблюдается',
        { origin: scope.origin },
      );
    }
    if (this.overrideRobots) {
      this.logger.warn('crawl: robots.txt override подтверждён — Disallow-правила игнорируются', {
        origin: scope.origin,
      });
    }
  }

  async execute(): Promise<CrawlResult> {
    // Восстановление идёт до любого сетевого действия: иначе уже прочитанная
    // страница успела бы попасть в очередь и быть запрошена второй раз.
    this.restorePreviousAttempt();
    if (this.shouldStop()) {
      // Стоп до первого запроса: обход не открывает ни одного соединения.
      this.stoppedEarly = true;
      return this.result();
    }
    await this.robotsCache.forHost(hostKey(this.origin));
    if (!this.isCancelled()) {
      await this.loadSitemaps();
    }
    this.enqueue(this.origin.href, 0);
    // Явные seed-ы владельца идут сразу за origin: они адресны, и очередь FIFO,
    // поэтому при жёстком maxPages они попадают в обход раньше найденных ссылок.
    this.enqueueSeeds();
    for (const resumed of this.resumeSeeds) {
      this.enqueue(resumed.url, resumed.depth);
    }
    for (const sitemapPageUrl of this.sitemapUrls) {
      this.enqueue(sitemapPageUrl, 1);
    }
    this.enqueueLinksOfRestoredPages();
    for (;;) {
      if (this.shouldStop()) {
        this.stoppedEarly = true;
        break;
      }
      const entry = this.queue.shift();
      if (entry === undefined) {
        break;
      }
      await this.processEntry(entry);
      // Progress is counted in pages actually read, not in queue entries taken:
      // a URL skipped over the tariff limit or closed by robots.txt was never
      // read, and counting it would tell the owner their site was scanned more
      // deeply than it was.
      this.onProgress?.(entry.rawUrl, this.pages.length, this.pages.length + this.queue.length);
    }
    await this.checkReferencedMedia();
    return this.result();
  }

  /** Жёсткая отмена: в отличие от паузы прерывает и запрос, уже ушедший к сайту. */
  private isCancelled(): boolean {
    return this.signal?.aborted === true;
  }

  /**
   * Проверка media после обхода, а не во время него.
   *
   * К этому моменту известны все страницы, поэтому ресурс не запрашивается
   * дважды и уже загруженная как страница цель не проверяется повторно. При
   * остановке проверка не запускается вовсе: пауза значит «никаких новых
   * исходящих запросов», а не «ещё двести, но быстро».
   */
  private async checkReferencedMedia(): Promise<void> {
    if (!this.probeMedia || this.stoppedEarly || this.shouldStop()) return;
    this.resources = await probeMediaResources(this.pages, {
      head: (url) => this.probeFetch(url, 'HEAD'),
      get: (url) => this.probeFetch(url, 'GET'),
      acquire: (hostname) => this.limiter.acquire(hostname),
      isAllowed: (url) => this.isSubresourceAllowed(url),
      isInScope: (url) =>
        isHostInScope(url.hostname, this.origin.hostname, this.scope.includeSubdomains),
      shouldStop: this.shouldStop,
      // Probes the interrupted attempt already made. Without this a resume
      // re-asks the owner's server for every image on the site, including on
      // a resume whose pages were all restored and whose frontier was empty.
      known: this.restored?.resources ?? [],
    });
  }

  /** Один bounded-запрос к media: свой дедлайн и свой лимит тела. */
  private probeFetch(url: string, method: 'HEAD' | 'GET'): Promise<SafeFetchResult> {
    return this.fetcher(url, {
      method,
      timeoutMs: MEDIA_PROBE_LIMITS.timeoutMs,
      maxBodyBytes: MEDIA_PROBE_LIMITS.maxFallbackBytes,
    });
  }

  /**
   * Возвращает в обход то, что он уже знал до паузы.
   *
   * Страницы кладутся в результат как есть и помечаются посещёнными, поэтому
   * второй раз не запрашиваются и считаются в лимит страниц тарифа — иначе
   * пауза стала бы способом обойти тариф. Ссылки с них извлекаются заново:
   * frontier в checkpoint-е ограничен, и переоткрытие ссылок — это то, что
   * делает очередь после паузы самовосстанавливающейся, а не усечённой.
   */
  private restorePreviousAttempt(): void {
    const restored = this.restored;
    if (restored === undefined) return;
    for (const page of restored.pages) {
      this.pages.push(page);
      this.seen.add(page.normalizedUrl);
      this.markFinalUrlSeen(page.finalUrl);
      // The render counters describe the scan, not the attempt. A page carried
      // over from before the pause was rendered — or explicitly was not — and
      // leaving it out of both counters made a resumed scan report
      // "unrenderedPages: 0" while one of its own pages had no rendered DOM.
      if (page.rendering?.status === 'Rendered') this.renderedPages += 1;
      else if (page.rendering?.status === 'Unavailable') this.failedRenderPages += 1;
    }
    // Carried immediately, not only when the probe step runs: a resume that is
    // stopped again before it gets there must hand the probes back rather than
    // report a scan that suddenly knows nothing about the site's media.
    this.resources = restored.resources ?? [];
    this.skippedOverLimit.push(...restored.coverage.skippedOverLimit);
    this.blockedByRobots.push(...restored.coverage.blockedByRobots);
    this.errors.push(...restored.coverage.errors);
    this.rejectedSeeds.push(...restored.coverage.rejectedSeeds);
    for (const [normalized, variants] of Object.entries(restored.coverage.urlVariants)) {
      for (const variant of variants) this.recordVariant(normalized, variant);
    }
  }

  /** Ссылки восстановленных страниц — после того, как очередь уже собрана. */
  private enqueueLinksOfRestoredPages(): void {
    for (const page of this.restored?.pages ?? []) {
      if (page.html === null || !this.mayUseAsLinkSource(page.finalUrl)) continue;
      for (const link of extractLinks(page.html, page.finalUrl)) {
        this.enqueue(link, page.depth + 1);
      }
    }
  }

  private result(): CrawlResult {
    const robotsTxtRaw = this.robotsCache.rawFor(hostKey(this.origin));
    return {
      pages: this.pages,
      skippedOverLimit: this.skippedOverLimit,
      blockedByRobots: this.blockedByRobots,
      errors: this.errors,
      urlVariants: buildUrlVariants(this.variantsByNormalized),
      ...(robotsTxtRaw !== undefined ? { robotsTxt: robotsTxtRaw } : {}),
      sitemapUrls: this.sitemapUrls,
      rejectedSeeds: this.rejectedSeeds,
      rendering: this.renderingSummary(),
      resources: this.resources,
      pendingQueue: this.queue.map((entry) => ({ url: entry.rawUrl, depth: entry.depth })),
      stoppedEarly: this.stoppedEarly,
    };
  }

  private renderingSummary(): CrawlRendering {
    if (this.scope.renderJs !== true) return { status: 'NotRequested' };
    const runtime = this.renderRuntime;
    if (runtime === undefined) {
      return {
        status: 'Unavailable',
        reason: 'RuntimeNotInstalled',
        detail: 'JS rendering was requested but no browser runtime was supplied to the crawl',
      };
    }
    if (runtime.kind === 'unavailable') {
      return { status: 'Unavailable', reason: runtime.reason, detail: runtime.detail };
    }
    const incomplete = this.incompleteRenders();
    return {
      status: 'Rendered',
      engine: runtime.runtime.engine,
      version: runtime.runtime.version,
      renderedPages: this.renderedPages,
      failedPages: this.failedRenderPages,
      incompletePages: incomplete.pages,
      incompleteReasons: incomplete.reasons,
    };
  }

  /**
   * Rendered pages whose DOM was built without a resource it asked for.
   *
   * Only the refusals that are OUR limit count. A page whose images were skipped
   * (`resource-kind`) or whose navigation attempt was refused got the DOM a
   * visitor gets; a page whose script the byte budget could not pay for, whose
   * host the SSRF guard closed or whose bundle robots.txt disallows did not, and
   * reading that DOM as "the page after its scripts ran" is the one thing the
   * render must not let the report claim.
   */
  private incompleteRenders(): { pages: number; reasons: readonly BlockedRequestReason[] } {
    const reasons = new Set<BlockedRequestReason>();
    let pages = 0;
    for (const page of this.pages) {
      if (page.rendering?.status !== 'Rendered') continue;
      const limits = page.rendering.blocked.filter((request) =>
        RENDER_COVERAGE_LIMIT_REASONS.includes(request.reason),
      );
      if (limits.length === 0) continue;
      pages += 1;
      for (const request of limits) reasons.add(request.reason);
    }
    return { pages, reasons: [...reasons].sort() };
  }

  /**
   * Явные seed-URL владельца. Отклонённые не молчат: они возвращаются в
   * rejectedSeeds, чтобы в отчёте было видно, какой адрес не был проверен.
   */
  private enqueueSeeds(): void {
    for (const seed of this.scope.seedUrls ?? []) {
      let parsed: URL;
      try {
        parsed = new URL(seed);
      } catch {
        this.rejectedSeeds.push({ url: seed, reason: 'seed URL is not an absolute http(s) URL' });
        continue;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        this.rejectedSeeds.push({ url: seed, reason: `unsupported scheme "${parsed.protocol}"` });
        continue;
      }
      if (!isHostInScope(parsed.hostname, this.origin.hostname, this.scope.includeSubdomains)) {
        this.rejectedSeeds.push({
          url: seed,
          reason: `host "${parsed.hostname}" is outside the scanned site`,
        });
        continue;
      }
      if (!isPathnameAllowedByPatterns(parsed.pathname, this.scope)) {
        this.rejectedSeeds.push({
          url: seed,
          reason: 'path is excluded by the scan’s include/exclude patterns',
        });
        continue;
      }
      // Seed-ы — корни обхода, поэтому глубина 0: ограничение maxDepth считает
      // переходы по ссылкам ОТ точки входа, а seed и есть точка входа.
      this.enqueue(seed, 0);
    }
  }

  /** Кандидат в очередь: нормализация → scope-фильтры → варианты → дедуп → глубина. */
  private enqueue(rawUrl: string, depth: number): void {
    let normalized: string;
    let parsed: URL;
    let discovered: URL;
    try {
      discovered = new URL(rawUrl);
      parsed = applyQueryPolicy(new URL(rawUrl), this.scope.queryPolicy);
      normalized = normalizeUrl(parsed.href);
    } catch {
      return; // мусорные обнаруженные ссылки (userinfo и пр.) — не ошибка обхода
    }
    if (!isHostInScope(parsed.hostname, this.origin.hostname, this.scope.includeSubdomains)) {
      return;
    }
    if (!isPathnameAllowedByPatterns(parsed.pathname, this.scope)) {
      return;
    }
    this.recordVariant(normalized, discovered.href);
    if (this.seen.has(normalized)) {
      return;
    }
    this.seen.add(normalized);
    if (this.scope.maxDepth !== undefined && depth > this.scope.maxDepth) {
      return;
    }
    this.queue.push({ rawUrl: parsed.href, normalized, parsed, depth });
  }

  /** Дубли не фетчатся, но их raw-формы копятся — вход SEO-TECH-007 (T-08). */
  private recordVariant(normalized: string, discoveredUrl: string): void {
    const existing = this.variantsByNormalized.get(normalized);
    if (existing === undefined) {
      this.variantsByNormalized.set(normalized, new Set([discoveredUrl]));
      return;
    }
    existing.add(discoveredUrl);
  }

  private async processEntry(entry: QueueEntry): Promise<void> {
    if (await this.isBlockedByRobots(entry)) {
      if (!this.overrideRobots) {
        this.blockedByRobots.push(entry.normalized);
        return;
      }
      this.logger.warn('crawl: robots override — фетчим заблокированный robots.txt URL', {
        url: entry.rawUrl,
      });
    }
    if (this.pages.length >= this.scope.maxPages) {
      this.skippedOverLimit.push(entry.normalized);
      return;
    }
    const host = entry.parsed.hostname;
    if (this.stoppedHosts.has(host)) {
      this.errors.push({
        url: entry.normalized,
        reason: `skipped: host "${host}" stopped after ${CONSECUTIVE_5XX_HOST_STOP} consecutive 5xx responses (D-030)`,
      });
      return;
    }
    const fetched = await this.fetchPage(entry);
    if (fetched.fetchError !== undefined && this.isCancelled()) {
      // Запрос прервала отмена, а не сайт: такой снимок сказал бы «страница
      // недоступна» про страницу, которую никто не дослушал.
      return;
    }
    const snapshot = await this.withRendering(fetched);
    this.pages.push(snapshot);
    this.trackHostHealth(host, entry, snapshot);
    if (snapshot.fetchError !== undefined) {
      this.errors.push({ url: entry.normalized, reason: snapshot.fetchError });
      return;
    }
    this.markFinalUrlSeen(snapshot.finalUrl);
    if (snapshot.html !== null && this.mayUseAsLinkSource(snapshot.finalUrl)) {
      for (const link of extractLinks(snapshot.html, snapshot.finalUrl)) {
        this.enqueue(link, entry.depth + 1);
      }
    }
  }

  /**
   * Redirect мог увести за scope: чужая страница остаётся снимком-evidence
   * (redirectChain нужен SEO-TECH-005), но не источником ссылок (план §25).
   */
  private mayUseAsLinkSource(finalUrl: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(finalUrl);
    } catch {
      return false;
    }
    if (isHostInScope(parsed.hostname, this.origin.hostname, this.scope.includeSubdomains)) {
      return true;
    }
    this.logger.warn('crawl: redirect увёл за пределы scope — ссылки со страницы не извлекаются', {
      finalUrl,
    });
    return false;
  }

  private async isBlockedByRobots(entry: QueueEntry): Promise<boolean> {
    const robots = await this.robotsCache.forHost(hostKey(entry.parsed));
    if (robots === null) {
      return false;
    }
    const path = `${entry.parsed.pathname}${entry.parsed.search}`;
    return !isPathAllowed(robots, this.userAgent, path);
  }

  /** Авто-throttle D-030: ≥5 последовательных 5xx → стоп хоста + ошибка. */
  private trackHostHealth(host: string, entry: QueueEntry, snapshot: PageSnapshot): void {
    if (snapshot.status >= 500) {
      const streak = (this.consecutive5xxByHost.get(host) ?? 0) + 1;
      this.consecutive5xxByHost.set(host, streak);
      if (streak >= CONSECUTIVE_5XX_HOST_STOP) {
        this.stoppedHosts.add(host);
        this.errors.push({
          url: entry.normalized,
          reason: `host "${host}" stopped after ${CONSECUTIVE_5XX_HOST_STOP} consecutive 5xx responses (D-030)`,
        });
      }
      return;
    }
    if (snapshot.status > 0) {
      this.consecutive5xxByHost.set(host, 0);
    }
  }

  /** Redirect-цель считается посещённой — повторный фетч по прямой ссылке не нужен. */
  private markFinalUrlSeen(finalUrl: string): void {
    try {
      this.seen.add(normalizeUrl(finalUrl));
    } catch {
      // ненормализуемый finalUrl не влияет на дедуп
    }
  }

  private async fetchPage(entry: QueueEntry): Promise<PageSnapshot> {
    const release = await this.limiter.acquire(entry.parsed.hostname);
    let response: SafeFetchResult;
    try {
      response = await this.fetcher(entry.rawUrl);
    } catch (error) {
      return {
        requestedUrl: entry.rawUrl,
        normalizedUrl: entry.normalized,
        depth: entry.depth,
        finalUrl: entry.rawUrl,
        status: 0,
        headers: {},
        redirectChain: [],
        html: null,
        contentType: null,
        timingMs: 0,
        truncated: false,
        fetchError: error instanceof Error ? error.message : String(error),
      };
    } finally {
      release();
    }
    const contentType = response.headers['content-type'] ?? null;
    const isHtml = contentType !== null && contentType.toLowerCase().includes('text/html');
    return {
      requestedUrl: entry.rawUrl,
      normalizedUrl: entry.normalized,
      depth: entry.depth,
      finalUrl: response.finalUrl,
      status: response.status,
      headers: response.headers,
      redirectChain: response.redirectChain,
      html: isHtml ? response.body : null,
      contentType,
      timingMs: response.timingMs,
      truncated: response.truncated,
    };
  }

  /**
   * Страница после JS-рендера, если он запрошен.
   *
   * Молчаливого отката на статический HTML нет: при недоступном рантайме
   * снимок сохраняет статическое тело И несёт Unavailable с причиной, чтобы
   * отчёт мог сказать, что DOM после скриптов прочитан не был.
   */
  private async withRendering(page: PageSnapshot): Promise<PageSnapshot> {
    if (this.scope.renderJs !== true) return page;
    const rendering = this.renderingSummary();
    if (rendering.status === 'Unavailable') {
      return {
        ...page,
        rendering: { status: 'Unavailable', reason: rendering.reason, detail: rendering.detail },
      };
    }
    if (rendering.status !== 'Rendered') return page;
    if (page.fetchError !== undefined || page.html === null) {
      return page; // нечего рендерить: ответа нет или это не HTML
    }
    const runtime = this.renderRuntime;
    if (runtime === undefined || runtime.kind !== 'ready') return page;
    const outcome = await runtime.runtime.render({
      url: page.finalUrl,
      userAgent: this.userAgent,
      document: {
        html: page.html,
        contentType: page.contentType ?? 'text/html; charset=utf-8',
        status: page.status,
      },
      isSubresourceAllowed: (url) => this.isSubresourceAllowed(url),
      shouldStop: this.shouldStop,
    });
    if (outcome.kind === 'unavailable') {
      this.failedRenderPages += 1;
      this.logger.warn('crawl: страница не отрендерена, используется статический HTML', {
        url: page.finalUrl,
        reason: outcome.reason,
      });
      return {
        ...page,
        rendering: { status: 'Unavailable', reason: outcome.reason, detail: outcome.detail },
      };
    }
    this.renderedPages += 1;
    const rendered: PageRendering = {
      status: 'Rendered',
      subresourceCount: outcome.subresourceCount,
      subresourceBytes: outcome.subresourceBytes,
      blocked: outcome.blocked,
      timingMs: outcome.timingMs,
    };
    return { ...page, html: outcome.html, rendering: rendered };
  }

  /** robots.txt действует и внутри браузера: подресурс проверяется так же, как страница. */
  private async isSubresourceAllowed(url: URL): Promise<boolean> {
    if (this.overrideRobots) return true;
    const robots = await this.robotsCache.forHost(hostKey(url));
    if (robots === null) return true;
    return isPathAllowed(robots, this.userAgent, `${url.pathname}${url.search}`);
  }

  /**
   * Sitemap-источники: директивы robots.txt origin-а, иначе стандартный
   * /sitemap.xml. Лимит SITEMAP_MAX_URLS — суммарный на все sitemap-ы (D-142).
   */
  private async loadSitemaps(): Promise<void> {
    const originRobots = this.robotsCache.loaded(hostKey(this.origin)) ?? null;
    const declared = (originRobots?.sitemaps ?? []).filter((url) => this.isSitemapInScope(url));
    const candidates =
      declared.length > 0 ? declared : [`${this.origin.protocol}//${this.origin.host}/sitemap.xml`];
    const collected: string[] = [];
    for (const candidate of candidates) {
      const remaining = SITEMAP_MAX_URLS - collected.length;
      if (remaining <= 0) {
        break;
      }
      const urls = await fetchSitemapUrls(
        candidate,
        (url) => this.fetchThrottled(url),
        remaining,
        (url) => this.isSitemapInScope(url),
      );
      collected.push(...urls);
    }
    this.sitemapUrls = collected;
  }

  private isSitemapInScope(url: string): boolean {
    try {
      const parsed = new URL(url);
      return isHostInScope(parsed.hostname, this.origin.hostname, this.scope.includeSubdomains);
    } catch {
      return false;
    }
  }

  private async fetchThrottled(url: string): Promise<SafeFetchResult> {
    const release = await this.limiter.acquire(new URL(url).hostname);
    try {
      return await this.fetcher(url);
    } finally {
      release();
    }
  }
}

function applyQueryPolicy(url: URL, policy: CrawlScope['queryPolicy']): URL {
  if (policy !== 'ignore') {
    return url;
  }
  url.search = '';
  return url;
}

/** Только ключи с ≥2 raw-вариантами; варианты отсортированы для детерминизма. */
function buildUrlVariants(
  byNormalized: ReadonlyMap<string, ReadonlySet<string>>,
): Record<string, readonly string[]> {
  const duplicates = [...byNormalized]
    .filter(([, variants]) => variants.size > 1)
    .map(([normalized, variants]) => [normalized, [...variants].sort()] as const);
  return Object.fromEntries(duplicates);
}

function buildDefaultFetcher(
  userAgent: string,
  dangerouslyAllowLoopback: boolean,
  signal: AbortSignal | undefined,
  egressProxy: EgressProxy | undefined,
): CrawlFetcher {
  return (url, init) =>
    safeFetch(url, {
      headers: { 'user-agent': userAgent },
      dangerouslyAllowLoopback,
      // Отмена уходит в транспорт: запрос, уже ушедший к сайту, прерывается, а
      // не дожидается чужого таймаута.
      ...(signal !== undefined ? { signal } : {}),
      ...(egressProxy === undefined ? {} : { proxy: egressProxy }),
      ...(init?.method !== undefined ? { method: init.method } : {}),
      ...(init?.maxBodyBytes !== undefined ? { maxBodyBytes: init.maxBodyBytes } : {}),
      ...(init?.timeoutMs !== undefined ? { timeoutMs: init.timeoutMs } : {}),
    });
}

const consoleWarnLogger: CrawlerLogger = {
  warn(message, context) {
    console.warn(`[crawler] ${message}`, context ?? {});
  },
};
