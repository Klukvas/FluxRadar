// PRIVACY-004 — homepage privacy/cookie policy discoverability.
// This is a technical link-presence check, not a legal determination that a
// policy is complete or valid for a particular jurisdiction.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { HTMLElement } from 'node-html-parser';

import { requireDescriptor } from '../engine/descriptor.js';
import { siteFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('PRIVACY-004');

// Each marker names the policy itself, never a generic word: «политика» or
// «приватний» alone also label refund policies and "private lessons", and
// a false "policy found" hides a real finding. Cyrillic markers are pinned to
// noun forms so adjectives (приватний, конфіденційна) do not count; the Latin
// ones cover transliterated slugs such as /polityka-konfidentsiinosti.
const POLICY_MARKERS: readonly RegExp[] = [
  /privacy|cookie|datenschutz|privacidad|confidential/i,
  /приватн(?:іст|ост)/iu,
  /конфіденційн(?:іст|ост)/iu,
  /конфиденциальност/iu,
  /персональн\p{L}*\s+дан/iu,
  /(?<!\p{L})кук(?:і|и|іс|ис)(?!\p{L})/iu,
  /pryvatn(?:ist|ost)|privatnost/i,
  /konfiden(?:ts|c|z)i/i,
  /personal[a-z]*[-_]+(?:dan|data)/i,
];

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
      .some((anchor) => hasSameSitePolicyLink(anchor, homepage, ctx));
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
  anchor: HTMLElement,
  homepage: PageSnapshot,
  ctx: SiteContext,
): boolean {
  const href = anchor.getAttribute('href');
  if (href === undefined || href.trim() === '') return false;
  const label = [
    decodeHref(href),
    anchor.text,
    anchor.getAttribute('aria-label') ?? '',
    anchor.getAttribute('title') ?? '',
  ].join(' ');
  if (!POLICY_MARKERS.some((marker) => marker.test(label))) return false;
  try {
    const target = new URL(href, homepage.finalUrl);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
    const sourceHost = new URL(ctx.domain).hostname;
    return target.hostname === sourceHost || target.hostname.endsWith(`.${sourceHost}`);
  } catch {
    return false;
  }
}

// Cyrillic slugs arrive percent-encoded (/%D0%BF%D0%BE...); a malformed escape
// is still a usable href, so it is matched as written.
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}
