// SEO-ONPAGE-007: planned structured-data meaning shipped as SEO-STRUCT-*; number reused for mobile viewport.
import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import { isSuccessfulHtmlPage, type PageRule } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { viewportContents, viewportDirectives } from '../shared/viewport.js';
const descriptor = requireDescriptor('SEO-ONPAGE-007');
export const seoOnpage007Viewport: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page) {
    const contents = viewportContents(page);
    if (
      contents.length > 0 &&
      contents.every((content) => viewportDirectives(content).get('width') === 'device-width')
    )
      return [];
    const parameter = contents.length === 0 ? 'missing' : 'fixed-width';
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        parameter,
        selector: 'meta[name="viewport"]',
        evidence: findingMessage('seo-onpage-007.evidence', { value: contents.join('; ') || '—' }),
        recommendation: findingMessage('seo-onpage-007.recommendation', {}),
      }),
    ];
  },
};
