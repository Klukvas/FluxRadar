// @fluxradar/crawler — обход сайта в пределах scope (T-07, план §3).
// robots.txt по умолчанию, sitemap как источник seed-ов, дедуп по
// normalizeUrl, лимиты страниц/глубины, per-host авто-throttle (D-030).

export { CONSECUTIVE_5XX_HOST_STOP, crawl } from './crawler.js';
export type { CrawlOptions } from './crawler.js';
export { startFixtureSite } from './fixture-server.js';
export type { FixtureSite } from './fixture-server.js';
export { extractLinks } from './link-extractor.js';
export { startPlaywrightRuntime } from './render/playwright-runtime.js';
export type { PlaywrightRuntimeOptions } from './render/playwright-runtime.js';
export {
  renderRequestHeaders,
  sanitizeResponseHeaders,
  subresourceVerdict,
} from './render/request-policy.js';
export { RenderBudgetLedger } from './render/request-policy.js';
export type {
  PolicyVerdict,
  RenderBudget,
  RenderReservation,
  SubresourceRequest,
} from './render/request-policy.js';
export { probeMediaResources } from './resources.js';
export type { ProbeMediaOptions } from './resources.js';
export { BLOCKED_REQUEST_REASONS, RENDER_FAILURE_REASONS } from './render/types.js';
export type {
  BlockedRequest,
  BlockedRequestReason,
  RenderDocument,
  RenderFailureReason,
  RenderOutcome,
  RenderRequest,
  RenderRuntime,
  RenderRuntimeResult,
} from './render/types.js';
export type { RobotsGroup, RobotsRule, RobotsTxt } from './robots.js';
export { isPathAllowed, matchesPattern, parseRobotsTxt } from './robots.js';
export { fetchSitemapUrls, SITEMAP_MAX_URLS } from './sitemap.js';
export { RESOURCE_UNVERIFIED_REASONS } from './types.js';
export type {
  CrawlError,
  CrawlFetchInit,
  CrawlFetcher,
  CrawlQueueEntry,
  CrawlRendering,
  CrawlResult,
  CrawlScope,
  CrawlerLogger,
  PageRendering,
  PageSnapshot,
  ResourceSnapshot,
  ResourceUnverifiedReason,
  RestoredCrawlCoverage,
  RestoredCrawlState,
} from './types.js';
