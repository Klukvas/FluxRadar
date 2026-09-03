// SEC-PASSIVE-003 — HSTS (site-level; severity из реестра).
//
// Оракул: applicable только для https-origin (applicableTargets = 1; для
// http-сайта правило Not applicable → 0/0 — fixture-сайт краулера живёт на
// loopback-http и это правило не трогает). Homepage-снимок (normalizedUrl =
// origin + '/') без валидного Strict-Transport-Security → site-finding.
// «Валидный» = заголовок присутствует и содержит max-age > 0; отсутствие
// max-age или max-age=0 (браузерное «забыть политику») эквивалентно
// отсутствию HSTS. Нет снимка homepage / нет HTTP-ответа → нет evidence,
// finding не создаётся (правило остаётся applicable).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';
import { headerValue } from '../shared/headers.js';

const descriptor = requireDescriptor('SEC-PASSIVE-003');

const NOT_APPLICABLE: SiteRuleResult = { findings: [], applicableTargets: 0, affectedTargets: 0 };

export const secPassive003Hsts: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    if (!ctx.domain.startsWith('https://')) {
      return NOT_APPLICABLE;
    }
    const homepage = findHomepage(ctx);
    if (homepage === undefined || !hasHttpResponse(homepage)) {
      return { findings: [], applicableTargets: 1, affectedTargets: 0 };
    }
    const hsts = headerValue(homepage, 'strict-transport-security');
    if (hsts !== null && hasPositiveMaxAge(hsts)) {
      return { findings: [], applicableTargets: 1, affectedTargets: 0 };
    }
    const finding = siteFinding(descriptor, homepage.finalUrl, {
      evidenceType: 'http',
      evidence:
        hsts === null
          ? 'Ответ https-homepage без заголовка Strict-Transport-Security'
          : `Strict-Transport-Security без положительного max-age: ${hsts}`,
      recommendation:
        'Отдавайте Strict-Transport-Security: max-age=31536000; includeSubDomains ' +
        'на всех https-ответах, начиная с homepage.',
      resource: 'strict-transport-security',
    });
    return { findings: [finding], applicableTargets: 1, affectedTargets: 1 };
  },
};

function findHomepage(ctx: SiteContext): PageSnapshot | undefined {
  const homepageUrl = `${ctx.domain}/`;
  return ctx.crawl.pages.find((page) => page.normalizedUrl === homepageUrl);
}

function hasPositiveMaxAge(hsts: string): boolean {
  const match = /max-age\s*=\s*"?(\d+)"?/i.exec(hsts);
  return match?.[1] !== undefined && Number.parseInt(match[1], 10) > 0;
}
