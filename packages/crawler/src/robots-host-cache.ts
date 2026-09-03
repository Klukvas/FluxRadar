// Ленивый per-host кэш robots.txt (T-07). robots.txt действует только на свой
// host (RFC 9309), поэтому при includeSubdomains каждый host обхода получает
// собственный фетч+парсинг ровно один раз.

import type { RobotsTxt } from './robots.js';
import { parseRobotsTxt } from './robots.js';
import type { CrawlError, CrawlFetcher } from './types.js';

/** Ключ кэша robots: протокол + host (с портом) — у каждого свой robots.txt. */
export function hostKey(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

/**
 * Политика D-141: 200 → парсим; не-200 — «всё разрешено» (null); сетевая
 * ошибка → onFetchError, host остаётся открытым (null) и обход продолжается.
 */
export class RobotsHostCache {
  private readonly byHost = new Map<string, RobotsTxt | null>();
  private readonly rawByHost = new Map<string, string>();
  private readonly fetchRobots: CrawlFetcher;
  private readonly onFetchError: (error: CrawlError) => void;

  constructor(fetchRobots: CrawlFetcher, onFetchError: (error: CrawlError) => void) {
    this.fetchRobots = fetchRobots;
    this.onFetchError = onFetchError;
  }

  /** robots.txt host-а (host — ключ из hostKey); фетч лениво, один раз на host. */
  async forHost(host: string): Promise<RobotsTxt | null> {
    const cached = this.byHost.get(host);
    if (cached !== undefined) {
      return cached;
    }
    const robotsUrl = `${host}/robots.txt`;
    let robots: RobotsTxt | null = null;
    try {
      const response = await this.fetchRobots(robotsUrl);
      if (response.status === 200) {
        robots = parseRobotsTxt(response.body);
        this.rawByHost.set(host, response.body);
      }
    } catch (error) {
      this.onFetchError({
        url: robotsUrl,
        reason: `robots.txt fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    this.byHost.set(host, robots);
    return robots;
  }

  /** Уже загруженный robots host-а; undefined — фетч ещё не выполнялся. */
  loaded(host: string): RobotsTxt | null | undefined {
    return this.byHost.get(host);
  }

  /** Сырой текст robots.txt host-а, если он был отдан со статусом 200. */
  rawFor(host: string): string | undefined {
    return this.rawByHost.get(host);
  }
}
