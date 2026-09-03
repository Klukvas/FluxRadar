// A11Y-002 — alt-тексты изображений (page-level; severity из реестра).
//
// Оракул: <img> без атрибута alt — нарушение; пустой alt="" (декоративное
// изображение) — норма. То же evidence, что у SEO-ONPAGE-005, и это
// намеренно ДВА findings (§14 cross-module policy: разные измерения и
// тарифные веса); связь — общий non-scoring evidenceGroupId категории
// 'img-alt'. Один finding на страницу: selector — первый нарушающий
// элемент, excerpt — количество.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { IMG_ALT_EVIDENCE_CATEGORY, evidenceGroupId } from '../engine/evidence-group.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-002');

export const a11y002ImageAlt: PageRule = {
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
          `${missingAlt.length} <img> без alt — screen reader объявит такие ` +
          `изображения как «image» без содержания; первый: <img src="${firstSrc}">`,
        recommendation:
          'Дайте каждому содержательному изображению информативный alt; ' +
          'декоративным — явный пустой alt="", чтобы screen reader их пропускал.',
        selector,
        evidenceGroupId: evidenceGroupId(IMG_ALT_EVIDENCE_CATEGORY, page.normalizedUrl),
      }),
    ];
  },
};
