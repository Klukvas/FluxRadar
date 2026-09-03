// Обход сайта (T-07, план §3): BFS от origin + sitemap-seed-ы, дедуп по
// normalizeUrl, robots.txt по умолчанию (+ логируемый override), лимиты
// maxPages/maxDepth, per-host авто-throttle по последовательным 5xx (D-030).

import { normalizeUrl } from '@fluxradar/fingerprint';
import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { HostLimiter, safeFetch } from '@fluxradar/safe-fetch';

import { extractLinks } from './link-extractor.js';
import { hostKey, RobotsHostCache } from './robots-host-cache.js';
import { isPathAllowed } from './robots.js';
import { isHostInScope, isPathnameAllowedByPatterns, validateScope } from './scope.js';
import { fetchSitemapUrls, SITEMAP_MAX_URLS } from './sitemap.js';
import type {
  CrawlError,
  CrawlFetcher,
  CrawlResult,
  CrawlScope,
  CrawlerLogger,
  PageSnapshot,
} from './types.js';

/** ≥ стольких 5xx подряд на host → host останавливается (D-030). */
export const CONSECUTIVE_5XX_HOST_STOP = 5;

const DEFAULT_USER_AGENT = 'FluxRadarBot/0.1';

export interface CrawlOptions {
  /** Инъекция транспорта (тесты/моки); default — safeFetch с UA краулера. */
  readonly fetcher?: CrawlFetcher;
  /** Per-host rate limiter; default — HostLimiter с лимитами D-030. */
  readonly limiter?: HostLimiter;
  /** Passthrough в safeFetch — только для локального fixture-сайта (D-126). */
  readonly dangerouslyAllowLoopback?: boolean;
  readonly logger?: CrawlerLogger;
  /** done — обработано URL из очереди, total — done + известная очередь. */
  readonly onProgress?: (url: string, done: number, total: number) => void;
  /** Имя агента для матчинга User-agent групп robots.txt. */
  readonly userAgent?: string;
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

  private readonly robotsCache: RobotsHostCache;
  private sitemapUrls: readonly string[] = [];

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
  private processedCount = 0;

  constructor(scope: CrawlScope, options: CrawlOptions) {
    this.scope = scope;
    this.origin = validateScope(scope);
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetcher =
      options.fetcher ??
      buildDefaultFetcher(this.userAgent, options.dangerouslyAllowLoopback ?? false);
    this.limiter = options.limiter ?? new HostLimiter();
    this.robotsCache = new RobotsHostCache(
      (url) => this.fetchThrottled(url),
      (error) => {
        this.errors.push(error);
      },
    );
    this.logger = options.logger ?? consoleWarnLogger;
    this.onProgress = options.onProgress;
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
    await this.robotsCache.forHost(hostKey(this.origin));
    await this.loadSitemaps();
    this.enqueue(this.origin.href, 0);
    for (const sitemapPageUrl of this.sitemapUrls) {
      this.enqueue(sitemapPageUrl, 1);
    }
    for (;;) {
      const entry = this.queue.shift();
      if (entry === undefined) {
        break;
      }
      await this.processEntry(entry);
      this.processedCount += 1;
      this.onProgress?.(entry.rawUrl, this.processedCount, this.processedCount + this.queue.length);
    }
    const robotsTxtRaw = this.robotsCache.rawFor(hostKey(this.origin));
    return {
      pages: this.pages,
      skippedOverLimit: this.skippedOverLimit,
      blockedByRobots: this.blockedByRobots,
      errors: this.errors,
      urlVariants: buildUrlVariants(this.variantsByNormalized),
      ...(robotsTxtRaw !== undefined ? { robotsTxt: robotsTxtRaw } : {}),
      sitemapUrls: this.sitemapUrls,
    };
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
    const snapshot = await this.fetchPage(entry);
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

function buildDefaultFetcher(userAgent: string, dangerouslyAllowLoopback: boolean): CrawlFetcher {
  return (url) =>
    safeFetch(url, {
      headers: { 'user-agent': userAgent },
      dangerouslyAllowLoopback,
    });
}

const consoleWarnLogger: CrawlerLogger = {
  warn(message, context) {
    console.warn(`[crawler] ${message}`, context ?? {});
  },
};
