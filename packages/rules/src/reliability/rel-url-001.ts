// REL-URL-001 — доступность URL (page-level; severity из реестра).
//
// Оракул: снимок обхода с fetchError (DNS/timeout/network/redirect-цикл —
// любой отказ safe-fetch) → fail-finding с targetUnreachable: true (D-026:
// такая находка не считается usable output). В v0.1 Reliability оценивает
// уже собранные снимки обхода, повторных запросов и retry-цепочек нет
// (лимиты попыток D-023 живут в safe-fetch). Applicable — каждый снимок
// обхода: проверка доступности завершена и для недостижимых URL — её
// вердикт fail, поэтому isApplicable берёт все страницы (coverage D-156
// не занижается).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';

const descriptor = requireDescriptor('REL-URL-001');

export const relUrl001Availability: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable(): boolean {
    return true;
  },
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    if (page.fetchError === undefined) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: `${page.requestedUrl} недоступен: ${page.fetchError}`,
        recommendation:
          'Проверьте DNS-записи, TLS-сертификат и доступность сервера: URL должен ' +
          'отвечать в пределах таймаута (10 s на попытку, D-023).',
        targetUnreachable: true,
      }),
    ];
  },
};
