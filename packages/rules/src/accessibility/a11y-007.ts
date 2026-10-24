// A11Y-007 — корректность ARIA (WCAG 4.1.2).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  elementSelector,
  isFocusable,
  missingReferencedIds,
  referenceAttributes,
} from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-007');

// Непустые значения role сверяются с полным набором НЕабстрактных ролей
// WAI-ARIA 1.2 (W3C Recommendation, https://www.w3.org/TR/wai-aria-1.2/,
// §5.4 «Definition of Roles»; абстрактность каждой роли — строка
// «Is Abstract» её определения). Список взят из текста спецификации, а не
// по памяти: неполный набор превращал корректную разметку в finding —
// production-скан fluxradar.net сообщал «unknown ARIA role» про
// <button role="combobox"> на 18 страницах.
//
// 12 абстрактных ролей (§5.3.1: command, composite, input, landmark, range,
// roletype, section, sectionhead, select, structure, widget, window) здесь
// намеренно отсутствуют: спецификация запрещает авторам использовать их в
// разметке, поэтому role="widget" — такая же ошибка, как опечатка.
//
// Роли DPUB-ARIA (doc-*) и Graphics-ARIA (graphics-*) живут в отдельных
// спецификациях и в этот набор не входят.
const KNOWN_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
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
    const role = first.getAttribute('role')?.trim() ?? '';
    const missing = referenceAttributes().flatMap((attribute) =>
      missingReferencedIds(first, attribute, root).map((id) => `${attribute}=${id}`),
    );
    // first — это target, иначе brokenReference, иначе hiddenFocusable.
    const selector = elementSelector(first);
    const evidence =
      target !== undefined
        ? findingMessage('a11y-007.evidence.unknown-role', { selector, role })
        : brokenReference !== undefined
          ? findingMessage('a11y-007.evidence.missing-reference', {
              selector,
              references: missing.join(', '),
            })
          : findingMessage('a11y-007.evidence.hidden-focusable', { selector });
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence,
        recommendation: findingMessage('a11y-007.recommendation', {}),
        selector,
      }),
    ];
  },
};
