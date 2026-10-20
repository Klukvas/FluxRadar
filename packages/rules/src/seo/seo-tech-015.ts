// SEO-TECH-015: next free technical SEO id, robots search-engine access.
import { blockedSearchEngines, robotsBlockEvidence } from '@fluxradar/crawler';
import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import { notApplicable, type SiteRule } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
const descriptor = requireDescriptor('SEO-TECH-015');
export const seoTech015SearchRobots: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx) {
    const content = ctx.robotsTxt ?? ctx.crawl.robotsTxt;
    if (content === undefined) return notApplicable('no-robots');
    const blocked = blockedSearchEngines(content, ctx.origin);
    const findings =
      blocked.length === 0
        ? []
        : [
            siteFinding(descriptor, new URL('/robots.txt', ctx.origin).href, {
              evidenceType: 'dom',
              parameter: blocked.join(','),
              evidence: findingMessage('seo-tech-015.evidence', {
                agents: blocked.join(', '),
                directives: blocked
                  .map((agent) => `${agent}: ${robotsBlockEvidence(content, agent, ctx.origin)}`)
                  .join('; '),
              }),
              recommendation: findingMessage('seo-tech-015.recommendation', {}),
            }),
          ];
    return {
      findings,
      applicableTargets: 1,
      affectedTargets: findings.length > 0 ? 1 : 0,
      checkedTargets: [new URL('/robots.txt', ctx.origin).href],
    };
  },
};
