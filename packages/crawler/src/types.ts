// Публичные типы crawler-а (T-07, план §3): область сканирования,
// снимок страницы и итог обхода.

import type { RedirectHop, SafeFetchResult } from '@fluxradar/safe-fetch';

/**
 * Область сканирования (план §3 «Настройка области сканирования»).
 * Шаблоны include/exclude — простые glob-подобные: `*` матчит любую
 * последовательность символов; сравнение полное, по pathname URL.
 */
export interface CrawlScope {
  /** Абсолютный http(s)-origin, например `http://127.0.0.1:4321`. */
  readonly origin: string;
  /** Обходить ли поддомены origin-хоста. */
  readonly includeSubdomains: boolean;
  /** URL берётся в обход, только если pathname матчит хотя бы один шаблон. */
  readonly includePatterns?: readonly string[];
  /** URL исключается, если pathname матчит хотя бы один шаблон (exclude сильнее include). */
  readonly excludePatterns?: readonly string[];
  /** Лимит страниц тарифа: сверх лимита URL идут в skippedOverLimit. */
  readonly maxPages: number;
  /** Глубина обхода в переходах по ссылкам от origin; undefined — без ограничения. */
  readonly maxDepth?: number;
  /** Соблюдать robots.txt; default true (план §3). */
  readonly respectRobots?: boolean;
  /**
   * Явное подтверждение пользователя на override robots.txt (план §3).
   * Работает только вместе с respectRobots=false; каждый override логируется.
   */
  readonly robotsOverrideConfirmed?: boolean;
}

/** Снимок одной обработанной страницы — вход для rules (T-08/T-09). */
export interface PageSnapshot {
  /** URL, каким он был обнаружен (после разрешения относительных ссылок). */
  readonly requestedUrl: string;
  /** Канонический URL по normalizeUrl v1 — ключ дедупа. */
  readonly normalizedUrl: string;
  /** URL после redirect-цепочки; при ошибке фетча равен requestedUrl. */
  readonly finalUrl: string;
  /** HTTP-статус финального ответа; 0 — фетч не дал ответа (fetchError заполнен). */
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly redirectChain: readonly RedirectHop[];
  /** Тело ответа для text/html; null — не HTML или фетч упал. */
  readonly html: string | null;
  /** Значение Content-Type ответа; null — ответа не было. */
  readonly contentType: string | null;
  readonly timingMs: number;
  /** true — тело обрезано по CRAWL_LIMITS.maxHtmlBytes (D-028). */
  readonly truncated: boolean;
  /** Сообщение ошибки safe-fetch (SSRF/timeout/network/redirect limit). */
  readonly fetchError?: string;
}

export interface CrawlError {
  readonly url: string;
  readonly reason: string;
}

/** Итог обхода. Все списки URL — нормализованные, без дублей. */
export interface CrawlResult {
  readonly pages: readonly PageSnapshot[];
  /** Прошли scope/robots, но не влезли в maxPages. */
  readonly skippedOverLimit: readonly string[];
  /** Заблокированы robots.txt (respectRobots без подтверждённого override). */
  readonly blockedByRobots: readonly string[];
  readonly errors: readonly CrawlError[];
  /**
   * normalizedUrl → отсортированные raw-варианты, под которыми URL был
   * обнаружен (origin/sitemap/ссылки в scope). Только ключи с ≥2 вариантами —
   * вход для правила «duplicate URL» (SEO-TECH-007, T-08).
   */
  readonly urlVariants: Readonly<Record<string, readonly string[]>>;
  /** Сырой robots.txt origin-а, если отдан со статусом 200. */
  readonly robotsTxt?: string;
  /** URL страниц, извлечённые из sitemap (использованы как seed обхода). */
  readonly sitemapUrls: readonly string[];
}

/** Инъектируемый транспорт: контракт — SafeFetchResult либо throw SafeFetchError. */
export type CrawlFetcher = (url: string) => Promise<SafeFetchResult>;

/** Логгер для событий, требующих следа (robots override и пр.). */
export interface CrawlerLogger {
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}
