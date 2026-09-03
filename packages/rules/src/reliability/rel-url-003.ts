// REL-URL-003 — 4xx/5xx verdict (page-level; severity из реестра).
//
// Оракул: финальный статус ≥ 500 → fail-finding. Неожиданный 4xx по §9 —
// verdict warning, но в v0.1 warning-вердикты scored finding НЕ создают
// (score_delta = 0 у scored-правила невозможен), а сами 4xx-страницы уже
// покрыты SEO-TECH-003 — дублировать evidence в том же прогоне незачем
// (трактовка зафиксирована в D-163). Expected-status precedence относится
// только к явно сконфигурированным API-проверкам (REL-API-003): у страниц
// обхода списка ожидаемых статусов нет.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';

const descriptor = requireDescriptor('REL-URL-003');

export const relUrl003ServerErrors: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: hasHttpResponse,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    if (page.status < 500) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: `HTTP ${page.status} ${page.finalUrl} — серверная ошибка (fail-verdict §9)`,
        recommendation:
          'Устраните причину 5xx-ответа: серверная ошибка на публичном URL — это отказ ' +
          'доступности, а не контентная проблема.',
      }),
    ];
  },
};
