// SEO-ONPAGE-003 — структура H1–H6 (page-level; severity из реестра).
//
// Оракул: заголовки h1..h6 в порядке документа: (a) нет h1; (b) h1 больше
// одного; (c) уровень следующего заголовка растёт больше чем на 1
// (h1→h3 без h2). Все нарушения страницы собираются в ОДИН finding
// (selector — первый нарушающий заголовок, для отсутствующего h1 — 'h1');
// понижение уровня (h3→h1) — норма.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { HTMLElement } from 'node-html-parser';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage, type CataloguedFindingMessage } from '../messages/index.js';
import { parsePage } from './dom.js';

const descriptor = requireDescriptor('SEO-ONPAGE-003');

interface LevelSkip {
  readonly from: number;
  readonly to: number;
}

interface HeadingIssues {
  readonly evidence: CataloguedFindingMessage;
  readonly selector: string;
}

export const seoOnpage003Headings: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const headings = parsePage(page).querySelectorAll('h1, h2, h3, h4, h5, h6');
    const issues = collectHeadingIssues(headings);
    if (issues === null) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: issues.evidence,
        recommendation: findingMessage('seo-onpage-003.recommendation', {}),
        selector: issues.selector,
      }),
    ];
  },
};

// Нарушения сводятся в одно сообщение: у каждого сочетания (нет h1 / несколько
// h1 / пропуск уровня) свой шаблон, а в параметрах — только данные, чтобы
// перевод не склеивал готовые фразы.
function collectHeadingIssues(headings: readonly HTMLElement[]): HeadingIssues | null {
  const h1Count = headings.filter((heading) => headingLevel(heading) === 1).length;
  const skip = firstLevelSkip(headings);
  const outline = headings.map((heading) => heading.tagName.toLowerCase()).join(' → ');
  if (skip === null) {
    return h1Count === 1 ? null : { evidence: h1Evidence(h1Count, outline), selector: 'h1' };
  }
  return {
    evidence: levelSkipEvidence(h1Count, skip, outline),
    selector: h1Count === 1 ? `h${skip.to}` : 'h1',
  };
}

function h1Evidence(h1Count: number, outline: string): CataloguedFindingMessage {
  if (outline === '') {
    return findingMessage('seo-onpage-003.evidence.no-headings', {});
  }
  return h1Count === 0
    ? findingMessage('seo-onpage-003.evidence.no-h1', { outline })
    : findingMessage('seo-onpage-003.evidence.multiple-h1', { count: h1Count, outline });
}

function levelSkipEvidence(
  h1Count: number,
  skip: LevelSkip,
  outline: string,
): CataloguedFindingMessage {
  const params = { from: skip.from, to: skip.to, outline };
  if (h1Count === 0) {
    return findingMessage('seo-onpage-003.evidence.no-h1.level-skip', params);
  }
  if (h1Count > 1) {
    return findingMessage('seo-onpage-003.evidence.multiple-h1.level-skip', {
      ...params,
      count: h1Count,
    });
  }
  return findingMessage('seo-onpage-003.evidence.level-skip', params);
}

function firstLevelSkip(headings: readonly HTMLElement[]): LevelSkip | null {
  const levels = headings.map(headingLevel);
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1];
    const current = levels[index];
    if (previous !== undefined && current !== undefined && current > previous + 1) {
      return { from: previous, to: current };
    }
  }
  return null;
}

function headingLevel(heading: HTMLElement): number {
  return Number.parseInt(heading.tagName.slice(1), 10);
}
