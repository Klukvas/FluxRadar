// @fluxradar/crawler — обход сайта в пределах scope (T-07, план §3).
// robots.txt по умолчанию, sitemap как источник seed-ов, дедуп по
// normalizeUrl, лимиты страниц/глубины, per-host авто-throttle (D-030).

export { assessSiteReach, crawlCoverage, isSuccessfulHtmlPage } from './crawl-outcome.js';
export type { CrawlCoverage, SiteReach, SiteReachKind } from './crawl-outcome.js';
export { CONSECUTIVE_5XX_HOST_STOP, crawl } from './crawler.js';
export type { CrawlOptions } from './crawler.js';
export { startFixtureSite } from './fixture-server.js';
export type { FixtureSite } from './fixture-server.js';
export { extractLinks, extractMediaUrls, MEDIA_SELECTOR } from './link-extractor.js';
export { checkReferencedMedia } from './media-check.js';
export type { MediaCheckOptions, MediaCheckOutcome } from './media-check.js';
export type { RobotsGroup, RobotsRule, RobotsTxt } from './robots.js';
export { isPathAllowed, matchesPattern, parseRobotsTxt } from './robots.js';
export { fetchSitemapUrls, SITEMAP_MAX_URLS } from './sitemap.js';
export {
  CRAWLER_INFO_URL,
  CRAWLER_PRODUCT_TOKEN,
  CRAWLER_USER_AGENT,
  CRAWLER_VERSION,
  crawlerUserAgent,
} from './user-agent.js';
export type {
  CrawlError,
  CrawlFetcher,
  CrawlResult,
  CrawlScope,
  CrawlerLogger,
  PageSnapshot,
} from './types.js';
