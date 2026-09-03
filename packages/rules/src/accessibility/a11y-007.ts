// A11Y-007 — корректность ARIA (WCAG 4.1.2).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import {
  elementSelector,
  isFocusable,
  missingReferencedIds,
  referenceAttributes,
} from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-007');
const KNOWN_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'button',
  'cell',
  'checkbox',
  'complementary',
  'dialog',
  'document',
  'feed',
  'figure',
  'form',
  'grid',
  'gridcell',
  'heading',
  'img',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'menu',
  'menubar',
  'menuitem',
  'meter',
  'navigation',
  'none',
  'option',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'scrollbar',
  'search',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

export const a11y007Aria: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const target = root.querySelectorAll('[role]').find((element) => {
      const role = element.getAttribute('role')?.trim().toLowerCase() ?? '';
      return role !== '' && !KNOWN_ROLES.has(role.split(/\s+/)[0] ?? '');
    });
    const brokenReference = root
      .querySelectorAll('*')
      .find((element) =>
        referenceAttributes().some(
          (attribute) => missingReferencedIds(element, attribute, root).length > 0,
        ),
      );
    const hiddenFocusable = root
      .querySelectorAll('*')
      .find(
        (element) =>
          element.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true' &&
          isFocusable(element),
      );
    const first = target ?? brokenReference ?? hiddenFocusable;
    if (first === undefined) {
      return [];
    }
    const role = first.getAttribute('role')?.trim();
    const missing = referenceAttributes().flatMap((attribute) =>
      missingReferencedIds(first, attribute, root).map((id) => `${attribute}=${id}`),
    );
    const evidence =
      target !== undefined
        ? `${elementSelector(target)} содержит неизвестную ARIA role="${role}"`
        : brokenReference !== undefined
          ? `${elementSelector(brokenReference)} ссылается на отсутствующий ARIA id: ${missing.join(', ')}`
          : hiddenFocusable === undefined
            ? 'ARIA accessibility issue не определён'
            : `${elementSelector(hiddenFocusable)} одновременно aria-hidden=true и находится в tab order`;
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence,
        recommendation:
          'Используйте только валидные ARIA roles и проверяйте все ID-ссылки aria-атрибутов. ' +
          'Не скрывайте доступные с клавиатуры элементы через aria-hidden="true".',
        selector: elementSelector(first),
      }),
    ];
  },
};
