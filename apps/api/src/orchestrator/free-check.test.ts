import { FREE_CHECK_RULE_IDS } from '@fluxradar/contracts';
import { createSiteContext, runModuleRules } from '@fluxradar/rules';
import type { IssueCandidate, SiteContext } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

import { runFreeCheck } from './free-check.ts';

// D-237: the Free check gained rules so a Free report is rarely empty. These
// tests keep the additions honest: each Free rule can pass and can fail on one
// static homepage, and a Free finding is exactly what the paid SEO module would
// report for the same rule on the same page — no Free-only threshold, severity
// or penalty that could be tuned to make a report look worse than it is.

const ORIGIN = 'https://smile.example';
const HOME = `${ORIGIN}/`;

const DESCRIPTION =
  'Smile Clinic places dental implants in Kyiv and sees emergency patients the same day.';

const CLEAN_HOME =
  '<html lang="en"><head><title>Smile Clinic — dental care in Kyiv</title>' +
  `<meta name="description" content="${DESCRIPTION}">` +
  '<meta property="og:title" content="Smile Clinic">' +
  `<meta property="og:description" content="${DESCRIPTION}">` +
  `<meta property="og:image" content="${ORIGIN}/og.png">` +
  `<meta property="og:url" content="${HOME}">` +
  '<meta name="twitter:card" content="summary_large_image">' +
  '</head><body><h1>Implants in Kyiv</h1>' +
  '<img src="/team.jpg" alt="Our dentists"><img src="/divider.svg" alt="">' +
  '<p>We place implants and see emergency patients the same day.</p></body></html>';

// Fails every Free rule: no title, no description, no H1, noindex on a page the
// sitemap lists, no social preview tags and an image without alt.
const FAILING_HOME =
  '<html lang="en"><head><meta name="robots" content="noindex"></head>' +
  '<body><h2>Implants in Kyiv</h2><img src="/team.jpg">' +
  '<p>We place implants and see emergency patients the same day.</p></body></html>';

function homepageContext(html: string, sitemapUrls: readonly string[] = []): SiteContext {
  return createSiteContext({
    origin: ORIGIN,
    plan: 'Free',
    crawl: {
      pages: [
        {
          requestedUrl: HOME,
          normalizedUrl: HOME,
          depth: 0,
          finalUrl: HOME,
          status: 200,
          headers: { 'content-type': 'text/html' },
          redirectChain: [],
          html,
          contentType: 'text/html',
          timingMs: 12,
          truncated: false,
        },
      ],
      skippedOverLimit: [],
      blockedByRobots: [],
      errors: [],
      urlVariants: {},
      sitemapUrls,
      rejectedSeeds: [],
      rendering: { status: 'NotRequested' },
      resources: [],
      pendingQueue: [],
      stoppedEarly: false,
      scope: { origin: ORIGIN, includeSubdomains: false, maxPages: 1 },
    },
  });
}

/** What a finding claims, without the prose: what the score and the report read. */
function claim(finding: IssueCandidate) {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    scoreDelta: finding.scoreDelta,
    normalizedParameter: finding.normalizedParameter,
    normalizedSelector: finding.normalizedSelector,
    normalizedResource: finding.normalizedResource,
    fingerprint: finding.fingerprint,
    affectedTargets: finding.affectedTargets,
    applicableTargets: finding.applicableTargets,
  };
}

function byRule(left: { ruleId: string }, right: { ruleId: string }): number {
  return left.ruleId.localeCompare(right.ruleId);
}

const failing = (): SiteContext => homepageContext(FAILING_HOME, [HOME]);

describe('the Free check on one homepage', () => {
  it('finds nothing on a clean homepage, with every rule applicable and completed', () => {
    const result = runFreeCheck(homepageContext(CLEAN_HOME, [HOME]));
    expect(result.findings).toEqual([]);
    expect(result.evaluations.map((evaluation) => evaluation.ruleId)).toEqual([
      ...FREE_CHECK_RULE_IDS,
    ]);
    expect(result.applicableChecks).toBe(FREE_CHECK_RULE_IDS.length);
    expect(result.completedApplicableChecks).toBe(FREE_CHECK_RULE_IDS.length);
  });

  it('reports one finding per Free rule on a homepage that fails them all', () => {
    const result = runFreeCheck(failing());
    expect(result.findings.map((finding) => finding.ruleId).sort()).toEqual(
      [...FREE_CHECK_RULE_IDS].sort(),
    );
    expect(result.applicableChecks).toBe(FREE_CHECK_RULE_IDS.length);
    expect(result.completedApplicableChecks).toBe(FREE_CHECK_RULE_IDS.length);
  });

  it('reports missing Open Graph and Twitter tags as SEO-SOCIAL-001', () => {
    const html = CLEAN_HOME.replace(/<meta (property="og:|name="twitter:)[^>]*>/g, '');
    const findings = runFreeCheck(homepageContext(html)).findings;
    expect(findings.map((finding) => finding.ruleId)).toEqual(['SEO-SOCIAL-001']);
    expect(findings[0]?.evidenceExcerpt).toContain('og:title');
  });

  it('reports an image without alt as SEO-ONPAGE-005, and accepts an empty alt', () => {
    const html = CLEAN_HOME.replace(
      '<img src="/team.jpg" alt="Our dentists">',
      '<img src="/team.jpg">',
    );
    const findings = runFreeCheck(homepageContext(html)).findings;
    expect(findings.map((finding) => finding.ruleId)).toEqual(['SEO-ONPAGE-005']);
    expect(findings[0]?.normalizedSelector).toBe('img[src="/team.jpg"]');
  });

  it('matches the paid SEO module finding for finding on the same page', () => {
    const ctx = failing();
    const free = runFreeCheck(ctx).findings.map(claim).sort(byRule);
    const freeRules = new Set<string>(FREE_CHECK_RULE_IDS);
    const paid = runModuleRules('SEO', ctx)
      .findings.filter((finding) => freeRules.has(finding.ruleId))
      .map(claim)
      .sort(byRule);
    expect(free).toHaveLength(FREE_CHECK_RULE_IDS.length);
    expect(free).toEqual(paid);
  });
});
