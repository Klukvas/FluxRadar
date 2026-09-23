// Зависимости worker-а. Всё внешнее инъектируется: AI-провайдер (mock/real),
// crawl-параметры (loopback-режим и подмена origin — только для тестов на
// fixture-сайте) и часы. Продовые дефолты собирает main.ts.

import type { PrismaClient, Scan, SiteProfile } from '@prisma/client';
import type { AiProvider } from '@fluxradar/ai';
import type { HostLimiter } from '@fluxradar/safe-fetch';
import type { CrawlFetcher, RenderRuntimeResult } from '@fluxradar/crawler';
import type { BingDataRunner } from '../integrations/bing/runner.ts';
import type { PerformanceRunner } from '../integrations/performance/index.ts';
import type { GoogleDataRunner } from '../integrations/google/runner.ts';

import type { ApiLogger } from '../http/logger.ts';
import type { Mailer } from '../email/mailer.ts';

export interface WorkerCrawlOptions {
  /**
   * Тестовый seam: origin, который реально обходится вместо scan.domain
   * (fixture-сайт живёт на loopback-http, а профиль обязан быть https, D-111).
   */
  readonly originOverride?: (scan: Scan) => string;
  /** Только test-режим: пропуск loopback в safe-fetch (D-126). */
  readonly dangerouslyAllowLoopback?: boolean;
  /** Общий rate-limiter обходов; тесты передают более щедрые лимиты. */
  readonly limiter?: HostLimiter;
  /** Test-only transport seam for deterministic unreachable/partial fixtures. */
  readonly fetcher?: CrawlFetcher;
}

export interface WorkerDeps {
  readonly prisma: PrismaClient;
  readonly logger: ApiLogger;
  /** Фабрика AI-провайдера скана: мок собирается под brand/домен профиля. */
  readonly createAiProvider: (scan: Scan, profile: SiteProfile) => AiProvider;
  readonly createPerformanceRunner?: () => PerformanceRunner | undefined;
  /**
   * Reads Search Console/GA4 for the scan's account. Absent means the Google
   * data flow is disabled entirely and the Analytics module reports
   * "not connected" — the same result as an account that never authorized.
   */
  readonly createGoogleDataRunner?: () => GoogleDataRunner | undefined;
  /**
   * Starts the browser a JS-rendered crawl needs, once per attempt.
   *
   * Absent means this deployment never renders — the scan then reports
   * rendering as unavailable rather than reading the static HTML as if the
   * page's scripts had run. The result is returned rather than thrown so the
   * reason reaches the report.
   */
  readonly createRenderRuntime?: () => Promise<RenderRuntimeResult>;
  /**
   * Reads Bing Webmaster Tools for the scan's account. Absent means the Bing
   * data flow is disabled entirely and the Analytics module's Bing section
   * reports "not connected". It is a separate seam from the Google one: a
   * deployment (or a test) may have either, both or neither.
   */
  readonly createBingDataRunner?: () => BingDataRunner | undefined;
  readonly crawl?: WorkerCrawlOptions;
  /**
   * How often a running attempt asks whether it has been paused or cancelled.
   *
   * A poll rather than a push because the crawler asks the question before
   * every request and cannot wait for a database round trip. Tests shorten it
   * so a fixture crawl, which finishes in milliseconds, can still be stopped
   * part-way; production leaves it at its default.
   */
  readonly stopPollMs?: number;
  readonly now?: () => Date;
  readonly mailer?: Mailer;
}
