// SEC-ASVS-003 — public OWASP ASVS profile: contradictory permissive CORS.
// A wildcard origin must not be paired with credentialed cross-origin access.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';
import { headerValue } from '../shared/headers.js';

const descriptor = requireDescriptor('SEC-ASVS-003');

export const secAsvs003Cors: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: hasHttpResponse,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const allowOrigin = headerValue(page, 'access-control-allow-origin')?.trim();
    const allowCredentials = headerValue(page, 'access-control-allow-credentials')
      ?.trim()
      .toLowerCase();
    if (allowOrigin !== '*' || allowCredentials !== 'true') return [];
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence:
          'Ответ сочетает Access-Control-Allow-Origin: * и ' +
          'Access-Control-Allow-Credentials: true',
        recommendation:
          'Не сочетайте wildcard origin с credentialed CORS: перечисляйте доверенные origins ' +
          'явно и включайте credentials только там, где это необходимо.',
        resource: 'cors',
      }),
    ];
  },
};
