// Public-only AI crawler readiness report. This deliberately stays separate
// from provider-backed GEO visibility: it can run from the crawl snapshot and
// never requires customer credentials or an AI API token.

import type { CrawlResult, PageSnapshot, RobotsTxt } from '@fluxradar/crawler';
import { isPathAllowed, parseRobotsTxt } from '@fluxradar/crawler';

import { codePointLength, parsePage } from './seo/dom.js';
import { hasSocialPreview } from './seo/social-preview.js';
import { hasCompleteJsonLd } from './seo/structured-data.js';
import { visibleText } from './content/visible-text.js';

export const AI_CRAWLER_USER_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
  'Bytespider',
] as const;

export type AiCrawlerAgentStatus = 'allowed' | 'blocked' | 'unknown';

export interface AiCrawlerAgentCheck {
  readonly userAgent: string;
  readonly status: AiCrawlerAgentStatus;
}

export interface AiReadinessPageCheck {
  readonly url: string;
  readonly extractableContent: boolean;
  readonly structuredData: boolean;
  readonly socialPreview: boolean;
}

export interface AiCrawlerReadinessReport {
  readonly automation: 'public-http-dom';
  readonly providerTokenRequired: false;
  readonly robots: {
    readonly status: 'available' | 'unavailable';
    readonly agents: readonly AiCrawlerAgentCheck[];
  };
  readonly pages: {
    readonly checked: number;
    readonly extractableContent: number;
    readonly structuredData: number;
    readonly socialPreview: number;
    readonly checks: readonly AiReadinessPageCheck[];
  };
  readonly limitations: readonly string[];
}

export function assessAiCrawlerReadiness(crawl: CrawlResult): AiCrawlerReadinessReport {
  const robotsText = crawl.robotsTxt;
  const robots = robotsText === undefined ? null : parseRobotsTxt(robotsText);
  const pages = crawl.pages.filter(isSuccessfulHtmlPage);
  const checks = pages.map(toPageCheck);
  return {
    automation: 'public-http-dom',
    providerTokenRequired: false,
    robots: {
      status: robots === null ? 'unavailable' : 'available',
      agents: AI_CRAWLER_USER_AGENTS.map((userAgent) => ({
        userAgent,
        status: robots === null ? 'unknown' : crawlerStatus(robots, userAgent),
      })),
    },
    pages: {
      checked: checks.length,
      extractableContent: checks.filter((check) => check.extractableContent).length,
      structuredData: checks.filter((check) => check.structuredData).length,
      socialPreview: checks.filter((check) => check.socialPreview).length,
      checks,
    },
    limitations: [
      'Проверяется исходный HTML; контент, добавленный после загрузки JavaScript, может быть не виден.',
      'Статус AI-краулеров в robots.txt показывает политику сайта, а не фактическую индексацию или цитирование.',
      'Отчёт не утверждает, что сайт соответствует требованиям конкретного AI-провайдера.',
    ],
  };
}

function toPageCheck(page: PageSnapshot): AiReadinessPageCheck {
  const root = parsePage(page);
  const text = visibleText(page);
  const hasHeading = root.querySelector('h1') !== null || root.querySelector('h2') !== null;
  const hasContentContainer =
    root.querySelector('main') !== null ||
    root.querySelector('article') !== null ||
    root.querySelector('body') !== null;
  return {
    url: page.finalUrl,
    extractableContent: codePointLength(text) >= 200 && hasHeading && hasContentContainer,
    structuredData: hasCompleteJsonLd(page),
    socialPreview: hasSocialPreview(page),
  };
}

function crawlerStatus(robots: RobotsTxt, userAgent: string): AiCrawlerAgentStatus {
  return isPathAllowed(robots, userAgent, '/') ? 'allowed' : 'blocked';
}

function isSuccessfulHtmlPage(page: PageSnapshot): boolean {
  return (
    page.fetchError === undefined && page.status >= 200 && page.status < 300 && page.html !== null
  );
}
