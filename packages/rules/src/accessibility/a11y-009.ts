// A11Y-009 — сообщения об ошибках форм (WCAG 3.3.1/3.3.3).
// Проверяем только уже размеченное invalid-состояние: runtime-валидацию формы
// нельзя достоверно вывести из статического HTML.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { elementSelector } from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-009');

export const a11y009FormErrors: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const invalid = root.querySelectorAll('[aria-invalid="true"]').find((element) => {
      const describedBy = element.getAttribute('aria-describedby')?.trim() ?? '';
      const errorMessage = element.getAttribute('aria-errormessage')?.trim() ?? '';
      return describedBy === '' && errorMessage === '';
    });
    if (invalid === undefined) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `${elementSelector(invalid)} имеет aria-invalid="true", но не связан с текстом ошибки`,
        recommendation:
          'Свяжите invalid-контрол с понятным сообщением об ошибке через aria-describedby ' +
          'или aria-errormessage и обновляйте сообщение после валидации.',
        selector: elementSelector(invalid),
      }),
    ];
  },
};
