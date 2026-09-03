// SEC-ASVS-002 — public OWASP ASVS profile: Permissions-Policy response signal.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { headerValue } from '../shared/headers.js';

const descriptor = requireDescriptor('SEC-ASVS-002');

export const secAsvs002PermissionsPolicy: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const policy = headerValue(page, 'permissions-policy');
    if (policy !== null && policy.trim() !== '') return [];
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: 'HTML-ответ без Permissions-Policy',
        recommendation:
          'Задайте Permissions-Policy и явно отключите неиспользуемые browser features, ' +
          'например camera, microphone и geolocation.',
        resource: 'permissions-policy',
      }),
    ];
  },
};
