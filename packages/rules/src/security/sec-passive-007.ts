// SEC-PASSIVE-007: original feature-plan DNS-records id; DKIM requires a known selector.
import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import { notApplicable, type SiteRule } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
const descriptor = requireDescriptor('SEC-PASSIVE-007');
export const secPassive007MailDns: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx) {
    const dns = ctx.mailDns;
    if (dns === undefined) return notApplicable('no-mail-dns');
    const spf = dns.spf.records.filter((record) => /^v=spf1(?:\s|$)/i.test(record.trim()));
    const dmarc = dns.dmarc.records.filter((record) => /^v=DMARC1(?:\s*;|$)/i.test(record.trim()));
    const monitoring =
      dns.dmarc.status === 'checked' &&
      dmarc.some((record) => /(?:^|;)\s*p\s*=\s*none\s*(?:;|$)/i.test(record));
    const spfReason =
      spf.length === 0
        ? 'missing'
        : spf.length > 1
          ? 'multiple'
          : spf.some((record) => /(?:^|\s)\+all(?:\s|$)/i.test(record))
            ? 'all'
            : null;
    const findings = [
      ...(dns.spf.status !== 'checked' || spfReason === null
        ? []
        : [
            siteFinding(descriptor, ctx.origin, {
              evidenceType: 'http',
              parameter: 'spf',
              evidence: findingMessage(
                `sec-passive-007.evidence.spf-${spfReason}${monitoring ? '-monitoring' : ''}`,
                {
                  domain: dns.domain,
                },
              ),
              recommendation: findingMessage('sec-passive-007.recommendation', {}),
            }),
          ]),
      ...(dns.dmarc.status !== 'checked' || dmarc.length > 0
        ? []
        : [
            siteFinding(descriptor, ctx.origin, {
              evidenceType: 'http',
              parameter: 'dmarc',
              evidence: findingMessage('sec-passive-007.evidence.dmarc-missing', {
                domain: dns.domain,
              }),
              recommendation: findingMessage('sec-passive-007.recommendation', {}),
            }),
          ]),
    ];
    const completed = [dns.spf, dns.dmarc].filter((record) => record.status === 'checked').length;
    return {
      findings,
      applicableTargets: 1,
      completedTargets: completed === 2 ? 1 : 0,
      affectedTargets: findings.length > 0 ? 1 : 0,
      checkedTargets: completed === 2 ? [ctx.domain] : [],
    };
  },
};
