// REL-API-005 — no-credentials policy (api-level; severity High из реестра).
//
// Оракул (§9): конфиг API-проверки с credentials-заголовками (Authorization,
// Cookie, api-key/token/secret-паттерны) → finding; сам запрос выполняться
// не должен был — выполненный вопреки policy запрос (snapshot присутствует)
// отмечается в excerpt отдельно. В evidence попадают только ИМЕНА
// заголовков — значения секретов не логируются. Applicable — все
// сконфигурированные проверки (policy-скан прошёл над каждой); negative —
// проверки с чистыми заголовками. parameter = первый offending заголовок.

import { requireDescriptor } from '../engine/descriptor.js';
import { apiFinding } from '../engine/finding.js';
import type { ApiCheck, ApiRule, RuleFinding, SiteContext, SiteRuleResult } from '../engine/types.js';
import { credentialHeaderNames } from './api-checks.js';

const descriptor = requireDescriptor('REL-API-005');

export const relApi005NoCredentials: ApiRule = {
  kind: 'api',
  descriptor,
  evaluateApiChecks(ctx: SiteContext): SiteRuleResult {
    const checks = ctx.apiChecks ?? [];
    const findings = checks.flatMap((check) => {
      const offending = credentialHeaderNames(check);
      return offending.length === 0 ? [] : [credentialsFinding(check, offending)];
    });
    return {
      findings,
      applicableTargets: checks.length,
      affectedTargets: findings.length,
    };
  },
};

function credentialsFinding(check: ApiCheck, offending: readonly string[]): RuleFinding {
  const executedNote =
    check.snapshot === undefined
      ? 'запрос заблокирован policy и не выполнялся'
      : 'запрос был выполнен вопреки policy';
  return apiFinding(descriptor, check, {
    evidenceType: 'http',
    evidence:
      `${check.method} ${check.url}: credentials-заголовки в конфиге проверки ` +
      `(${offending.join(', ')}); ${executedNote}`,
    recommendation:
      'Уберите credentials из конфига проверки: v0.1 проверяет только публичные ' +
      'endpoints без авторизации (§9 no-credentials policy).',
    parameter: offending[0] ?? '',
  });
}
