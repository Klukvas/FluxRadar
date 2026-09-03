// A11Y-005 — клавиатурная доступность (WCAG 2.1.1/2.1.2/2.5.7).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { elementSelector } from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-005');
const NON_INTERACTIVE = new Set(['div', 'span', 'p', 'li', 'section', 'article', 'aside']);

export const a11y005KeyboardNavigation: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const positiveTabindex = root
      .querySelectorAll('[tabindex]')
      .find((element) => Number.parseInt(element.getAttribute('tabindex')?.trim() ?? '', 10) > 0);
    const mouseOnly = root.querySelectorAll('[onclick]').find((element) => {
      const tag = element.rawTagName.toLowerCase();
      return (
        NON_INTERACTIVE.has(tag) &&
        element.getAttribute('role') === undefined &&
        element.getAttribute('onkeydown') === undefined &&
        element.getAttribute('onkeyup') === undefined &&
        element.getAttribute('onkeypress') === undefined
      );
    });
    const target = positiveTabindex ?? mouseOnly;
    if (target === undefined) {
      return [];
    }
    const reason =
      positiveTabindex !== undefined
        ? `${elementSelector(positiveTabindex)} использует tabindex > 0`
        : mouseOnly === undefined
          ? 'интерактивный элемент не определён'
          : `${elementSelector(mouseOnly)} имеет onclick без клавиатурного обработчика`;
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: reason,
        recommendation:
          'Не используйте tabindex больше нуля; для интерактивности применяйте нативные ' +
          'button/link или добавьте эквивалентное управление с клавиатуры.',
        selector: elementSelector(target),
      }),
    ];
  },
};
