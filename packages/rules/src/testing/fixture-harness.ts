// Тестовый harness (в сборку не входит — tsconfig.build исключает
// src/testing): строит мини-SiteContext из fx-фикстур D-025.
// .html-фикстура → одна 2xx-страница /page.html; .json-фикстура → полный
// снимок сайта (страницы, sitemap, urlVariants, robots). JSON валидируется
// zod-схемой — битая фикстура падает с внятной ошибкой, а не даёт ложный тест.

import { readFileSync } from 'node:fs';

import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';
import { z } from 'zod';

import type { IssueCandidate } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import { createSiteContext } from '../engine/site-context.js';
import type { SiteContext } from '../engine/types.js';

export const FIXTURE_ORIGIN = 'https://fixture.test';

const FIXTURES_DIR = new URL('../../fixtures/', import.meta.url);

const RedirectHopSchema = z.object({
  url: z.string(),
  status: z.number().int(),
  location: z.string(),
});

const FixturePageSchema = z.object({
  path: z.string().regex(/^\//, 'path фикстуры начинается с /'),
  status: z.number().int().min(100).max(599).default(200),
  html: z.string().nullable().default(null),
  headers: z.record(z.string(), z.string()).default({}),
  redirectChain: z.array(RedirectHopSchema).default([]),
  finalPath: z.string().optional(),
  fetchError: z.string().optional(),
});

const SiteFixtureSchema = z.object({
  origin: z.string().default(FIXTURE_ORIGIN),
  robotsTxt: z.string().optional(),
  sitemapUrls: z.array(z.string()).default([]),
  urlVariants: z.record(z.string(), z.array(z.string())).default({}),
  pages: z.array(FixturePageSchema),
});

export type FixturePageInput = z.input<typeof FixturePageSchema>;
type FixturePage = z.output<typeof FixturePageSchema>;
type SiteFixtureInput = z.input<typeof SiteFixtureSchema>;

/** Контекст из fx-файла: расширение определяет формат (html | json). */
export function loadFixtureContext(fixtureName: string): SiteContext {
  const raw = readFileSync(new URL(fixtureName, FIXTURES_DIR), 'utf8');
  if (fixtureName.endsWith('.html')) {
    return htmlContext(raw);
  }
  if (fixtureName.endsWith('.json')) {
    return siteContextFromFixture(SiteFixtureSchema.parse(JSON.parse(raw)));
  }
  throw new Error(`fixture-harness: неизвестный формат фикстуры ${fixtureName}`);
}

/** Контекст из одной HTML-страницы (inline-кейсы юнит-тестов). */
export function htmlContext(html: string, page: Partial<FixturePageInput> = {}): SiteContext {
  return siteContextFromFixture(
    SiteFixtureSchema.parse({ pages: [{ path: '/page.html', html, ...page }] }),
  );
}

/** Контекст из произвольного набора страниц/метаданных (inline-кейсы). */
export function siteContext(fixture: SiteFixtureInput): SiteContext {
  return siteContextFromFixture(SiteFixtureSchema.parse(fixture));
}

/** Прогон SEO-модуля с фильтром по одному правилу — основной раннер тестов. */
export function runSeoRule(ruleId: string, ctx: SiteContext): readonly IssueCandidate[] {
  return runModuleRules('SEO', ctx).findings.filter((finding) => finding.ruleId === ruleId);
}

function siteContextFromFixture(fixture: z.output<typeof SiteFixtureSchema>): SiteContext {
  const crawl: CrawlResult = {
    pages: fixture.pages.map((page) => toSnapshot(fixture.origin, page)),
    skippedOverLimit: [],
    blockedByRobots: [],
    errors: [],
    urlVariants: fixture.urlVariants,
    ...(fixture.robotsTxt !== undefined ? { robotsTxt: fixture.robotsTxt } : {}),
    sitemapUrls: fixture.sitemapUrls,
  };
  return createSiteContext({ origin: fixture.origin, crawl, plan: 'Complete' });
}

function toSnapshot(origin: string, page: FixturePage): PageSnapshot {
  const requestedUrl = `${origin}${page.path}`;
  const finalUrl = `${origin}${page.finalPath ?? page.path}`;
  const failed = page.fetchError !== undefined;
  return {
    requestedUrl,
    normalizedUrl: normalizeUrl(requestedUrl),
    finalUrl: failed ? requestedUrl : finalUrl,
    status: failed ? 0 : page.status,
    headers: failed ? {} : { 'content-type': 'text/html; charset=utf-8', ...page.headers },
    redirectChain: page.redirectChain,
    html: failed ? null : page.html,
    contentType: failed ? null : 'text/html; charset=utf-8',
    timingMs: 5,
    truncated: false,
    ...(failed ? { fetchError: page.fetchError } : {}),
  };
}
