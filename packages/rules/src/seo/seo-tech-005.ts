// SEO-TECH-005 — redirect chains/cycles (page-level; severity из реестра).
//
// Оракул: снимок с redirectChain.length ≥ 2 (два и более hop-а до финального
// ответа) → finding; ровно 1 hop — норма (boundary-фикстура: 2 hop-а —
// уже finding). Цикл или бесконечная цепочка проявляется как fetchError
// safe-fetch «redirect limit ... exceeded» — такой снимок тоже applicable
// и даёт finding с targetUnreachable (вход для D-026).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';

const descriptor = requireDescriptor('SEO-TECH-005');

/** Порог цепочки: hop-ов меньше — норма (один 301 — штатная канонизация). */
export const REDIRECT_CHAIN_MIN_HOPS = 2;

/** Маркер RedirectLimitError из safe-fetch (цикл/превышение лимита D-028). */
const REDIRECT_LIMIT_MARKER = 'redirect limit';

export const seoTech005RedirectChains: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable(page: PageSnapshot): boolean {
    return hasHttpResponse(page) || isRedirectLimitFailure(page);
  },
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    if (isRedirectLimitFailure(page)) {
      return [redirectCycleFinding(page)];
    }
    if (page.redirectChain.length < REDIRECT_CHAIN_MIN_HOPS) {
      return [];
    }
    return [redirectChainFinding(page)];
  },
};

function isRedirectLimitFailure(page: PageSnapshot): boolean {
  return page.fetchError !== undefined && page.fetchError.includes(REDIRECT_LIMIT_MARKER);
}

function redirectCycleFinding(page: PageSnapshot): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'http',
    evidence: `${page.requestedUrl}: ${page.fetchError ?? 'redirect limit exceeded'}`,
    recommendation:
      'Разорвите цикл redirect-ов: каждый URL должен вести к финальному 200-ответу ' +
      'не более чем за один переход.',
    targetUnreachable: true,
  });
}

function redirectChainFinding(page: PageSnapshot): RuleFinding {
  const hops = page.redirectChain
    .map((hop) => `${hop.url} —${hop.status}→ ${hop.location}`)
    .join('; ');
  return pageFinding(descriptor, page, {
    evidenceType: 'http',
    evidence:
      `Цепочка из ${page.redirectChain.length} redirect-ов до ${page.finalUrl} ` +
      `(HTTP ${page.status}): ${hops}`,
    recommendation:
      'Сократите цепочку до одного redirect-а: ссылайтесь сразу на финальный URL, ' +
      'а старые адреса перенаправляйте на него напрямую.',
  });
}
