// REL-API-003 — expected status (api-level; severity из реестра).
//
// Оракул (§9 verdict precedence): для явно добавленных API-проверок
// (ctx.apiChecks) фактический статус ∈ expected_status → pass, даже если
// это 404/5xx (ожидаемый 404 — pass); статус вне списка → finding
// (неожиданный 404 — finding). Без явного списка ожидается любой 2xx.
// Applicable — только выполненные проверки с чистыми заголовками:
// заблокированные policy REL-API-005 запросы вердикта по статусу не имеют.
// parameter = HTTP-метод (различает проверки одного URL разными методами).

import { normalizeUrl } from '@fluxradar/fingerprint';

import { requireDescriptor } from '../engine/descriptor.js';
import { apiFinding } from '../engine/finding.js';
import type { ApiCheck, ApiRule, SiteContext, SiteRuleResult } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { expectedStatusLabel, hasCredentialHeaders, isExpectedStatus } from './api-checks.js';

const descriptor = requireDescriptor('REL-API-003');

export const relApi003ExpectedStatus: ApiRule = {
  kind: 'api',
  descriptor,
  evaluateApiChecks(ctx: SiteContext): SiteRuleResult {
    const vetted = (ctx.apiChecks ?? []).filter((check) => !hasCredentialHeaders(check));
    const executed = vetted.filter((check) => check.snapshot !== undefined);
    // An endpoint that timed out, was refused, or redirected off the scanned
    // site is still one of this module's targets — it just has no verdict.
    // Dropping it would report full coverage for a check that never happened.
    const unreachable = vetted.filter(
      (check) => check.snapshot === undefined && check.unavailable?.applicable === true,
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
      applicableTargets: executed.length + unreachable.length,
      completedTargets: executed.length,
      affectedTargets: findings.length,
      // Проверенные цели — URL выполненных проверок, в той же нормализации, что
      // и normalizedUrl их findings. Обход страниц сюда не входит: страница и
      // API-endpoint по одному URL — разные проверки (§9, политика Resolved).
      checkedTargets: executed.map((check) => normalizeUrl(check.url)),
    };
  },
};

function unexpectedStatusFinding(check: ApiCheck, status: number) {
  return apiFinding(descriptor, check, {
    evidenceType: 'http',
    evidence: findingMessage('rel-api-003.evidence', {
      method: check.method,
      url: check.url,
      status,
      expected: expectedStatusLabel(check),
    }),
    recommendation: findingMessage('rel-api-003.recommendation', {}),
    parameter: check.method,
  });
}
