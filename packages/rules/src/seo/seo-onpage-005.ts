// SEO-ONPAGE-005 — alt у изображений (page-level; severity из реестра).
//
// Оракул: <img> без атрибута alt вообще — нарушение; пустой alt=""
// (декоративное изображение) — норма. Affected — страница: один finding
// на страницу, selector — первый нарушающий элемент (img[src="..."]),
// excerpt — количество нарушений. То же evidence находит A11Y-002 (T-09) —
// по §14 это намеренно два findings, связанных общим non-scoring
// evidenceGroupId категории 'img-alt'.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { IMG_ALT_EVIDENCE_CATEGORY, evidenceGroupId } from '../engine/evidence-group.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from './dom.js';

const descriptor = requireDescriptor('SEO-ONPAGE-005');

export const seoOnpage005ImageAlt: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const missingAlt = parsePage(page)
      .querySelectorAll('img')
      .filter((image) => !image.hasAttribute('alt'));
    const first = missingAlt[0];
    if (first === undefined) {
      return [];
    }
    const firstSrc = first.getAttribute('src')?.trim() ?? '';
    const selector = firstSrc === '' ? 'img' : `img[src="${firstSrc}"]`;
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence:
          `${missingAlt.length} <img> без атрибута alt; первый: ` +
          `<img src="${firstSrc}"> (декоративным нужен пустой alt="")`,
        recommendation:
          'Добавьте информативный alt каждому содержательному изображению; ' +
          'декоративным — явный пустой alt="".',
        selector,
        evidenceGroupId: evidenceGroupId(IMG_ALT_EVIDENCE_CATEGORY, page.normalizedUrl),
      }),
    ];
  },
};
