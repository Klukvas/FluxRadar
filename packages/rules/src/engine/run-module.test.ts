import { EVIDENCE_EXCERPT_MAX_CHARS } from '@fluxradar/contracts';
import { computeFingerprint } from '@fluxradar/fingerprint';
import type { ScoredFinding } from '@fluxradar/scoring';
import { computeModuleScore } from '@fluxradar/scoring';
import { describe, expect, it } from 'vitest';

import { loadFixtureContext, siteContext } from '../testing/fixture-harness.js';
import { runModuleRules } from './run-module.js';

const NO_TITLE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"></head>' +
  '<body><h1>Untitled</h1></body></html>';

const OK_HTML =
  '<!doctype html><html lang="en"><head><title>Fine fixture page</title></head>' +
  '<body><h1>Fine</h1></body></html>';

describe('runModuleRules: движок', () => {
  it('незарегистрированный модуль → внятная ошибка', () => {
    const ctx = siteContext({ pages: [{ path: '/', html: OK_HTML }] });
    expect(() => runModuleRules('Performance', ctx)).toThrow(/не имеет реализованных правил/);
  });

  it('дедуп по fingerprint: одинаковые findings схлопываются в один Issue-кандидат', () => {
    // Два снимка одного normalizedUrl (движок обязан быть устойчив к дублям
    // на входе): ONPAGE-001 даёт идентичный finding для каждого снимка.
    const ctx = siteContext({
      pages: [
        { path: '/page.html', html: NO_TITLE_HTML },
        { path: '/page.html', html: NO_TITLE_HTML },
      ],
    });
    const result = runModuleRules('SEO', ctx);
    const evaluation = result.evaluations.find((entry) => entry.ruleId === 'SEO-ONPAGE-001');
    expect(evaluation?.findings).toHaveLength(2);
    expect(result.findings.filter((f) => f.ruleId === 'SEO-ONPAGE-001')).toHaveLength(1);
  });

  it('coverage-счётчики: fetchError-страница — applicable check без completed', () => {
    const ctx = siteContext({
      pages: [
        { path: '/ok.html', html: OK_HTML },
        { path: '/gone.html', status: 404, html: OK_HTML },
        { path: '/down.html', fetchError: 'safe-fetch: network failure' },
      ],
    });
    const result = runModuleRules('SEO', ctx);
    // 8 default page-rules: 1 applicable (2xx html) + 1 незавершённый (down);
    // TECH-003/TECH-005 (любой HTTP-ответ): 2 applicable + 1 незавершённый;
    // 3 site-rules: 1/1. Three discovery page-rules make it 11×2 + 2×3 + 3 = 31,
    // with 11×1 + 2×2 + 3 = 18 completed checks.
    expect(result.applicableChecks).toBe(31);
    expect(result.completedApplicableChecks).toBe(18);
  });

  it('site-level: normalizedUrl пуст, fingerprint по D-019, агрегаты 1/1', () => {
    const result = runModuleRules('SEO', loadFixtureContext('fx-SEO-TECH-007-positive.json'));
    const candidate = result.findings.find((f) => f.ruleId === 'SEO-TECH-007');
    expect(candidate?.normalizedUrl).toBe('');
    expect(candidate?.applicableTargets).toBe(1);
    expect(candidate?.affectedTargets).toBe(1);
    expect(candidate?.fingerprint).toBe(
      computeFingerprint({
        domain: 'https://fixture.test',
        ruleId: 'SEO-TECH-007',
        targetKind: 'site',
        normalizedUrl: '',
        normalizedResource: '',
        normalizedSelector: '',
        normalizedParameter: 'https://fixture.test/page.html',
        ruleVariant: 'v1',
      }),
    );
  });

  it('Issue-кандидат несёт severity и scoreDelta из реестра contracts', () => {
    const result = runModuleRules('SEO', loadFixtureContext('fx-SEO-TECH-002-positive.json'));
    const candidate = result.findings.find((f) => f.ruleId === 'SEO-TECH-002');
    expect(candidate?.severity).toBe('Low');
    expect(candidate?.scoreDelta).toBe('scored');
  });

  it('IssueCandidate совместим со ScoredFinding: computeModuleScore принимает findings движка', () => {
    const result = runModuleRules('SEO', loadFixtureContext('fx-SEO-TECH-007-positive.json'));
    // Компайл-тайм контракт T-08 → T-04: findings движка присваиваются
    // ScoredFinding[] без адаптеров; рантайм — валидация scoring не кидает.
    const scored: readonly ScoredFinding[] = result.findings;
    const moduleScore = computeModuleScore(scored);
    expect(moduleScore.rulePenalties.map((rule) => rule.ruleId)).toContain('SEO-TECH-007');
    expect(moduleScore.score).toBeLessThan(100);
  });

  it('evidence_excerpt обрезается до 2048 code points на длинном evidence', () => {
    const longVariants = Array.from(
      { length: 80 },
      (_, index) => `https://fixture.test/page.html?v=${String(index).padStart(60, '0')}`,
    );
    const ctx = siteContext({
      pages: [{ path: '/page.html', html: OK_HTML }],
      urlVariants: { 'https://fixture.test/page.html': longVariants },
    });
    const candidate = runModuleRules('SEO', ctx).findings.find((f) => f.ruleId === 'SEO-TECH-007');
    expect(candidate).toBeDefined();
    expect([...(candidate?.evidenceExcerpt ?? '')]).toHaveLength(EVIDENCE_EXCERPT_MAX_CHARS);
  });
});
