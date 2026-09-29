// Общие фикстуры тестов перелинковки (TECH-009/010/011): страница со ссылками,
// снимок, уехавший редиректом, и разбор RuleEvaluation прогона. Живёт в
// src/testing (в сборку не входит, tsconfig.build исключает), потому что тесты
// этих правил разнесены по файлам — по правилам, идентичности и области обхода, —
// а фикстура у них одна.

import type { CrawlResult } from '@fluxradar/crawler';

import type { IssueCandidate } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import type { RuleEvaluation, SiteContext } from '../engine/types.js';
import type { FixturePageInput } from './fixture-harness.js';
import { FIXTURE_ORIGIN } from './fixture-harness.js';

export const url = (path: string): string => `${FIXTURE_ORIGIN}${path}`;

/** Страница с заголовком и списком внутренних ссылок. */
export function page(path: string, links: readonly string[] = [], depth = 0): FixturePageInput {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join('');
  return {
    path,
    depth,
    html:
      `<!doctype html><html lang="en"><head><title>Page ${path}</title></head>` +
      `<body><h1>Page ${path}</h1>${anchors}</body></html>`,
  };
}

/** Тот же снимок, отданный по адресу `path` и уехавший редиректом на `finalPath`. */
export function redirected(
  path: string,
  finalPath: string,
  links: readonly string[] = [],
  depth = 1,
): FixturePageInput {
  return {
    ...page(path, links, depth),
    finalPath,
    redirectChain: [{ url: url(path), status: 301, location: url(finalPath) }],
  };
}

export function evaluation(ruleId: string, ctx: SiteContext): RuleEvaluation {
  const found = runModuleRules('SEO', ctx).evaluations.find((entry) => entry.ruleId === ruleId);
  if (found === undefined) {
    throw new Error(`правило ${ruleId} не прогонялось`);
  }
  return found;
}

/** Ровно один finding: иначе тест падает, назвав то, что пришло вместо него. */
export function single(candidates: readonly IssueCandidate[]): IssueCandidate {
  const [first, ...rest] = candidates;
  if (first === undefined || rest.length > 0) {
    const found = candidates.map((candidate) => candidate.normalizedUrl).join(', ');
    throw new Error(`ожидался ровно один finding, пришло ${candidates.length}: ${found}`);
  }
  return first;
}

export function paths(candidates: readonly IssueCandidate[]): readonly string[] {
  return candidates.map((candidate) => candidate.normalizedUrl.slice(FIXTURE_ORIGIN.length)).sort();
}

/** Тот же контекст с подменёнными полями обхода — для видов неполного графа. */
export function withCrawl(ctx: SiteContext, overrides: Partial<CrawlResult>): SiteContext {
  return { ...ctx, crawl: { ...ctx.crawl, ...overrides } };
}
