// SEC-PASSIVE-001: original feature-plan SSL/TLS id.
import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import { notApplicable, type SiteRule } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
const descriptor = requireDescriptor('SEC-PASSIVE-001');
const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;
export const secPassive001Tls: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx) {
    const snapshots = ctx.tls ?? [];
    if (snapshots.length === 0) return notApplicable('no-tls');
    const checked = snapshots.filter((snapshot) => snapshot.status === 'checked');
    const findings = checked.flatMap((snapshot) => {
      const remaining = Date.parse(snapshot.validTo ?? '') - Date.parse(snapshot.observedAt);
      const notYetValid = Date.parse(snapshot.validFrom ?? '') > Date.parse(snapshot.observedAt);
      if (snapshot.authorized && !notYetValid && !(remaining < EXPIRY_WARNING_MS)) return [];
      const error = snapshot.authorizationError ?? '';
      const reason =
        remaining < 0 || /CERT_HAS_EXPIRED/.test(error)
          ? 'expired'
          : notYetValid || /CERT_NOT_YET_VALID/.test(error)
            ? 'not-yet-valid'
            : /ALTNAME|hostname|not match/i.test(error)
              ? 'mismatch'
              : !snapshot.authorized
                ? 'untrusted'
                : 'expiring';
      return [
        siteFinding(descriptor, `https://${snapshot.hostname}/`, {
          evidenceType: 'http',
          parameter: snapshot.hostname,
          evidence: findingMessage(`sec-passive-001.evidence.${reason}`, {
            hostname: snapshot.hostname,
            issuer: snapshot.issuer ?? '—',
            expires: snapshot.validTo ?? '—',
            detail: snapshot.authorizationError ?? '—',
          }),
          recommendation: findingMessage('sec-passive-001.recommendation', {}),
        }),
      ];
    });
    return {
      findings,
      applicableTargets: snapshots.length,
      completedTargets: checked.length,
      affectedTargets: findings.length,
      checkedTargets: checked.map((snapshot) => `https://${snapshot.hostname}/`),
    };
  },
};
