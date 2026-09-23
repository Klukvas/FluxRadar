// PRIVACY-004 — homepage privacy/cookie policy discoverability.
// This is a technical link-presence check, not a legal determination that a
// policy is complete or valid for a particular jurisdiction.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('PRIVACY-004');

const POLICY_MARKER = /(privacy|cookie|datenschutz|privacidad|confidential|политик|приватност)/i;

export const privacy004PolicyDiscoverability: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    const homepage = ctx.crawl.pages.find(
      (page) => page.normalizedUrl === `${ctx.domain}/` && isSuccessfulHtmlPage(page),
    );
    if (homepage === undefined) {
      return { findings: [], applicableTargets: 0, affectedTargets: 0, checkedTargets: [] };
    }
    // Единственный вход этого правила — HTML главной страницы. Прогон без неё
    // ничего об этой находке не доказывает, а прогон с ней — доказывает, сколько
    // бы других страниц ни изменилось (§14).
    const checkedTargets = [homepage.normalizedUrl];
    const policyLink = parsePage(homepage)
      .querySelectorAll('a')
      .some((anchor) =>
        hasSameSitePolicyLink(anchor.getAttribute('href'), anchor.text, homepage, ctx),
      );
    if (policyLink) {
      return { findings: [], applicableTargets: 1, affectedTargets: 0, checkedTargets };
    }
    return {
      findings: [
        siteFinding(descriptor, homepage.finalUrl, {
          evidenceType: 'dom',
          evidence: findingMessage('privacy-004.evidence', {}),
          recommendation: findingMessage('privacy-004.recommendation', {}),
          resource: 'privacy-policy-link',
          confidence: 0.9,
        }),
      ],
      applicableTargets: 1,
      affectedTargets: 1,
      checkedTargets,
    };
  },
};

function hasSameSitePolicyLink(
  href: string | undefined,
  text: string,
  homepage: PageSnapshot,
  ctx: SiteContext,
): boolean {
  if (href === undefined || href.trim() === '') return false;
  if (!POLICY_MARKER.test(`${href} ${text}`)) return false;
  try {
    const target = new URL(href, homepage.finalUrl);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
    const sourceHost = new URL(ctx.domain).hostname;
    return target.hostname === sourceHost || target.hostname.endsWith(`.${sourceHost}`);
  } catch {
    return false;
  }
}
