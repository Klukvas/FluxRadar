// Интеграция T-07 → T-09: полный прогон пяти passive-модулей на fixture-сайте
// краулера. Ожидания выведены из содержимого fixtures/site (D-145): cookie без
// флагов на /, тотальное отсутствие security headers, trackers.html с
// third-party скриптом и document.cookie, broken-image.html (img без alt +
// битая картинка), четыре страницы с видимым текстом < 200 символов,
// form.html без label. Fixture-сайт живёт на loopback-http → SEC-PASSIVE-003
// (HSTS) здесь Not applicable (юниты правила используют https-моки).

import type { ModuleName } from '@fluxradar/contracts';
import type { CrawlResult, FixtureSite } from '@fluxradar/crawler';
import { crawl, startFixtureSite } from '@fluxradar/crawler';
import { HostLimiter } from '@fluxradar/safe-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ModuleRunResult } from './engine/run-module.js';
import { runModuleRules } from './engine/run-module.js';
import { createSiteContext } from './engine/site-context.js';
import type { SiteContext } from './engine/types.js';

const PASSIVE_MODULES = [
  'Security',
  'Reliability',
  'Accessibility',
  'Content Quality',
  'Privacy',
] as const;

let site: FixtureSite;
let origin = '';
let crawlResult: CrawlResult;
let ctx: SiteContext;
const results = new Map<ModuleName, ModuleRunResult>();

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
  ctx = createSiteContext({ origin, crawl: crawlResult, plan: 'Complete' });
  for (const module of PASSIVE_MODULES) {
    results.set(module, runModuleRules(module, ctx));
  }
}, 30_000);

afterAll(async () => {
  await site.close();
});

function moduleResult(module: ModuleName): ModuleRunResult {
  const result = results.get(module);
  if (result === undefined) {
    throw new Error(`модуль ${module} не прогонялся`);
  }
  return result;
}

/** ruleId → отсортированные пути findings ('' — site-level, D-019). */
function findingPathsByRule(module: ModuleName): Readonly<Record<string, readonly string[]>> {
  const byRule = new Map<string, string[]>();
  for (const finding of moduleResult(module).findings) {
    const path = finding.normalizedUrl === '' ? '' : finding.normalizedUrl.slice(origin.length);
    const paths = byRule.get(finding.ruleId) ?? [];
    paths.push(path);
    byRule.set(finding.ruleId, paths);
  }
  return Object.fromEntries([...byRule].map(([ruleId, paths]) => [ruleId, [...paths].sort()]));
}

const ALL_HTML_PAGES = [
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
];

