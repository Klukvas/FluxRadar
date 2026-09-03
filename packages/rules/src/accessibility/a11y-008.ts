// A11Y-008 — имена интерактивных элементов (WCAG 2.4.4/4.1.2).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { accessibleName, elementSelector } from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-008');

export const a11y008InteractiveNames: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const unnamed =
      root.querySelectorAll('a, button, summary').find((element) => {
        const tag = element.rawTagName.toLowerCase();
        return (
          (tag === 'a' && (element.getAttribute('href')?.trim() ?? '') === '') ||
          accessibleName(element, root) === ''
        );
      }) ??
      root.querySelectorAll('input').find((element) => {
        const type = element.getAttribute('type')?.trim().toLowerCase() ?? 'text';
        return (
          ['button', 'image', 'reset', 'submit'].includes(type) &&
          accessibleName(element, root) === ''
        );
      });
    if (unnamed === undefined) {
      return [];
    }
    const tag = unnamed.rawTagName.toLowerCase();
    const reason =
      tag === 'a' && (unnamed.getAttribute('href')?.trim() ?? '') === ''
        ? 'ссылка без href не является клавиатурно активной'
        : 'интерактивный элемент не имеет доступного имени';
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `${elementSelector(unnamed)}: ${reason}`,
        recommendation:
          'Используйте ссылку с href или кнопку и задайте доступное имя через видимый текст, ' +
          'aria-label, aria-labelledby или корректный label.',
        selector: elementSelector(unnamed),
      }),
    ];
  },
};
