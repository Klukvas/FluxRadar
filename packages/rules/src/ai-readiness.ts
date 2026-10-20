// Public-only AI crawler readiness report. This deliberately stays separate
// from provider-backed GEO visibility: it can run from the crawl snapshot and
// never requires customer credentials or an AI API token.

import type { CrawlResult, PageSnapshot, RobotsTxt } from '@fluxradar/crawler';
import { isPathAllowed, isSuccessfulHtmlPage, parseRobotsTxt } from '@fluxradar/crawler';

import { codePointLength, parsePage } from './seo/dom.js';
import { hasSocialPreview } from './seo/social-preview.js';
import { hasCompleteJsonLd } from './seo/structured-data.js';
import { visibleText } from './content/visible-text.js';

export type AiCrawlerPurpose = 'search' | 'user-fetch' | 'training';
// Vendor purpose references, verified 2026-10-19. These are robots policies,
// not a claim every user fetcher obeys robots.txt (Perplexity-User generally does not).
// OpenAI: https://developers.openai.com/api/docs/bots
// Anthropic: https://support.claude.com/en/articles/8896518
// Perplexity: https://docs.perplexity.ai/docs/resources/perplexity-crawlers
// Google: https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended
// Apple: https://support.apple.com/en-us/119829
// Common Crawl: https://commoncrawl.org/ccbot (public corpus; also used for training).
// Bytespider retains the existing training classification; ByteDance has no public
// bot-purpose documentation comparable to the vendors above.
// Google-Extended also controls some Gemini grounding uses; it does not control Google Search.
export const AI_CRAWLER_USER_AGENTS = [
  ...['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'].map((userAgent) => ({
    userAgent,
    purpose: 'search' as const,
  })),
  ...['ChatGPT-User', 'Claude-User', 'Perplexity-User'].map((userAgent) => ({
    userAgent,
    purpose: 'user-fetch' as const,
  })),
  ...['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider'].map(
    (userAgent) => ({ userAgent, purpose: 'training' as const }),
  ),
] as const;

export type AiCrawlerAgentStatus = 'allowed' | 'blocked' | 'unknown';

export interface AiCrawlerAgentCheck {
  readonly userAgent: string;
  readonly purpose: AiCrawlerPurpose;
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
      agents: AI_CRAWLER_USER_AGENTS.map(({ userAgent, purpose }) => ({
        userAgent,
        purpose,
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
