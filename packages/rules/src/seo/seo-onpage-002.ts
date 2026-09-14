// SEO-ONPAGE-002 — meta description (page-level; severity из реестра).
//
// Оракул: <meta name="description">: отсутствует или content пуст после
// trim → finding; длина content в Unicode code points < 50 или > 160 →
// тот же finding-класс. Границы включительно валидны: ровно 50 и ровно 160
// символов — не finding (boundary-фикстура). При дублях берётся первый тег.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage, type CataloguedFindingMessage } from '../messages/index.js';
import { codePointLength, metaContent, parsePage } from './dom.js';

const descriptor = requireDescriptor('SEO-ONPAGE-002');

export const DESCRIPTION_MIN_CHARS = 50;
export const DESCRIPTION_MAX_CHARS = 160;

export const seoOnpage002MetaDescription: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const description = metaContent(parsePage(page), 'description')?.trim() ?? '';
    if (description === '') {
      return [descriptionFinding(page, findingMessage('seo-onpage-002.evidence.missing', {}))];
    }
    const length = codePointLength(description);
    if (length < DESCRIPTION_MIN_CHARS) {
      return [
        descriptionFinding(
          page,
          findingMessage('seo-onpage-002.evidence.too-short', {
            description,
            length,
            min: DESCRIPTION_MIN_CHARS,
          }),
        ),
      ];
    }
    if (length > DESCRIPTION_MAX_CHARS) {
      return [
        descriptionFinding(
          page,
          findingMessage('seo-onpage-002.evidence.too-long', {
            length,
            max: DESCRIPTION_MAX_CHARS,
          }),
        ),
      ];
    }
    return [];
  },
};

function descriptionFinding(page: PageSnapshot, evidence: CataloguedFindingMessage): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'dom',
    evidence,
    recommendation: findingMessage('seo-onpage-002.recommendation', {
      min: DESCRIPTION_MIN_CHARS,
      max: DESCRIPTION_MAX_CHARS,
    }),
    selector: 'meta[name="description"]',
  });
}
