// Сборка SiteContext из результата обхода: domain — нормализованный origin
// (scheme+host+port без path), как его ожидает поле `domain` fingerprint-v1
// (golden-векторы T-03 используют форму `https://example.com`).

import type { Plan } from '@fluxradar/contracts';
import type { CrawlResult } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import type { SiteContext } from './types.js';

export interface SiteContextInput {
  readonly origin: string;
  readonly crawl: CrawlResult;
  readonly plan: Plan;
  readonly robotsTxt?: string;
}

export function normalizedOrigin(origin: string): string {
  return new URL(normalizeUrl(origin)).origin;
}

export function createSiteContext(input: SiteContextInput): SiteContext {
  return {
    origin: input.origin,
    domain: normalizedOrigin(input.origin),
    crawl: input.crawl,
    ...(input.robotsTxt !== undefined ? { robotsTxt: input.robotsTxt } : {}),
    plan: input.plan,
  };
}
