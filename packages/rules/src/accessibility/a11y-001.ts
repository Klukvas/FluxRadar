// A11Y-001 — контраст текста (WCAG 1.4.3/1.4.6, page-level).
// Автоматически оцениваем только пары color/background-color, явно заданные
// inline-style: вычислить итоговый CSS без браузерного layout нельзя. Внешние
// stylesheet-ы остаются честной зоной manual review и не дают ложного pass.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { elementSelector, parseInlineColorPair } from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-001');

export const a11y001Contrast: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const violation = root
      .querySelectorAll('[style]')
      .map((element) => {
        const pair = parseInlineColorPair(element);
        if (pair === null || pair.ratio >= requiredRatio(element.getAttribute('style') ?? '')) {
          return null;
        }
        return { element, pair };
      })
      .find((candidate) => candidate !== null);
    if (violation === undefined) {
      return [];
    }
    const selector = elementSelector(violation.element);
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: findingMessage('a11y-001.evidence', {
          selector,
          ratio: violation.pair.ratio.toFixed(2),
          threshold: requiredRatio(violation.element.getAttribute('style') ?? '').toFixed(1),
        }),
        recommendation: findingMessage('a11y-001.recommendation', {}),
        selector,
      }),
    ];
  },
};

function requiredRatio(style: string): number {
  const size = Number.parseFloat(style.match(/font-size\s*:\s*([\d.]+)px/i)?.[1] ?? '0');
  const weight = Number.parseInt(style.match(/font-weight\s*:\s*(\d+)/i)?.[1] ?? '400', 10);
  return size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
}
