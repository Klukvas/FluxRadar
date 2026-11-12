import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BING_CATALOG_EXCLUSIONS,
  BING_CHECK_CATALOG,
  CATALOG_REGISTRY_EXCLUSIONS,
  COMPLETE_CATALOG_MODULES,
  COMPLETE_RULE_CATALOG,
  PERFORMANCE_CHECK_CATALOG,
  completeCatalogChecks,
  recordedCatalogIds,
} from './complete-check-catalog';
import type { ScanModule } from './api';
import { geoCatalogCapabilities } from './complete-catalog-copy';
import { FREE_SEO_RULE_IDS } from './free-seo-catalog';

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), '../..', path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
const literalList = (text: string, name: string) => {
  const match = new RegExp(`${name}\\s*(?:=|:)\\s*\\[([\\s\\S]*?)\\]`).exec(text);
  expect(match, name).not.toBeNull();
  return [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
};

describe('Complete catalog reflects implemented checks rather than a promised scan total', () => {
  it('accounts for every scanning registry ID once in its module or a reasoned exclusion', () => {
    const descriptors = [
      ...source('packages/contracts/src/ruleset-scanning.ts').matchAll(
        /ruleId: '([^']+)',\s*module: '([^']+)'/g,
      ),
    ];
    const included = Object.entries(COMPLETE_RULE_CATALOG).flatMap(([module, rows]) =>
      rows.map(([id]) => [id, module]),
    );
    const exclusions = Object.keys(CATALOG_REGISTRY_EXCLUSIONS);
    const accounted = [...included.map(([id]) => id), ...exclusions];
    expect(new Set(accounted).size).toBe(accounted.length);
    expect([...accounted].sort()).toEqual(descriptors.map((match) => match[1]).sort());
    for (const [id, module] of included) {
      expect(descriptors.find((entry) => entry[1] === id)?.[2]).toBe(module);
    }
    expect(Object.values(CATALOG_REGISTRY_EXCLUSIONS).every(Boolean)).toBe(true);
    expect(CATALOG_REGISTRY_EXCLUSIONS['GEO-VIS-009']).toBe('shared-free-ai-measurement');
    expect(CATALOG_REGISTRY_EXCLUSIONS['A11Y-011']).toBe('manual-review-boundary');
  });

  it('mirrors all implemented Performance IDs and only site-level Bing checks', () => {
    expect(PERFORMANCE_CHECK_CATALOG.map(([id]) => id)).toEqual(
      literalList(
        source('apps/api/src/integrations/performance/findings.ts'),
        'IMPLEMENTED_PERF_RULE_IDS',
      ),
    );
    const bing = [...BING_CHECK_CATALOG.map(([id]) => id), ...Object.keys(BING_CATALOG_EXCLUSIONS)];
    expect([...bing].sort()).toEqual(
      literalList(source('apps/api/src/integrations/bing/checks.ts'), 'BING_FINDING_CODES').sort(),
    );
    expect(new Set(bing).size).toBe(bing.length);
  });

  it('covers the exact ten Complete modules in tariff order', () => {
    const tariff = source('packages/contracts/src/tariffs.ts').split('  Complete: {')[1] ?? '';
    expect(COMPLETE_CATALOG_MODULES).toEqual(literalList(tariff, 'modules'));
    for (const module of COMPLETE_CATALOG_MODULES) {
      expect(
        module === 'AI SEO / GEO'
          ? geoCatalogCapabilities.en.length
          : completeCatalogChecks(module, [], 'en').length,
      ).toBeGreaterThan(0);
    }
  });

  it('excludes every Free and recorded ID from any module, including historical declared names', () => {
    const modules = [
      { module: 'SEO', metadata: { checks: [{ ruleId: 'SEO-TECH-004' }] } },
      {
        module: 'Security',
        metadata: {
          ruleChecks: [
            { ruleId: 'SEC-PASSIVE-001', title: 'TLS', applicableTargets: 1, affectedTargets: 0 },
          ],
        },
      },
    ] as unknown as ScanModule[];
    const recorded = recordedCatalogIds(modules);
    expect(recorded).toEqual(['SEO-TECH-004', 'SEC-PASSIVE-001']);
    const rows = COMPLETE_CATALOG_MODULES.flatMap((module) =>
      completeCatalogChecks(module, recorded, 'en'),
    );
    expect(rows.some(({ id }) => [...FREE_SEO_RULE_IDS, ...recorded].includes(id))).toBe(false);
    expect(completeCatalogChecks('SEO', [], 'en')).toHaveLength(21);
    expect(completeCatalogChecks('SEO', recorded, 'en')).toHaveLength(20);
    expect(completeCatalogChecks('Security', recorded, 'en')).toHaveLength(7);
  });

  it('anchors each expanded GEO capability to its implemented flow and the smaller Free scope', () => {
    const anchors: readonly [string, string, readonly string[]][] = [
      [
        'geo-additional-answers',
        'packages/ai/src/geo-module.ts',
        [
          'for (const request of input.requests)',
          'for (const answer of responses)',
          'await evaluateGeoAnswer(',
        ],
      ],
      [
        'geo-provider-scope',
        'apps/api/src/orchestrator/geo.ts',
        [
          "['anthropic', 'openai']",
          '(consent?.providers ?? []).filter',
          'OPT_IN_VISIBILITY_PROVIDERS.includes',
          'providers.flatMap((provider) =>',
        ],
      ],
      [
        'geo-discovery',
        'apps/api/src/orchestrator/run-attempt.ts',
        [
          'await generateGeoDiscoveryQuestions({',
          'context: profile',
          'generation.questions',
          'geoProvidersFor(consent)',
        ],
      ],
      [
        'geo-citations',
        'apps/api/src/orchestrator/geo-module-row.ts',
        [
          'computeGeoVisibilitySummaries({',
          'competitors,',
          'visibilitySummaryRecord(geo, siteDomain, brand, competitors)',
          'computeGeoAnswerPositions(positionInput)',
        ],
      ],
      [
        'geo-page-scope',
        'packages/rules/src/ai-readiness.ts',
        [
          'crawl.pages.filter(isSuccessfulHtmlPage)',
          'pages.map(toPageCheck)',
          'structuredData: hasCompleteJsonLd(page)',
          'socialPreview: hasSocialPreview(page)',
        ],
      ],
    ];
    expect(anchors.map(([id]) => id)).toEqual(geoCatalogCapabilities.en.map(([id]) => id));
    for (const [id, path, fragments] of anchors) {
      const implementation = source(path).replace(/\s+/g, ' ');
      for (const fragment of fragments)
        expect(implementation, `${id}: ${fragment}`).toContain(fragment);
    }
    const geoRequests = source('apps/api/src/orchestrator/geo.ts').replace(/\s+/g, ' ');
    expect(geoRequests).toContain('const questions = [...direct, ...discoveryQuestions]');
    expect(geoRequests).toContain('...(isDirect ? {} : { webSearch: true as const })');
    const free = source('apps/api/src/orchestrator/free-geo.ts').replace(/\s+/g, ' ');
    expect(free).toContain("FREE_GEO_PROVIDER: AiProviderName = 'anthropic'");
    expect(free).toContain('return [ freeGeoQuestionRequest({');
    expect(free).toContain('questions: []');
    const tariff =
      source('packages/contracts/src/tariffs.ts').split(' Free: {')[1]?.split(' Basic: {')[0] ?? '';
    expect(tariff).toMatch(/urlLimit:\s*1,/);
  });

  it('keeps readable catalog titles Ukrainian in Russian chrome', () => {
    for (const module of COMPLETE_CATALOG_MODULES) {
      expect(completeCatalogChecks(module, [], 'ru')).toEqual(
        completeCatalogChecks(module, [], 'uk'),
      );
      expect(completeCatalogChecks(module, [], 'en').every((row) => row.title !== row.id)).toBe(
        true,
      );
    }
    expect(geoCatalogCapabilities.ru).toEqual(geoCatalogCapabilities.uk);
  });
});
