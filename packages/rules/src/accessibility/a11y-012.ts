// A11Y-012: next free accessibility rule id; viewport scaling (WCAG 1.4.4).
import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import { isSuccessfulHtmlPage, type PageRule } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { viewportContents, viewportDirectives } from '../shared/viewport.js';
const descriptor = requireDescriptor('A11Y-012');
export const a11y012Zoom: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page) {
    const restricted = viewportContents(page).filter((content) => {
      const directives = viewportDirectives(content);
      const scalable = directives.get('user-scalable');
      const maximum = directives.get('maximum-scale');
      return (
        scalable === 'no' ||
        scalable === '0' ||
        (maximum !== undefined && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(maximum) && Number(maximum) < 2)
      );
    });
    return restricted.length === 0
      ? []
      : [
          pageFinding(descriptor, page, {
            evidenceType: 'dom',
            selector: 'meta[name="viewport"]',
            evidence: findingMessage('a11y-012.evidence', { value: restricted.join('; ') }),
            recommendation: findingMessage('a11y-012.recommendation', {}),
          }),
        ];
  },
};
