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
import type {
  ApiCheck,
  ApiRule,
  RuleFinding,
  SiteContext,
  SiteRuleResult,
} from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
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
  const evidenceCode =
    check.snapshot === undefined ? 'rel-api-005.evidence.blocked' : 'rel-api-005.evidence.sent';
  return apiFinding(descriptor, check, {
    evidenceType: 'http',
    evidence: findingMessage(evidenceCode, {
      method: check.method,
      url: check.url,
      headers: offending.join(', '),
    }),
    recommendation: findingMessage('rel-api-005.recommendation', {}),
    parameter: offending[0] ?? '',
  });
}
