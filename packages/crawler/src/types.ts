// Публичные типы crawler-а (T-07, план §3): область сканирования,
// снимок страницы и итог обхода.

import type { RedirectHop, SafeFetchResult } from '@fluxradar/safe-fetch';

import type { BlockedRequest, BlockedRequestReason, RenderFailureReason } from './render/types.js';

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
  /**
   * URL, добавленные владельцем вручную. Ставятся в очередь рядом с origin и
   * sitemap и проходят те же фильтры scope/robots/лимитов — seed это точка
   * входа, а не исключение из правил.
   */
  readonly seedUrls?: readonly string[];
  /**
   * Рендерить ли страницы в браузере перед чтением правилами. Без рантайма
   * страница остаётся статической и помечается Unavailable — DOM не выдумывается.
   */
  readonly renderJs?: boolean;
  /** Лимит страниц тарифа: сверх лимита URL идут в skippedOverLimit. */
  readonly maxPages: number;
  /** Глубина обхода в переходах по ссылкам от origin; undefined — без ограничения. */
  readonly maxDepth?: number;
  /** Учитывать query-параметры при дедупликации URL или отбросить query целиком. */
  readonly queryPolicy?: 'include' | 'ignore';
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
  /**
   * Сколько переходов по ссылкам отделяет страницу от точки входа.
   *
   * Нужна не правилам, а возобновлению: восстановленная страница заново отдаёт
   * свои ссылки в очередь, и без глубины обход после паузы ушёл бы дальше
   * maxDepth, чем до неё.
   */
  readonly depth: number;
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
  /** Что стало с JS-рендером этой страницы; отсутствует — рендер не запрашивали. */
  readonly rendering?: PageRendering;
}

/**
 * Исход рендера одной страницы.
 *
 * `Unavailable` — это результат, а не молчание: `html` в снимке остаётся
 * статическим, и отчёт обязан сказать, что DOM после выполнения скриптов
 * прочитан не был.
 */
export type PageRendering =
  | {
      readonly status: 'Rendered';
      readonly subresourceCount: number;
      readonly subresourceBytes: number;
      readonly blocked: readonly BlockedRequest[];
      readonly timingMs: number;
    }
  | {
      readonly status: 'Unavailable';
      readonly reason: RenderFailureReason;
      readonly detail: string;
    };

/** Итог рендер-режима по всему обходу — вход для статуса модуля и отчёта. */
export type CrawlRendering =
  | { readonly status: 'NotRequested' }
  | {
      readonly status: 'Rendered';
      readonly engine: string;
      readonly version: string;
      readonly renderedPages: number;
      readonly failedPages: number;
      /**
       * Rendered pages whose DOM was built without something it asked for.
       *
       * A page whose main bundle the budget could not pay for, or whose script
       * robots.txt closed, still renders — and renders as a different page.
       * Counting it with the complete ones would make "evaluated after the page
       * scripts ran" a claim about markup that was never evaluated (§16: a
       * limitation of the check is part of its result, not an absence of one).
       */
      readonly incompletePages: number;
      /** Why those pages were incomplete, de-duplicated; empty when none were. */
      readonly incompleteReasons: readonly BlockedRequestReason[];
    }
  | {
      readonly status: 'Unavailable';
      readonly reason: RenderFailureReason;
      readonly detail: string;
    };

/** Один URL очереди обхода — единица checkpoint-а паузы/возобновления. */
export interface CrawlQueueEntry {
  readonly url: string;
  readonly depth: number;
}

/**
 * Why a referenced media resource has no verdict.
 *
 * Every value here means "we did not check this", never "this is fine" and
 * never "this is broken". A rule that penalised any of them would be reporting
 * our own budget as the site's defect.
 */
export const RESOURCE_UNVERIFIED_REASONS = [
  /** robots.txt disallows fetching it for our user agent. */
  'RobotsDisallowed',
  /** The probe budget for this scan was already spent. */
  'BudgetExhausted',
  /** The scan was paused or cancelled before this resource was reached. */
  'Stopped',
  /**
   * The request produced no HTTP status: a timeout, a DNS failure, an SSRF
   * refusal. Deliberately not treated as a broken resource — the failure may
   * as easily be ours as the site's.
   */
  'RequestFailed',
] as const;

export type ResourceUnverifiedReason = (typeof RESOURCE_UNVERIFIED_REASONS)[number];

