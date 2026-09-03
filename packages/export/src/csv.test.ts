// CSV contract v1 (§16): снапшот байт-в-байт (UTF-8 без BOM, LF, фиксированный
// header, null → пустое поле, два знака для score/penalty/delta), канонический
// порядок строк, RFC 4180 quoting и экранирование формула-инъекции.

import { describe, expect, it } from 'vitest';

import { buildIssueRecord, buildSummaryRecord } from './builders.js';
import { EXPORT_CSV_COLUMNS, writeExportCsv } from './csv.js';
import { FIXTURE_CONTEXT, buildFixtureRecords } from './testing/fixtures.js';

const HEADER =
  'schema_version,record_type,scan_id,domain,plan,started_at,completed_at,observed_at,ruleset_version,module,module_status,scan_status,request_id_source,usage_source,tokenizer_version,coverage,applicable_checks,completed_applicable_checks,score,applicable_targets,affected_targets,rule_penalty,score_delta,issue_id,fingerprint,rule_id,target_kind,normalized_url,normalized_resource,normalized_selector,normalized_parameter,rule_variant,metric_key,evidence_group_id,category,severity,confidence,status,target_url,evidence_type,evidence_ref,evidence_excerpt,recommendation,status_reason,provider,api_version,model_id,prompt_version,request_id,ai_request_key,raw_text,provider_created_at,finish_reason,citations,usage,deletion_evidence_ref';

// Ожидаемый вывод writeExportCsv(buildFixtureRecords()) — зафиксирован
// байт-в-байт, включая настоящие fingerprint-v1 значения.
const EXPECTED_FIXTURE_CSV = `${[
  HEADER,
  '1.0,summary,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:12:00Z,rules-mvp-0.1,,,Completed,,,,1,,,96.50,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
  '1.0,module,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:05:00Z,rules-mvp-0.1,SEO,Completed,,,,,1,10,10,98.00,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
  '1.0,module,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:06:00Z,rules-mvp-0.1,AI SEO / GEO,Completed,,,,,1,5,5,100.00,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
  '1.0,module,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:04:00Z,rules-mvp-0.1,Security,Completed,,,,,1,4,4,75.00,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
  '1.0,ai_response,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:06:00Z,rules-mvp-0.1,AI SEO / GEO,Completed,,provider,provider,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,openai,v1,gpt-5-mini,geo-questions-v1,req_000001,ai:scan_01JFIXTURE:openai:6a1f:1,"Example.com is a well-known brand, cited by ""review"" sites.",2026-09-03T10:06:00Z,stop,"[""https://example.com""]","{""input_tokens"":120,""output_tokens"":40,""total_tokens"":160,""reasoning_units"":null,""search_units"":null,""citation_units"":null}",ai-001/deletion/req_000001',
  '1.0,issue,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:04:00Z,rules-mvp-0.1,Security,Completed,,,,,,,,,1,1,25.00,-25.00,iss_sec_hsts,fluxradar-fp-v1:287905a52ecb719d732ea1ce9d82adbc3d3c68e7e06970218d09ad3458aa4e30,SEC-PASSIVE-003,site,,security-headers,,strict-transport-security,v1,,,transport-security,Critical,1,New,https://example.com/,http,/reports/report_01J/evidence/iss_sec_hsts,"\'=HYPERLINK(""https://evil.example/x"") missing Strict-Transport-Security",Add Strict-Transport-Security with a positive max-age.,,,,,,,,,,,,,',
  '1.0,issue,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:05:00Z,rules-mvp-0.1,SEO,Completed,,,,,,,,,10,2,2.00,-2.00,iss_seo_b,fluxradar-fp-v1:0ec8e14d2cf3792d047b0ed8426dfb2c1f0cf451812cc12e9f4a17109cdf1dff,SEO-TECH-004,page,https://example.com/b,,,,v1,,,canonical,High,0.98,New,https://example.com/b,http,/reports/report_01J/evidence/iss_seo_b,HTTP 200; canonical points to https://example.com/other-b,Set a self-referencing canonical URL.,,,,,,,,,,,,,',
  '1.0,issue,scan_01JFIXTURE,https://example.com,Complete Scan,2026-09-03T10:00:00Z,2026-09-03T10:12:00Z,2026-09-03T10:05:00Z,rules-mvp-0.1,SEO,Completed,,,,,,,,,10,2,2.00,-2.00,iss_seo_a,fluxradar-fp-v1:ce669dd95f87a4aaad2b08546f72dfc146e63a8ee092aeba4a11b3a372c5d816,SEO-TECH-004,page,https://example.com/a,,,,v1,,,canonical,High,0.98,New,https://example.com/a,http,/reports/report_01J/evidence/iss_seo_a,HTTP 200; canonical points to https://example.com/other-a,Set a self-referencing canonical URL.,,,,,,,,,,,,,',
].join('\n')}\n`;

