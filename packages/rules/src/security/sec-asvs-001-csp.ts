// SEC-ASVS-001 — public OWASP ASVS profile: Content-Security-Policy.
// This is an external response check only; it does not attempt to prove that
// a policy is safe for every runtime path or authenticated application flow.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { headerValue } from '../shared/headers.js';

const descriptor = requireDescriptor('SEC-ASVS-001');

export const secAsvs001Csp: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const policy = headerValue(page, 'content-security-policy');
    if (policy !== null && policy.trim() !== '') return [];
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: findingMessage('sec-asvs-001.evidence', {}),
        recommendation: findingMessage('sec-asvs-001.recommendation', {}),
        resource: 'content-security-policy',
      }),
    ];
  },
};
