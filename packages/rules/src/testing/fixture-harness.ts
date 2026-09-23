// Тестовый harness (в сборку не входит — tsconfig.build исключает
// src/testing): строит мини-SiteContext из fx-фикстур D-025.
// .html-фикстура → одна 2xx-страница /page.html; .json-фикстура → полный
// снимок сайта (страницы, sitemap, urlVariants, robots). JSON валидируется
// zod-схемой — битая фикстура падает с внятной ошибкой, а не даёт ложный тест.

import { readFileSync } from 'node:fs';

import type { ModuleName } from '@fluxradar/contracts';
import type { CrawlResult, PageSnapshot, ResourceSnapshot } from '@fluxradar/crawler';
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
  timingMs: z.number().int().min(0).default(5),
  contentType: z.string().default('text/html; charset=utf-8'),
  /** Link distance from the entry point; only resume logic reads it. */
  depth: z.number().int().min(0).default(0),
});

const ApiCheckSchema = z.object({
  method: z.enum(['GET', 'HEAD', 'OPTIONS']).default('GET'),
  url: z.string(),
  expectedStatus: z.array(z.number().int()).optional(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  snapshot: z
    .object({ status: z.number().int(), timingMs: z.number().int().min(0).default(5) })
    .optional(),
});

/**
 * A media resource the crawl asked about directly.
 *
 * `unverifiedReason` is how a fixture expresses "we never actually checked
 * this" — robots.txt, an exhausted budget, a pause — which a rule must not read
 * as either working or broken.
 */
const FixtureResourceSchema = z.object({
  path: z.string().regex(/^\//, 'path фикстуры начинается с /'),
  status: z.number().int().min(0).max(599).default(200),
  contentType: z.string().nullable().default('image/png'),
  method: z.enum(['HEAD', 'GET']).default('HEAD'),
  unverifiedReason: z
    .enum(['RobotsDisallowed', 'BudgetExhausted', 'Stopped', 'RequestFailed'])
    .optional(),
  referencedBy: z.string().default('/page.html'),
});

const SiteFixtureSchema = z.object({
  origin: z.string().default(FIXTURE_ORIGIN),
  robotsTxt: z.string().optional(),
  sitemapUrls: z.array(z.string()).default([]),
  urlVariants: z.record(z.string(), z.array(z.string())).default({}),
  pages: z.array(FixturePageSchema),
  resources: z.array(FixtureResourceSchema).default([]),
  apiChecks: z.array(ApiCheckSchema).default([]),
  // URL-ы, которые обход увидел, но снимка не получил: правило их всё ещё
  // спрашивает (RuleEvaluation.requestedInputs), и это отличает «не обошли» от
  // «страницы больше нет».
  skippedOverLimit: z.array(z.string()).default([]),
  blockedByRobots: z.array(z.string()).default([]),
});

export type FixturePageInput = z.input<typeof FixturePageSchema>;
type FixturePage = z.output<typeof FixturePageSchema>;
type FixtureResource = z.output<typeof FixtureResourceSchema>;
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

/** Прогон модуля с фильтром по одному правилу — основной раннер тестов T-09. */
export function runRule(
  module: ModuleName,
  ruleId: string,
  ctx: SiteContext,
): readonly IssueCandidate[] {
  return runModuleRules(module, ctx).findings.filter((finding) => finding.ruleId === ruleId);
}

/** Прогон SEO-модуля с фильтром по одному правилу (раннер тестов T-08). */
export function runSeoRule(ruleId: string, ctx: SiteContext): readonly IssueCandidate[] {
  return runRule('SEO', ruleId, ctx);
}

function siteContextFromFixture(fixture: z.output<typeof SiteFixtureSchema>): SiteContext {
  const crawl: CrawlResult = {
    pages: fixture.pages.map((page) => toSnapshot(fixture.origin, page)),
    skippedOverLimit: fixture.skippedOverLimit,
    blockedByRobots: fixture.blockedByRobots,
    errors: [],
    urlVariants: fixture.urlVariants,
    ...(fixture.robotsTxt !== undefined ? { robotsTxt: fixture.robotsTxt } : {}),
    sitemapUrls: fixture.sitemapUrls,
    rejectedSeeds: [],
    rendering: { status: 'NotRequested' },
    resources: fixture.resources.map((resource) => toResourceSnapshot(fixture.origin, resource)),
    pendingQueue: [],
    stoppedEarly: false,
  };
  return createSiteContext({
    origin: fixture.origin,
    crawl,
    plan: 'Complete',
    ...(fixture.apiChecks.length > 0 ? { apiChecks: fixture.apiChecks } : {}),
  });
}

function toResourceSnapshot(origin: string, resource: FixtureResource): ResourceSnapshot {
  const requestedUrl = `${origin}${resource.path}`;
  const unchecked = resource.unverifiedReason !== undefined;
  return {
    requestedUrl,
    normalizedUrl: normalizeUrl(requestedUrl),
    finalUrl: requestedUrl,
    status: unchecked ? 0 : resource.status,
    contentType: unchecked ? null : resource.contentType,
    ...(unchecked ? {} : { method: resource.method }),
    timingMs: unchecked ? 0 : 3,
    ...(unchecked ? { unverifiedReason: resource.unverifiedReason } : {}),
    referencedBy: `${origin}${resource.referencedBy}`,
  };
}

function toSnapshot(origin: string, page: FixturePage): PageSnapshot {
  const requestedUrl = `${origin}${page.path}`;
  const finalUrl = `${origin}${page.finalPath ?? page.path}`;
  const failed = page.fetchError !== undefined;
  return {
    requestedUrl,
    normalizedUrl: normalizeUrl(requestedUrl),
    depth: page.depth,
    finalUrl: failed ? requestedUrl : finalUrl,
    status: failed ? 0 : page.status,
    headers: failed ? {} : { 'content-type': page.contentType, ...page.headers },
    redirectChain: page.redirectChain,
    html: failed ? null : page.html,
    contentType: failed ? null : page.contentType,
    timingMs: page.timingMs,
    truncated: false,
    ...(failed ? { fetchError: page.fetchError } : {}),
  };
}