describe('writeExportCsv', () => {
  it('снапшот байт-в-байт: header §16, порядок строк, quoting, null → пустое поле', () => {
    // Вход перемешан — writer обязан выстроить канонический порядок сам:
    // summary → module → ai_response → issue (Critical → High, fingerprint lex).
    const shuffled = [...buildFixtureRecords()].reverse();
    expect(writeExportCsv(shuffled)).toBe(EXPECTED_FIXTURE_CSV);
  });

  it('UTF-8 без BOM, только LF, завершающий LF', () => {
    const bytes = Buffer.from(writeExportCsv([...buildFixtureRecords()]), 'utf8');
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(bytes.includes(0x0d)).toBe(false); // ни одного \r
    expect(bytes.at(-1)).toBe(0x0a);
  });

  it('header — ровно порядок полей data dictionary v1', () => {
    expect(EXPORT_CSV_COLUMNS.join(',')).toBe(HEADER);
    expect(EXPORT_CSV_COLUMNS).toHaveLength(56);
  });

  it('zero-issue export содержит summary-строку (§16)', () => {
    const summary = buildSummaryRecord(FIXTURE_CONTEXT, {
      scanStatus: 'Completed',
      statusReason: null,
      coverage: 1,
      score: 96.5,
    });
    const csv = writeExportCsv([summary]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + summary + пустой хвост после LF
    expect(lines[1]).toContain(',summary,');
    expect(lines[1]).toContain('96.50');
  });

  it('формула-инъекция: ведущие = + - @ получают префикс апострофа', () => {
    const probes = ['=HYPERLINK("x")', '+SUM(A1:A9)', '-2+3+cmd', '@cmd /c calc'] as const;
    const issues = probes.map((excerpt, index) =>
      buildIssueRecord(FIXTURE_CONTEXT, {
        issueId: `iss_inj_${index}`,
        module: 'SEO',
        moduleStatus: 'Completed',
        ruleId: 'SEO-TECH-004',
        targetKind: 'page',
        normalizedUrl: `https://example.com/inj-${index}`,
        normalizedResource: '',
        normalizedSelector: '',
        normalizedParameter: '',
        ruleVariant: 'v1',
        category: 'canonical',
        severity: 'High',
        confidence: 1,
        status: 'New',
        targetUrl: `https://example.com/inj-${index}`,
        evidenceType: 'dom',
        evidenceRef: `/reports/r/evidence/iss_inj_${index}`,
        evidenceExcerpt: excerpt,
        recommendation: 'Fix it.',
        applicableTargets: 4,
        affectedTargets: 4,
        rulePenalty: 10,
      }),
    );
    const csv = writeExportCsv(issues);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`'+SUM(A1:A9)`);
    expect(csv).toContain(`'-2+3+cmd`);
    expect(csv).toContain(`'@cmd /c calc`);
    // Числовые поля не экранируются: score_delta остаётся валидным числом.
    expect(csv).toContain(',10.00,-10.00,');
    expect(csv).not.toContain(`'-10.00`);
  });

  it('RFC 4180: перевод строки в значении квотируется, LF сохраняется внутри кавычек', () => {
    const summary = buildSummaryRecord(FIXTURE_CONTEXT, {
      scanStatus: 'Failed',
      statusReason: 'строка 1\nстрока 2',
      coverage: 0.2,
      score: null,
    });
    expect(writeExportCsv([summary])).toContain('"строка 1\nстрока 2"');
  });
});
