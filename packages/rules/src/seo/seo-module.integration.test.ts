// Интеграция T-07 → T-08: полный прогон SEO-модуля на fixture-сайте краулера.
// Ожидания выведены из содержимого fixtures/site (T-07, D-145): точный набор
// {ruleId → normalizedUrl[]}; длины title/description пересчитаны по факту
// (десять страниц имеют meta description короче 50 символов — ONPAGE-002).

import type { CrawlResult, FixtureSite } from '@fluxradar/crawler';
import { crawl, startFixtureSite } from '@fluxradar/crawler';
import { HostLimiter } from '@fluxradar/safe-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ModuleRunResult } from '../engine/run-module.js';
import { runModuleRules } from '../engine/run-module.js';
import { createSiteContext } from '../engine/site-context.js';

let site: FixtureSite;
let origin = '';
let crawlResult: CrawlResult;
let result: ModuleRunResult;

beforeAll(async () => {
  site = await startFixtureSite();
  origin = site.origin;
  crawlResult = await crawl(
    { origin, includeSubdomains: false, maxPages: 50 },
    {
      dangerouslyAllowLoopback: true,
      limiter: new HostLimiter({ rps: 1000, concurrency: 4 }),
      logger: { warn: () => undefined },
    },
  );
  result = runModuleRules(
    'SEO',
    createSiteContext({ origin, crawl: crawlResult, plan: 'Complete' }),
  );
}, 30_000);

afterAll(async () => {
  await site.close();
});

/** ruleId → отсортированные пути findings ('' — site-level, D-019). */
function findingPathsByRule(): Readonly<Record<string, readonly string[]>> {
  const byRule = new Map<string, string[]>();
  for (const finding of result.findings) {
    const path = finding.normalizedUrl === '' ? '' : finding.normalizedUrl.slice(origin.length);
    const paths = byRule.get(finding.ruleId) ?? [];
    paths.push(path);
    byRule.set(finding.ruleId, paths);
  }
  return Object.fromEntries([...byRule].map(([ruleId, paths]) => [ruleId, [...paths].sort()]));
}

describe('SEO-модуль на fixture-сайте краулера', () => {
  it('даёт точный ожидаемый набор {ruleId → normalizedUrl[]}', () => {
    expect(findingPathsByRule()).toEqual({
      // robots.txt и sitemap.xml на fixture-сайте есть → TECH-001/002 молчат.
      'SEO-TECH-003': ['/missing'],
      'SEO-TECH-004': [
        '/broken-image.html',
        '/broken-link.html',
        '/deep/',
        '/deep/level2/page.html',
        '/dup-a.html',
        '/dup-b.html',
        '/empty.html',
        '/form.html',
        '/mixed-content.html',
        '/no-title.html',
        '/noindex.html',
        '/orphan.html',
        '/redirect-a',
        '/trackers.html',
        '/wrong-canonical.html',
      ],
      'SEO-TECH-005': ['/redirect-a'],
      'SEO-TECH-006': ['/broken-link.html'],
      'SEO-TECH-007': [''],
      'SEO-TECH-008': ['/noindex.html'],
      'SEO-TECH-013': ['/mixed-content.html'],
      'SEO-ONPAGE-001': ['/no-title.html'],
      'SEO-ONPAGE-002': [
        '/deep/level2/page.html',
        '/dup-a.html',
        '/dup-b.html',
        '/empty.html',
        '/form.html',
        '/mixed-content.html',
        '/no-title.html',
        '/noindex.html',
        '/orphan.html',
        '/redirect-a',
      ],
      // Единственная страница без h1 — почти пустой /empty.html.
      'SEO-ONPAGE-003': ['/empty.html'],
      'SEO-ONPAGE-005': ['/broken-image.html'],
      'SEO-SOCIAL-001': [
        '/',
        '/broken-image.html',
        '/broken-link.html',
        '/deep/',
        '/deep/level2/page.html',
        '/dup-a.html',
        '/dup-b.html',
        '/empty.html',
        '/form.html',
        '/mixed-content.html',
        '/no-title.html',
        '/noindex.html',
        '/orphan.html',
        '/redirect-a',
        '/trackers.html',
        '/wrong-canonical.html',
      ],
    });
  });

  it('дубль URL: группа dup-a с utm-вариантом, fingerprint-ы уникальны', () => {
    const duplicate = result.findings.find((finding) => finding.ruleId === 'SEO-TECH-007');
    expect(duplicate?.normalizedParameter).toBe(`${origin}/dup-a.html`);
    const fingerprints = result.findings.map((finding) => finding.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    expect(result.findings).toHaveLength(50);
  });

  it('агрегаты и coverage: 17 снимков без fetchError → все checks завершены', () => {
    expect(crawlResult.pages).toHaveLength(17);
    // 11 default page-rules × 16 (2xx HTML) + TECH-003/005 × 17 + 3 site-rules.
    expect(result.applicableChecks).toBe(213);
    expect(result.completedApplicableChecks).toBe(213);
    const canonical = result.evaluations.find((entry) => entry.ruleId === 'SEO-TECH-004');
    expect(canonical?.applicableTargets).toBe(16);
    expect(canonical?.affectedTargets).toBe(15);
  });

  it('severity Issue-кандидатов приходит из реестра contracts', () => {
    const byRule = new Map(result.findings.map((finding) => [finding.ruleId, finding.severity]));
    expect(byRule.get('SEO-TECH-006')).toBe('High');
    expect(byRule.get('SEO-TECH-013')).toBe('High');
    expect(byRule.get('SEO-ONPAGE-005')).toBe('Low');
  });
});
