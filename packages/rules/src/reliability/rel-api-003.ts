// REL-API-003 — expected status (api-level; severity из реестра).
//
// Оракул (§9 verdict precedence): для явно добавленных API-проверок
// (ctx.apiChecks) фактический статус ∈ expected_status → pass, даже если
// это 404/5xx (ожидаемый 404 — pass); статус вне списка → finding
// (неожиданный 404 — finding). Без явного списка ожидается любой 2xx.
// Applicable — только выполненные проверки с чистыми заголовками:
// заблокированные policy REL-API-005 запросы вердикта по статусу не имеют.
// parameter = HTTP-метод (различает проверки одного URL разными методами).

import { requireDescriptor } from '../engine/descriptor.js';
import { apiFinding } from '../engine/finding.js';
import type { ApiCheck, ApiRule, SiteContext, SiteRuleResult } from '../engine/types.js';
import { expectedStatusLabel, hasCredentialHeaders, isExpectedStatus } from './api-checks.js';

const descriptor = requireDescriptor('REL-API-003');

export const relApi003ExpectedStatus: ApiRule = {
  kind: 'api',
  descriptor,
  evaluateApiChecks(ctx: SiteContext): SiteRuleResult {
    const executed = (ctx.apiChecks ?? []).filter(
      (check) => !hasCredentialHeaders(check) && check.snapshot !== undefined,
    );
    const findings = executed.flatMap((check) => {
      const status = check.snapshot?.status;
      if (status === undefined || isExpectedStatus(check, status)) {
        return [];
      }
      return [unexpectedStatusFinding(check, status)];
    });
    return {
      findings,
      applicableTargets: executed.length,
      affectedTargets: findings.length,
    };
  },
};

function unexpectedStatusFinding(check: ApiCheck, status: number) {
  return apiFinding(descriptor, check, {
    evidenceType: 'http',
    evidence:
      `${check.method} ${check.url} → HTTP ${status}, ` +
      `ожидалось ${expectedStatusLabel(check)} (§9 precedence)`,
    recommendation:
      'Верните endpoint к ожидаемому статусу либо обновите expected_status ' +
      'проверки, если новое поведение намеренное.',
    parameter: check.method,
  });
}
