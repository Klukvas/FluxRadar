// A11Y-003 — язык документа и структура заголовков (WCAG 1.3.1/2.4.6/3.1.1).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-003');

export const a11y003DocumentStructure: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const html = root.querySelector('html');
    const problems: string[] = [];
    if ((html?.getAttribute('lang')?.trim() ?? '') === '') {
      problems.push('html[lang] отсутствует или пуст');
    }
    const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const levels = headings.map((heading) => Number.parseInt(heading.rawTagName.slice(1), 10));
    const h1Count = levels.filter((level) => level === 1).length;
    if (h1Count !== 1) {
      problems.push(`найдено h1: ${h1Count}, ожидался ровно один`);
    }
    for (let index = 1; index < levels.length; index += 1) {
      const previous = levels[index - 1] ?? 0;
      const current = levels[index] ?? 0;
      if (current - previous > 1) {
        problems.push(`уровень заголовка перескочил с h${previous} на h${current}`);
        break;
      }
    }
    if (problems.length === 0) {
      return [];
    }
    const selector =
      html === null || (html.getAttribute('lang')?.trim() ?? '') === '' ? 'html' : 'h1';
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `Проблемы языка/структуры документа: ${problems.join('; ')}`,
        recommendation:
          'Укажите язык страницы в html[lang], используйте ровно один h1 и не пропускайте ' +
          'уровни заголовков без структурной причины.',
        selector,
      }),
    ];
  },
};
