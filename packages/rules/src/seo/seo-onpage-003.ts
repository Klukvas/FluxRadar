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
import { parsePage } from './dom.js';

const descriptor = requireDescriptor('SEO-ONPAGE-003');

interface HeadingIssues {
  readonly violations: readonly string[];
  readonly selector: string;
}

export const seoOnpage003Headings: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const headings = parsePage(page).querySelectorAll('h1, h2, h3, h4, h5, h6');
    const issues = collectHeadingIssues(headings);
    if (issues.violations.length === 0) {
      return [];
    }
    const outline = headings.map((heading) => heading.tagName.toLowerCase()).join(' → ');
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `${issues.violations.join('; ')}. Структура заголовков: ${outline || '(нет)'}`,
        recommendation:
          'Используйте ровно один h1 и стройте иерархию без пропуска уровней ' +
          '(h1 → h2 → h3 …).',
        selector: issues.selector,
      }),
    ];
  },
};

function collectHeadingIssues(headings: readonly HTMLElement[]): HeadingIssues {
  const violations: string[] = [];
  let selector = '';
  const h1Count = headings.filter((heading) => headingLevel(heading) === 1).length;
  if (h1Count === 0) {
    violations.push('на странице нет h1');
    selector = 'h1';
  }
  if (h1Count > 1) {
    violations.push(`h1 встречается ${h1Count} раз(а)`);
    selector = selector === '' ? 'h1' : selector;
  }
  const skip = firstLevelSkip(headings);
  if (skip !== null) {
    violations.push(`переход h${skip.from} → h${skip.to} пропускает уровень`);
    selector = selector === '' ? `h${skip.to}` : selector;
  }
  return { violations, selector };
}

function firstLevelSkip(
  headings: readonly HTMLElement[],
): { readonly from: number; readonly to: number } | null {
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
