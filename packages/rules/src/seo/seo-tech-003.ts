// SEO-TECH-003 — HTTP status (page-level; severity из реестра contracts).
//
// Оракул: снимок страницы с финальным статусом ≥ 400 → finding (evidence
// http, excerpt со статусом). Applicable — любой снимок с HTTP-ответом
// (status > 0): 3xx не бывает финальным (redirect-цепочку раскрутил
// safe-fetch), 2xx — норма. Снимки с fetchError не applicable — движок
// считает их незавершёнными checks (coverage), а недоступность закрывает
// REL-URL-001 (T-09).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { hasHttpResponse } from '../engine/types.js';

const descriptor = requireDescriptor('SEO-TECH-003');

export const seoTech003HttpStatus: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: hasHttpResponse,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    if (page.status < 400) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: `HTTP ${page.status} ${page.finalUrl}`,
        recommendation:
          'Верните 200 для действующих страниц; для удалённых настройте 301-redirect ' +
          'на замену или уберите внутренние ссылки на этот URL.',
      }),
    ];
  },
};
