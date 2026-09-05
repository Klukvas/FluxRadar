// Зависимости worker-а. Всё внешнее инъектируется: AI-провайдер (mock/real),
// crawl-параметры (loopback-режим и подмена origin — только для тестов на
// fixture-сайте) и часы. Продовые дефолты собирает main.ts.

import type { PrismaClient, Scan, SiteProfile } from '@prisma/client';
import type { AiProvider } from '@fluxradar/ai';
import type { HostLimiter } from '@fluxradar/safe-fetch';
import type { CrawlFetcher } from '@fluxradar/crawler';
import type { PerformanceSnapshot } from '../integrations/performance.ts';

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
  readonly createPerformanceRunner?: () =>
    ((origin: string, strategy: 'desktop' | 'mobile') => Promise<PerformanceSnapshot>) | undefined;
  readonly crawl?: WorkerCrawlOptions;
  readonly now?: () => Date;
  readonly mailer?: Mailer;
}
