// SEO-TECH-016: next free technical SEO id, same-site render resources.
import { RENDER_RESOURCE_SELECTOR, type PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';
import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import { isSuccessfulHtmlPage, type PageRule } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { parsePage } from './dom.js';
const descriptor = requireDescriptor('SEO-TECH-016');
function references(page: PageSnapshot): readonly { raw: string; target: string }[] {
  return parsePage(page)
    .querySelectorAll(RENDER_RESOURCE_SELECTOR)
    .flatMap((element) => {
      const raw = element.getAttribute('href') ?? element.getAttribute('src') ?? '';
      try {
        const url = new URL(raw, page.finalUrl);
        return ['http:', 'https:'].includes(url.protocol)
          ? [{ raw, target: normalizeUrl(url.href) }]
          : [];
      } catch {
        return [];
      }
    });
}
export const seoTech016RenderResources: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  inputTargets: (ctx) =>
    (ctx.crawl.resources ?? [])
      .filter((resource) => resource.unverifiedReason === undefined)
      .map((resource) => resource.normalizedUrl),
  requestedInputs: (ctx) => [
    ...new Set(
      ctx.crawl.pages
        .filter(isSuccessfulHtmlPage)
        .flatMap((page) => references(page).map((reference) => reference.target)),
    ),
  ],
  evaluatePage(page, ctx) {
    const probes = new Map(
      (ctx.crawl.resources ?? []).map((resource) => [resource.normalizedUrl, resource]),
    );
    return [
      ...new Map(references(page).map((reference) => [reference.target, reference])).values(),
    ].flatMap(({ raw, target }) => {
      const resource = probes.get(target);
      if (
        resource === undefined ||
        resource.unverifiedReason !== undefined ||
        (resource.status < 400 && resource.fetchError === undefined)
      )
        return [];
      return [
        pageFinding(descriptor, page, {
          evidenceType: 'dom',
          selector: raw,
          resource: target,
          evidence: findingMessage('seo-tech-016.evidence', {
            url: raw,
            detail: resource.fetchError ?? `HTTP ${resource.status}`,
          }),
          recommendation: findingMessage('seo-tech-016.recommendation', {}),
          dependencyTargets: [target],
        }),
      ];
    });
  },
};
