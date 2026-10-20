// CONTENT-011: next free content id; 002 and 006–010 retain planned meanings.
import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import { isSuccessfulHtmlPage, type PageRule } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { parsePage } from '../seo/dom.js';
import { PLACEHOLDER_PATTERNS } from './placeholder-text.js';
import { placeholderVisibleText, placeholderNodeText } from './visible-text.js';
const descriptor = requireDescriptor('CONTENT-011');
export const content011Placeholder: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page) {
    const root = parsePage(page);
    const headings = root
      .querySelectorAll('title, h1')
      .filter((element) => element.closest('code, pre, textarea') === null)
      .map((element) => placeholderNodeText(element));
    const body = placeholderVisibleText(page);
    for (const pattern of PLACEHOLDER_PATTERNS) {
      const source = (pattern.headingOnly ? headings : [body, ...headings]).find((text) =>
        text.toLowerCase().includes(pattern.text.toLowerCase()),
      );
      if (source === undefined) continue;
      const position = source.toLowerCase().indexOf(pattern.text.toLowerCase());
      const excerpt = source.slice(Math.max(0, position - 20), position + 60);
      return [
        pageFinding(descriptor, page, {
          evidenceType: 'dom',
          parameter: pattern.id,
          evidence: findingMessage('content-011.evidence', { excerpt }),
          recommendation: findingMessage('content-011.recommendation', {}),
        }),
      ];
    }
    return [];
  },
};
