// A11Y-004 — labels у форм (page-level; severity из реестра).
//
// Оракул: input/select/textarea без связанного label → finding на каждый
// элемент управления (selector = элемент). Связь засчитывается любым из
// способов: label[for] по id, обёртка <label>, непустой aria-label или
// aria-labelledby. Не требуют label: input типов hidden, submit, button,
// reset, image (их имя даёт value/alt, а hidden невидим). Повторные
// элементы с тем же селектором схлопываются (стабильный fingerprint).

import type { PageSnapshot } from '@fluxradar/crawler';
import type { HTMLElement } from 'node-html-parser';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-004');

const NO_LABEL_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export const a11y004FormLabels: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const labelledIds = collectLabelledIds(root);
    const seenSelectors = new Set<string>();
    return root
      .querySelectorAll('input, select, textarea')
      .filter((control) => needsLabel(control) && !isLabelled(control, labelledIds))
      .flatMap((control) => {
        const selector = controlSelector(control);
        if (seenSelectors.has(selector)) {
          return [];
        }
        seenSelectors.add(selector);
        return [unlabelledControlFinding(page, control, selector)];
      });
  },
};

function collectLabelledIds(root: HTMLElement): ReadonlySet<string> {
  return new Set(
    root
      .querySelectorAll('label')
      .map((label) => label.getAttribute('for')?.trim() ?? '')
      .filter((forId) => forId !== ''),
  );
}

function needsLabel(control: HTMLElement): boolean {
  if (control.rawTagName.toLowerCase() !== 'input') {
    return true;
  }
  const type = control.getAttribute('type')?.trim().toLowerCase() ?? 'text';
  return !NO_LABEL_INPUT_TYPES.has(type);
}

function isLabelled(control: HTMLElement, labelledIds: ReadonlySet<string>): boolean {
  if ((control.getAttribute('aria-label')?.trim() ?? '') !== '') {
    return true;
  }
  if ((control.getAttribute('aria-labelledby')?.trim() ?? '') !== '') {
    return true;
  }
  const id = control.getAttribute('id')?.trim() ?? '';
  if (id !== '' && labelledIds.has(id)) {
    return true;
  }
  return control.closest('label') !== null;
}

/** Стабильный селектор: #id → [name] → тег с type. */
function controlSelector(control: HTMLElement): string {
  const tag = control.rawTagName.toLowerCase();
  const id = control.getAttribute('id')?.trim() ?? '';
  if (id !== '') {
    return `${tag}#${id}`;
  }
  const name = control.getAttribute('name')?.trim() ?? '';
  if (name !== '') {
    return `${tag}[name="${name}"]`;
  }
  const type = control.getAttribute('type')?.trim().toLowerCase() ?? '';
  return type === '' ? tag : `${tag}[type="${type}"]`;
}

function unlabelledControlFinding(
  page: PageSnapshot,
  control: HTMLElement,
  selector: string,
): RuleFinding {
  return pageFinding(descriptor, page, {
    evidenceType: 'dom',
    evidence:
      `Элемент управления без label: ${selector} — нет label[for], обёртки <label>, ` +
      'aria-label и aria-labelledby',
    recommendation:
      'Свяжите каждый элемент формы с подписью: <label for="id">, обёртка <label> ' +
      'или aria-label/aria-labelledby, если видимой подписи нет.',
    selector,
  });
}
