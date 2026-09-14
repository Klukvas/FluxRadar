// A11Y-006 — видимость фокуса (WCAG 2.4.7/2.4.11).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { inlineStyle, styleText } from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-006');
const FOCUS_REMOVAL = /outline\s*:\s*(?:none|0(?:px)?)(?:\s*!important)?/i;

export const a11y006FocusVisible: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const inlineViolation = root
      .querySelectorAll('[style]')
      .find(
        (element) =>
          FOCUS_REMOVAL.test(inlineStyle(element)) &&
          !/box-shadow|border/i.test(inlineStyle(element)),
      );
    const css = styleText(root);
    const stylesheetViolation =
      /:focus[^{}]*\{[^}]*outline\s*:\s*(?:none|0(?:px)?)/is.test(css) &&
      !/:focus[^{}]*\{[^}]*?(?:box-shadow|border)/is.test(css);
    if (inlineViolation === undefined && !stylesheetViolation) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence:
          inlineViolation === undefined
            ? findingMessage('a11y-006.evidence.stylesheet', {})
            : findingMessage('a11y-006.evidence.inline', {
                tag: inlineViolation.rawTagName.toLowerCase(),
              }),
        recommendation: findingMessage('a11y-006.recommendation', {}),
        ...(inlineViolation === undefined
          ? {}
          : { selector: inlineViolation.rawTagName.toLowerCase() }),
      }),
    ];
  },
};
