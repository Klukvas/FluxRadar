// @fluxradar/crawler — обход сайта в пределах scope (T-07, план §3).
// robots.txt по умолчанию, sitemap как источник seed-ов, дедуп по
// normalizeUrl, лимиты страниц/глубины, per-host авто-throttle (D-030).

export { CONSECUTIVE_5XX_HOST_STOP, crawl } from './crawler.js';
export type { CrawlOptions } from './crawler.js';
export { startFixtureSite } from './fixture-server.js';
export type { FixtureSite } from './fixture-server.js';
export { extractLinks } from './link-extractor.js';
export type { RobotsGroup, RobotsRule, RobotsTxt } from './robots.js';
export { isPathAllowed, matchesPattern, parseRobotsTxt } from './robots.js';
export { fetchSitemapUrls, SITEMAP_MAX_URLS } from './sitemap.js';
export type {
  CrawlError,
  CrawlFetcher,
  CrawlResult,
  CrawlScope,
  CrawlerLogger,
  PageSnapshot,
} from './types.js';