/**
 * One media resource a page referenced, and what asking for it returned.
 *
 * These are *not* pages: they never enter `pages`, never count against the
 * tariff's URL limit and never reach a rule that measures the site by page.
 * They exist so a rule can say "this image answers 404" instead of "this image
 * was never confirmed".
 */
export interface ResourceSnapshot {
  /** The URL as the page referenced it, resolved against the page. */
  readonly requestedUrl: string;
  /** Canonical URL by normalizeUrl v1 — the key a rule looks it up by. */
  readonly normalizedUrl: string;
  /** URL after redirects; equals requestedUrl when nothing was fetched. */
  readonly finalUrl: string;
  /** HTTP status of the probe; 0 when no response was obtained. */
  readonly status: number;
  readonly contentType: string | null;
  /** How it was asked for; absent when it was never asked for at all. */
  readonly method?: 'HEAD' | 'GET';
  readonly timingMs: number;
  /** Present when this resource carries no verdict; see the type's doc. */
  readonly unverifiedReason?: ResourceUnverifiedReason;
  /** Transport-level failure text, for the operator, when there was one. */
  readonly fetchError?: string;
  /** The page that referenced it, so evidence can point somewhere real. */
  readonly referencedBy: string;
}

export interface CrawlError {
  readonly url: string;
  readonly reason: string;
}

/**
 * Что обход уже знал о сайте до паузы — всё, кроме самих страниц.
 *
 * Эти списки нельзя вывести заново из восстановленных страниц: URL, который
 * не влез в лимит тарифа, и URL, закрытый robots.txt, ничем в HTML не
 * отмечены. Потерять их — значит после паузы отчитаться о меньшем покрытии,
 * чем скан на самом деле проверил.
 */
export interface RestoredCrawlCoverage {
  readonly skippedOverLimit: readonly string[];
  readonly blockedByRobots: readonly string[];
  readonly errors: readonly CrawlError[];
  readonly rejectedSeeds: readonly CrawlError[];
  readonly urlVariants: Readonly<Record<string, readonly string[]>>;
}

/** Состояние прошлой попытки, с которого обход продолжается после паузы. */
export interface RestoredCrawlState {
  /** Страницы, прочитанные до паузы; заново они не запрашиваются. */
  readonly pages: readonly PageSnapshot[];
  readonly coverage: RestoredCrawlCoverage;
  /**
   * Media probes the interrupted attempt already made.
   *
   * A probe is a request to the owner's server, and the answer does not change
   * because we paused. Entries that carry a verdict — or a robots.txt refusal,
   * which is a decision rather than a gap — are reused; the ones that were
   * never actually checked are asked again.
   */
  readonly resources?: readonly ResourceSnapshot[];
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
  /** Явные seed-URL, отклонённые до обхода (вне scope, нераспарсиваемые). */
  readonly rejectedSeeds: readonly CrawlError[];
  /** Состояние JS-рендера по всему обходу. */
  readonly rendering: CrawlRendering;
  /**
   * Media the crawled pages reference, and what asking for each returned.
   *
   * Separate from `pages` on purpose: a resource is evidence about a page, not
   * a page of the site, so it must never move a page count, a tariff limit or
   * a coverage denominator.
   */
  readonly resources: readonly ResourceSnapshot[];
  /**
   * Очередь, оставшаяся необработанной, когда обход остановили (пауза/отмена).
   * Пусто при нормальном завершении; это frontier checkpoint-а.
   */
  readonly pendingQueue: readonly CrawlQueueEntry[];
  /** true — обход прекращён по внешнему сигналу, а не потому, что очередь пуста. */
  readonly stoppedEarly: boolean;
}

/**
 * Как обход просит один URL, когда это не обычная загрузка страницы.
 *
 * Появилось ради media-проб: они ходят HEAD-ом и читают лишь начало тела.
 * Поле опционально, поэтому транспорт, которому это неинтересно (мок в тесте),
 * остаётся прежним.
 */
export interface CrawlFetchInit {
  readonly method?: 'GET' | 'HEAD';
  readonly maxBodyBytes?: number;
  readonly timeoutMs?: number;
}

/** Инъектируемый транспорт: контракт — SafeFetchResult либо throw SafeFetchError. */
export type CrawlFetcher = (url: string, init?: CrawlFetchInit) => Promise<SafeFetchResult>;

/** Логгер для событий, требующих следа (robots override и пр.). */
export interface CrawlerLogger {
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
}
