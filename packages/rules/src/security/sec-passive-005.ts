// SEC-PASSIVE-005 — атрибуты cookie (page-level; severity из реестра).
//
// Оракул: кука из Set-Cookie финального ответа без хотя бы одного из
// атрибутов Secure / HttpOnly / SameSite → finding на каждую куку,
// parameter = имя куки, excerpt — перечень отсутствующих атрибутов
// (значение куки в evidence не попадает — оно может быть секретом).
// Applicable — любой снимок с HTTP-ответом: Set-Cookie бывает и на
// не-HTML/не-2xx ответах.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';
import { parseSetCookie, setCookieValues } from '../shared/headers.js';

const descriptor = requireDescriptor('SEC-PASSIVE-005');

const REQUIRED_ATTRIBUTES = [
  { attribute: 'secure', label: 'Secure' },
  { attribute: 'httponly', label: 'HttpOnly' },
  { attribute: 'samesite', label: 'SameSite' },
] as const;

export const secPassive005CookieAttributes: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: hasHttpResponse,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const seen = new Set<string>();
    return setCookieValues(page).flatMap((value) => {
      const cookie = parseSetCookie(value);
      if (cookie.name === '' || seen.has(cookie.name)) {
        return [];
      }
      seen.add(cookie.name);
      const missing = REQUIRED_ATTRIBUTES.filter(
        ({ attribute }) => !cookie.attributes.has(attribute),
      ).map(({ label }) => label);
      if (missing.length === 0) {
        return [];
      }
      return [
        pageFinding(descriptor, page, {
          evidenceType: 'http',
          evidence: `Set-Cookie "${cookie.name}" без атрибутов: ${missing.join(', ')}`,
          recommendation:
            'Выставляйте кукам Secure, HttpOnly и SameSite (Lax или Strict); ' +
            'исключения делайте осознанно и только для несессионных кук.',
          parameter: cookie.name,
        }),
      ];
    });
  },
};
