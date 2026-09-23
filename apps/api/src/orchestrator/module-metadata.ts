// What a module records about itself beyond its score: which standard it
// applied, which DOM it read, and what each of its checks actually did.

import type { ModuleName, Plan } from '@fluxradar/contracts';
import type { CrawlRendering } from '@fluxradar/crawler';
import type { ModuleRunResult } from '@fluxradar/rules';

import type { ApiCheckResult } from './api-checks.ts';
import { freeCheckMetadata } from './free-check.ts';
import { ruleCheckSummaries } from './rule-checks.ts';

export interface RuleModuleContext {
  readonly rendering: CrawlRendering;
  readonly apiCheckResults: readonly ApiCheckResult[];
}

/**
 * How a rendered crawl is described in a module's metadata.
 *
 * A module reads the DOM the crawl handed it, so it has to say which DOM that
 * was. `Unavailable` is reported with its reason rather than silently reading
 * the static HTML as if scripts had run — that is the difference between "we
 * could not check this" and a fabricated result.
 */
export function renderingMetadata(rendering: CrawlRendering): Record<string, unknown> {
  if (rendering.status === 'NotRequested') {
    return { javascriptRendering: 'not requested', clientRenderedMarkup: 'not evaluated' };
  }
  if (rendering.status === 'Unavailable') {
    return {
      javascriptRendering: 'Unavailable',
      javascriptRenderingReason: rendering.reason,
      javascriptRenderingDetail: rendering.detail,
      clientRenderedMarkup: 'not verifiable: the browser runtime was unavailable',
    };
  }
  return {
    javascriptRendering: 'Rendered',
    renderEngine: `${rendering.engine} ${rendering.version}`,
    renderedPages: rendering.renderedPages,
    unrenderedPages: rendering.failedPages,
    // A page whose script the budget could not pay for, or whose bundle
    // robots.txt closed, rendered — as a different page. Reporting it with the
    // complete ones would make the sentence below a claim about markup that was
    // never evaluated, which is the one thing a render must not let the report
    // say.
    incompletelyRenderedPages: rendering.incompletePages,
    ...(rendering.incompleteReasons.length > 0
      ? { incompleteRenderReasons: rendering.incompleteReasons }
      : {}),
    clientRenderedMarkup:
      rendering.incompletePages === 0
        ? 'evaluated after the page scripts ran'
        : 'evaluated after the page scripts ran, except on pages whose own resources this scan could not load',
  };
}

export function metadataForRuleModule(
  module: ModuleName,
  plan: Plan,
  evaluations: ModuleRunResult['evaluations'],
  context: RuleModuleContext,
): string {
  // Every rule module records what each of its checks did, so the report can
  // open a section card to that list instead of showing only its totals.
  const ruleChecks = ruleCheckSummaries(evaluations);
  // Which DOM the module read is a property of every rule module, not of SEO
  // alone: an accessibility or content check reads the same markup.
  const rendering = renderingMetadata(context.rendering);
  if (plan === 'Free' && module === 'SEO') {
    // Free runs the fixed four-rule homepage check, not the full SEO module:
    // the paid module's structured-data and social-preview metadata would
    // describe checks that never ran (see free-check.ts).
    return JSON.stringify({ ...freeCheckMetadata(), ruleChecks });
  }
  return JSON.stringify({ ...standardMetadata(module, context), ...rendering, ruleChecks });
}

function standardMetadata(
  module: ModuleName,
  context: RuleModuleContext,
): Record<string, unknown> | undefined {
  if (module === 'Accessibility') {
    return {
      standard: 'WCAG 2.2 AA',
      profiles: ['EN 301 549', 'Section 508'],
      automation: 'static-dom-css',
      manualReviewRequired: true,
      legalCertification: false,
    };
  }
  if (module === 'Security') {
    return {
      standard: 'OWASP ASVS',
      profile: 'Public Security Profile',
      automation: 'public-http-headers-dom',
      manualReviewRequired: true,
      notVerifiable: ['source code', 'authenticated flows', 'server-side configuration'],
    };
  }
  if (module === 'Privacy') {
    return {
      standard: 'Privacy & Consent',
      scope: 'public technical signals',
      automation: 'static-http-dom',
      manualReviewRequired: true,
      legalAdvice: false,
    };
  }
  if (module === 'Reliability') {
    return {
      standard: 'Reliability',
      automation: 'public-http',
      // What the two REL-API rules were actually pointed at. Without it a
      // report can only say "no API problems found", which reads the same
      // whether twenty endpoints passed or none were listed.
      apiChecks: context.apiCheckResults,
    };
  }
  if (module === 'SEO') {
    return { structuredData: 'static-html-json-ld', socialPreview: 'static-html-meta' };
  }
  return undefined;
}