describe('passive-модули на fixture-сайте краулера', () => {
  it('Security: headers отсутствуют везде, cookie без флагов на /; HSTS N/A', () => {
    expect(findingPathsByRule('Security')).toEqual({
      'SEC-ASVS-001': ALL_HTML_PAGES,
      'SEC-ASVS-002': ALL_HTML_PAGES,
      'SEC-PASSIVE-002': ALL_HTML_PAGES,
      'SEC-PASSIVE-005': ['/'],
    });
    const cookie = moduleResult('Security').findings.find(
      (finding) => finding.ruleId === 'SEC-PASSIVE-005',
    );
    expect(cookie?.normalizedParameter).toBe('fixture_session');
    // http-сайт → HSTS Not applicable: applicable = 0, findings нет (D-162).
    const hsts = moduleResult('Security').evaluations.find(
      (entry) => entry.ruleId === 'SEC-PASSIVE-003',
    );
    expect(hsts?.applicableTargets).toBe(0);
  });

  it('Reliability: все URL доступны и быстры, api-проверки не заданы → пусто', () => {
    expect(findingPathsByRule('Reliability')).toEqual({});
    const byRule = new Map(
      moduleResult('Reliability').evaluations.map((entry) => [entry.ruleId, entry]),
    );
    expect(byRule.get('REL-URL-001')?.applicableTargets).toBe(17);
    expect(byRule.get('REL-URL-003')?.applicableTargets).toBe(17);
    expect(byRule.get('REL-URL-009')?.applicableTargets).toBe(17);
    expect(byRule.get('REL-API-003')?.applicableTargets).toBe(0);
    expect(byRule.get('REL-API-005')?.applicableTargets).toBe(0);
  });

  it('Accessibility: img без alt и input без label', () => {
    expect(findingPathsByRule('Accessibility')).toEqual({
      'A11Y-002': ['/broken-image.html'],
      'A11Y-003': ['/empty.html'],
      'A11Y-004': ['/form.html'],
      'A11Y-010': ALL_HTML_PAGES,
    });
    const unlabelled = moduleResult('Accessibility').findings.find(
      (finding) => finding.ruleId === 'A11Y-004',
    );
    expect(unlabelled?.normalizedSelector).toBe('input[name="nickname"]');
  });

  it('§14: A11Y-002 и SEO-ONPAGE-005 делят evidenceGroupId на /broken-image.html', () => {
    const a11y = moduleResult('Accessibility').findings.find(
      (finding) => finding.ruleId === 'A11Y-002',
    );
    const seo = runModuleRules('SEO', ctx).findings.find(
      (finding) => finding.ruleId === 'SEO-ONPAGE-005',
    );
    expect(a11y?.evidenceGroupId).toMatch(/^evg-v1:/);
    expect(a11y?.evidenceGroupId).toBe(seo?.evidenceGroupId);
    expect(a11y?.fingerprint).not.toBe(seo?.fingerprint);
  });

  it('Content Quality: четыре страницы < 200 символов и битая картинка', () => {
    expect(findingPathsByRule('Content Quality')).toEqual({
      'CONTENT-003': ['/deep/level2/page.html', '/empty.html', '/orphan.html', '/trackers.html'],
      'CONTENT-004': ['/broken-image.html'],
    });
    const media = moduleResult('Content Quality').findings.find(
      (finding) => finding.ruleId === 'CONTENT-004',
    );
    // Краулер v0.1 media не фетчит → оба img не подтверждены обходом (D-165).
    expect(media?.evidenceExcerpt).toContain('/img/missing.png');
    expect(media?.confidence).toBe(0.6);
  });

  it('Privacy: cookies на / и trackers.html, third-party скрипт на trackers.html', () => {
    expect(findingPathsByRule('Privacy')).toEqual({
      'PRIVACY-001': ['/', '/trackers.html'],
      'PRIVACY-003': ['/trackers.html'],
      'PRIVACY-004': [''],
    });
    const thirdParty = moduleResult('Privacy').findings.find(
      (finding) => finding.ruleId === 'PRIVACY-003',
    );
    expect(thirdParty?.evidenceExcerpt).toContain('stats.example.com');
  });

  it('coverage: снимков без fetchError 17 → все checks каждого модуля завершены', () => {
    expect(crawlResult.pages).toHaveLength(17);
    const expectedChecks: Readonly<Record<string, number>> = {
      // Existing 33 checks + ASVS-001×16 + ASVS-002×16 + ASVS-003×17.
      Security: 82,
      // REL-URL-001/003/009×17; api-правила без ctx.apiChecks — 0.
      Reliability: 51,
      // A11Y-002/004×16.
      // A11Y-001..010 ×16 HTML pages + A11Y-011 site report contract ×1.
      Accessibility: 161,
      // CONTENT-003/004×16.
      'Content Quality': 32,
      // PRIVACY-001×17 + PRIVACY-002×16 + PRIVACY-003×16 + PRIVACY-004×1.
      Privacy: 50,
    };
    for (const module of PASSIVE_MODULES) {
      const result = moduleResult(module);
      expect(result.applicableChecks, module).toBe(expectedChecks[module]);
      expect(result.completedApplicableChecks, module).toBe(expectedChecks[module]);
    }
  });

  it('fingerprint-ы уникальны, severity приходит из реестра contracts', () => {
    const allFindings = PASSIVE_MODULES.flatMap((module) => moduleResult(module).findings);
    const fingerprints = allFindings.map((finding) => finding.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    const severityByRule = new Map(
      allFindings.map((finding) => [finding.ruleId, finding.severity]),
    );
    expect(severityByRule.get('SEC-PASSIVE-002')).toBe('Medium');
    expect(severityByRule.get('SEC-PASSIVE-005')).toBe('Medium');
    expect(severityByRule.get('A11Y-002')).toBe('Medium');
    expect(severityByRule.get('CONTENT-003')).toBe('Medium');
    expect(severityByRule.get('PRIVACY-001')).toBe('Low');
    expect(severityByRule.get('PRIVACY-003')).toBe('Low');
  });
});
