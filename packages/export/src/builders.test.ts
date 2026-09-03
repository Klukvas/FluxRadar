// Билдеры канонических records: D-014 (все поля явно), производные инварианты
// (score_delta = −penalty, fingerprint из компонент) и fail-fast на нарушениях
// контракта §16 во входе.

import { computeFingerprint } from '@fluxradar/fingerprint';
import { describe, expect, it } from 'vitest';

import { buildAiResponseRecord, buildIssueRecord, buildSummaryRecord } from './builders.js';
import { ExportBuildError } from './errors.js';
import { EXPORT_RECORD_FIELDS } from './fields.js';
import { validateExportRecords } from './validate.js';
import { FIXTURE_CONTEXT, buildFixtureRecords, fixtureSeoIssue } from './testing/fixtures.js';

describe('record builders', () => {
  it('D-014: каждый record содержит все 56 полей data dictionary явно', () => {
    for (const record of buildFixtureRecords()) {
      expect(Object.keys(record).sort(), record.record_type).toEqual(
        [...EXPORT_RECORD_FIELDS].sort(),
      );
    }
  });

  it('полный snapshot от билдеров проходит schema + semantic pipeline', () => {
    const result = validateExportRecords([...buildFixtureRecords()]);
    expect(result).toMatchObject({ ok: true });
  });

  it('issue: score_delta выводится как −rule_penalty (D-016/EXPORT-001-7)', () => {
    const issue = fixtureSeoIssue('a');
    expect(issue.rule_penalty).toBe(2);
    expect(issue.score_delta).toBe(-2);
  });

  it('issue: нулевой penalty даёт score_delta ровно 0 (не −0)', () => {
    const issue = buildIssueRecord(FIXTURE_CONTEXT, {
      ...seoIssueInput(),
      rulePenalty: 0,
    });
    expect(Object.is(issue.score_delta, 0)).toBe(true);
  });

  it('issue: fingerprint совпадает с пересчётом fingerprint-v1 из компонент', () => {
    const issue = fixtureSeoIssue('a');
    expect(issue.fingerprint).toBe(
      computeFingerprint({
        domain: FIXTURE_CONTEXT.domain,
        ruleId: issue.rule_id,
        targetKind: issue.target_kind,
        normalizedUrl: issue.normalized_url,
        normalizedResource: issue.normalized_resource,
        normalizedSelector: issue.normalized_selector,
        normalizedParameter: issue.normalized_parameter,
        ruleVariant: issue.rule_variant,
      }),
    );
  });

  it('issue: расхождение с сохранённым fingerprint — ошибка сборки', () => {
    expect(() =>
      buildIssueRecord(FIXTURE_CONTEXT, {
        ...seoIssueInput(),
        expectedFingerprint: 'fluxradar-fp-v1:0000',
      }),
    ).toThrow(ExportBuildError);
  });

  it('issue: site-level с непустым normalized_url отклоняется (D-019)', () => {
    expect(() =>
      buildIssueRecord(FIXTURE_CONTEXT, {
        ...seoIssueInput(),
        targetKind: 'site',
        normalizedUrl: 'https://example.com/',
        applicableTargets: 1,
        affectedTargets: 1,
      }),
    ).toThrow(ExportBuildError);
  });

  it('issue: affected > applicable отклоняется (EXPORT-001/6)', () => {
    expect(() =>
      buildIssueRecord(FIXTURE_CONTEXT, {
        ...seoIssueInput(),
        applicableTargets: 1,
        affectedTargets: 2,
      }),
    ).toThrow(ExportBuildError);
  });

  it('issue: evidence_excerpt сверх 2048 символов — ошибка, а не тихое усечение', () => {
    expect(() =>
      buildIssueRecord(FIXTURE_CONTEXT, {
        ...seoIssueInput(),
        evidenceExcerpt: 'x'.repeat(2049),
      }),
    ).toThrow(ExportBuildError);
  });

  it('summary: не-Completed статус без причины отклоняется (§16)', () => {
    expect(() =>
      buildSummaryRecord(FIXTURE_CONTEXT, {
        scanStatus: 'Failed',
        statusReason: null,
        coverage: 0.4,
        score: null,
      }),
    ).toThrow(ExportBuildError);
  });

  it('summary: Completed с непустой причиной отклоняется (§16)', () => {
    expect(() =>
      buildSummaryRecord(FIXTURE_CONTEXT, {
        scanStatus: 'Completed',
        statusReason: 'лишнее',
        coverage: 1,
        score: 90,
      }),
    ).toThrow(ExportBuildError);
  });

  it('ai_response: usage.total != input + output отклоняется (§5)', () => {
    expect(() =>
      buildAiResponseRecord(FIXTURE_CONTEXT, {
        ...aiInput(),
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 16 },
      }),
    ).toThrow(ExportBuildError);
  });

  it('ai_response: usage_source=estimated без tokenizer_version отклоняется', () => {
    expect(() =>
      buildAiResponseRecord(FIXTURE_CONTEXT, {
        ...aiInput(),
        usageSource: 'estimated',
        tokenizerVersion: null,
      }),
    ).toThrow(ExportBuildError);
  });

  it('timestamp без Z в контексте скана отклоняется (EXPORT-001/2)', () => {
    expect(() =>
      buildSummaryRecord(
        { ...FIXTURE_CONTEXT, startedAt: '2026-09-03T10:00:00+03:00' },
        { scanStatus: 'Completed', statusReason: null, coverage: 1, score: 90 },
      ),
    ).toThrow(ExportBuildError);
  });

  it('observed_at вне интервала started..completed отклоняется (EXPORT-001/2)', () => {
    expect(() =>
      buildIssueRecord(FIXTURE_CONTEXT, {
        ...seoIssueInput(),
        observedAt: '2026-09-03T11:00:00Z',
      }),
    ).toThrow(ExportBuildError);
  });
});

function seoIssueInput() {
  return {
    issueId: 'iss_probe',
    module: 'SEO',
    moduleStatus: 'Completed',
    ruleId: 'SEO-TECH-004',
    targetKind: 'page',
    normalizedUrl: 'https://example.com/probe',
    normalizedResource: '',
    normalizedSelector: '',
    normalizedParameter: '',
    ruleVariant: 'v1',
    category: 'canonical',
    severity: 'High',
    confidence: 1,
    status: 'New',
    targetUrl: 'https://example.com/probe',
    evidenceType: 'http',
    evidenceRef: '/reports/r/evidence/iss_probe',
    evidenceExcerpt: 'probe evidence',
    recommendation: 'Fix it.',
    applicableTargets: 10,
    affectedTargets: 2,
    rulePenalty: 2,
  } as const;
}

function aiInput() {
  return {
    moduleStatus: 'Completed',
    statusReason: null,
    provider: 'openai',
    apiVersion: 'v1',
    modelId: 'gpt-5-mini',
    promptVersion: 'geo-questions-v1',
    requestId: 'req_probe',
    requestIdSource: 'provider',
    aiRequestKey: 'ai:scan:openai:hash:1',
    rawText: 'probe',
    providerCreatedAt: null,
    citations: [],
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    usageSource: 'provider',
    tokenizerVersion: null,
    finishReason: 'stop',
    deletionEvidenceRef: 'ai-001/deletion/req_probe',
  } as const;
}
