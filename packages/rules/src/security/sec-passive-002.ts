// SEC-PASSIVE-002 — security headers (page-level; severity из реестра).
//
// Оракул: успешный HTML-ответ без хотя бы одного из baseline-заголовков →
// один finding на страницу с перечнем отсутствующих в excerpt. Проверяются:
// (1) X-Content-Type-Options со значением ровно `nosniff`;
// (2) защита от framing — X-Frame-Options ЛИБО CSP с директивой
//     frame-ancestors (любого из двух достаточно);
// (3) Referrer-Policy с непустым значением.
// selector пуст, resource = 'security-headers' (стабильный fingerprint).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { headerValue } from '../shared/headers.js';

const descriptor = requireDescriptor('SEC-PASSIVE-002');

export const secPassive002SecurityHeaders: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const missing = missingSecurityHeaders(page);
    if (missing.length === 0) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: `HTML-ответ без security headers (${missing.length}): ${missing.join('; ')}`,
        recommendation:
          'Добавьте на HTML-ответы X-Content-Type-Options: nosniff, Referrer-Policy и ' +
          'защиту от framing (X-Frame-Options либо CSP frame-ancestors).',
        resource: 'security-headers',
      }),
    ];
  },
};

function missingSecurityHeaders(page: PageSnapshot): readonly string[] {
  const missing: string[] = [];
  const nosniff = headerValue(page, 'x-content-type-options');
  if (nosniff?.trim().toLowerCase() !== 'nosniff') {
    missing.push('X-Content-Type-Options: nosniff');
  }
  if (!hasFrameProtection(page)) {
    missing.push('X-Frame-Options / CSP frame-ancestors');
  }
  const referrerPolicy = headerValue(page, 'referrer-policy');
  if (referrerPolicy === null || referrerPolicy.trim() === '') {
    missing.push('Referrer-Policy');
  }
  return missing;
}

function hasFrameProtection(page: PageSnapshot): boolean {
  const frameOptions = headerValue(page, 'x-frame-options');
  if (frameOptions !== null && frameOptions.trim() !== '') {
    return true;
  }
  const csp = headerValue(page, 'content-security-policy');
  return csp !== null && csp.toLowerCase().includes('frame-ancestors');
}
