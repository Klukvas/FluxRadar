// SEO-ONPAGE-001 — title (page-level; severity из реестра contracts).
//
// Оракул: первый <title> документа: отсутствует или пуст после trim →
// finding; длина после trim в Unicode code points < 10 или > 70 → тот же
// finding-класс (одно правило, один finding на страницу). Границы
// включительно валидны: ровно 10 и ровно 70 символов — не finding
// (boundary-фикстура).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { codePointLength, parsePage } from './dom.js';

const descriptor = requireDescriptor('SEO-ONPAGE-001');

export const TITLE_MIN_CHARS = 10;
export const TITLE_MAX_CHARS = 70;

export const seoOnpage001Title: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const titleElement = parsePage(page).querySelector('title');
    const title = titleElement?.text.trim() ?? '';
    if (title === '') {
      return [titleFinding(page, '<title> отсутствует или пуст')];
    }
    const length = codePointLength(title);
    if (length < TITLE_MIN_CHARS) {
      return [titleFinding(page, `title «${title}» — ${length} симв. (< ${TITLE_MIN_CHARS})`)];
    }
    if (length > TITLE_MAX_CHARS) {
      return [titleFinding(page, `title из ${length} симв. (> ${TITLE_MAX_CHARS}): «${title}»`)];
    }
    return [];
  },
};

function titleFinding(page: PageSnapshot, evidence: string): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'dom',
    evidence,
    recommendation:
      `Дайте странице уникальный информативный <title> длиной ${TITLE_MIN_CHARS}–` +
      `${TITLE_MAX_CHARS} символов.`,
    selector: 'title',
  });
}
