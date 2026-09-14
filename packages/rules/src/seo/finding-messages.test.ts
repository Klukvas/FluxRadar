// Every SEO finding carries message codes rather than finished text, so the
// Issue Center can show it in the reader's language. One case per message
// variant: the code proves which sentence a rule chose, and the Ukrainian
// render proves the rule passed every value that sentence names.

import { describe, expect, it } from 'vitest';

import type { SiteContext } from '../engine/types.js';
import { renderFindingMessage } from '../messages/index.js';
import {
  htmlContext,
  loadFixtureContext,
  runSeoRule,
  siteContext,
} from '../testing/fixture-harness.js';

interface MessageCase {
  readonly name: string;
  readonly ruleId: string;
  readonly ctx: () => SiteContext;
  readonly evidence: string;
  readonly recommendation: string;
}

function page(head: string, body = '<h1>Page</h1>'): SiteContext {
  return htmlContext(
    `<!doctype html><html lang="en"><head><title>Message fixture page</title>${head}</head>` +
      `<body>${body}</body></html>`,
  );
}

function headings(body: string): SiteContext {
  return page('', body);
}

function noindexLinkedFrom(hidden: {
  readonly head?: string;
  readonly headers?: Record<string, string>;
}): SiteContext {
  return siteContext({
    pages: [
      {
        path: '/linker.html',
        html:
          '<!doctype html><html lang="en"><head><title>Linking fixture page</title></head>' +
          '<body><h1>Linker</h1><a href="/hidden.html">hidden</a></body></html>',
      },
      {
        path: '/hidden.html',
        ...(hidden.headers !== undefined ? { headers: hidden.headers } : {}),
        html:
          `<!doctype html><html lang="en"><head><title>Hidden fixture page</title>${hidden.head ?? ''}` +
          '</head><body><h1>Hidden</h1></body></html>',
      },
    ],
  });
}

const CASES: readonly MessageCase[] = [
  {
    name: 'robots.txt missing',
    ruleId: 'SEO-TECH-001',
    ctx: () => loadFixtureContext('fx-SEO-TECH-001-positive.json'),
    evidence: 'seo-tech-001.evidence',
    recommendation: 'seo-tech-001.recommendation',
  },
  {
    name: 'sitemap missing',
    ruleId: 'SEO-TECH-002',
    ctx: () => loadFixtureContext('fx-SEO-TECH-002-positive.json'),
    evidence: 'seo-tech-002.evidence',
    recommendation: 'seo-tech-002.recommendation',
  },
  {
    name: 'error status',
    ruleId: 'SEO-TECH-003',
    ctx: () => loadFixtureContext('fx-SEO-TECH-003-positive.json'),
    evidence: 'seo-tech-003.evidence',
    recommendation: 'seo-tech-003.recommendation',
  },
  {
    name: 'canonical missing',
    ruleId: 'SEO-TECH-004',
    ctx: () => page(''),
    evidence: 'seo-tech-004.evidence.missing',
    recommendation: 'seo-tech-004.recommendation.missing',
  },
  {
    name: 'canonical not an http(s) URL',
    ruleId: 'SEO-TECH-004',
    ctx: () => page('<link rel="canonical" href="javascript:void(0)">'),
    evidence: 'seo-tech-004.evidence.invalid',
    recommendation: 'seo-tech-004.recommendation.invalid',
  },
  {
    name: 'canonical on another host',
    ruleId: 'SEO-TECH-004',
    ctx: () => loadFixtureContext('fx-SEO-TECH-004-positive.html'),
    evidence: 'seo-tech-004.evidence.foreign-host',
    recommendation: 'seo-tech-004.recommendation.foreign-host',
  },
  {
    name: 'redirect chain',
    ruleId: 'SEO-TECH-005',
    ctx: () => loadFixtureContext('fx-SEO-TECH-005-positive.json'),
    evidence: 'seo-tech-005.evidence.chain',
    recommendation: 'seo-tech-005.recommendation.chain',
  },
  {
    name: 'redirect loop',
    ruleId: 'SEO-TECH-005',
    ctx: () =>
      siteContext({
        pages: [{ path: '/loop', fetchError: 'safe-fetch: redirect limit of 5 exceeded' }],
      }),
    evidence: 'seo-tech-005.evidence.loop',
    recommendation: 'seo-tech-005.recommendation.loop',
  },
  {
    name: 'broken internal link',
    ruleId: 'SEO-TECH-006',
    ctx: () => loadFixtureContext('fx-SEO-TECH-006-positive.json'),
    evidence: 'seo-tech-006.evidence',
    recommendation: 'seo-tech-006.recommendation',
  },
  {
    name: 'duplicate URLs',
    ruleId: 'SEO-TECH-007',
    ctx: () => loadFixtureContext('fx-SEO-TECH-007-positive.json'),
    evidence: 'seo-tech-007.evidence',
    recommendation: 'seo-tech-007.recommendation',
  },
  {
    name: 'meta noindex on a sitemap page',
    ruleId: 'SEO-TECH-008',
    ctx: () => loadFixtureContext('fx-SEO-TECH-008-positive.json'),
    evidence: 'seo-tech-008.evidence.meta.sitemap',
    recommendation: 'seo-tech-008.recommendation',
  },
  {
    name: 'meta noindex on a linked page',
    ruleId: 'SEO-TECH-008',
    ctx: () => noindexLinkedFrom({ head: '<meta name="robots" content="noindex">' }),
    evidence: 'seo-tech-008.evidence.meta.internal-links',
    recommendation: 'seo-tech-008.recommendation',
  },
  {
    name: 'X-Robots-Tag noindex on a sitemap page',
    ruleId: 'SEO-TECH-008',
    ctx: () =>
      siteContext({
        sitemapUrls: ['https://fixture.test/hidden.html'],
        pages: [
          {
            path: '/hidden.html',
            headers: { 'x-robots-tag': 'noindex' },
            html:
              '<!doctype html><html lang="en"><head><title>Hidden fixture page</title></head>' +
              '<body><h1>Hidden</h1></body></html>',
          },
        ],
      }),
    evidence: 'seo-tech-008.evidence.header.sitemap',
    recommendation: 'seo-tech-008.recommendation',
  },
  {
    name: 'X-Robots-Tag noindex on a linked page',
    ruleId: 'SEO-TECH-008',
    ctx: () => noindexLinkedFrom({ headers: { 'x-robots-tag': 'noindex' } }),
    evidence: 'seo-tech-008.evidence.header.internal-links',
    recommendation: 'seo-tech-008.recommendation',
  },
  {
    name: 'mixed content',
    ruleId: 'SEO-TECH-013',
    ctx: () => loadFixtureContext('fx-SEO-TECH-013-positive.html'),
    evidence: 'seo-tech-013.evidence',
    recommendation: 'seo-tech-013.recommendation',
  },
  {
    name: 'title missing',
    ruleId: 'SEO-ONPAGE-001',
    ctx: () => loadFixtureContext('fx-SEO-ONPAGE-001-positive.html'),
    evidence: 'seo-onpage-001.evidence.missing',
    recommendation: 'seo-onpage-001.recommendation',
  },
  {
    name: 'title too short',
    ruleId: 'SEO-ONPAGE-001',
    ctx: () =>
      htmlContext(
        '<!doctype html><html lang="en"><head><title>Short</title></head><body><h1>Page</h1></body></html>',
      ),
    evidence: 'seo-onpage-001.evidence.too-short',
    recommendation: 'seo-onpage-001.recommendation',
  },
  {
    name: 'title too long',
    ruleId: 'SEO-ONPAGE-001',
    ctx: () =>
      htmlContext(
        `<!doctype html><html lang="en"><head><title>${'T'.repeat(71)}</title></head><body><h1>Page</h1></body></html>`,
      ),
    evidence: 'seo-onpage-001.evidence.too-long',
    recommendation: 'seo-onpage-001.recommendation',
  },
  {
    name: 'meta description missing',
    ruleId: 'SEO-ONPAGE-002',
    ctx: () => loadFixtureContext('fx-SEO-ONPAGE-002-positive.html'),
    evidence: 'seo-onpage-002.evidence.missing',
    recommendation: 'seo-onpage-002.recommendation',
  },
  {
    name: 'meta description too short',
    ruleId: 'SEO-ONPAGE-002',
    ctx: () => page('<meta name="description" content="Too short">'),
    evidence: 'seo-onpage-002.evidence.too-short',
    recommendation: 'seo-onpage-002.recommendation',
  },
  {
    name: 'meta description too long',
    ruleId: 'SEO-ONPAGE-002',
    ctx: () => page(`<meta name="description" content="${'D'.repeat(161)}">`),
    evidence: 'seo-onpage-002.evidence.too-long',
    recommendation: 'seo-onpage-002.recommendation',
  },
  {
    name: 'no headings at all',
    ruleId: 'SEO-ONPAGE-003',
    ctx: () => headings('<p>No headings</p>'),
    evidence: 'seo-onpage-003.evidence.no-headings',
    recommendation: 'seo-onpage-003.recommendation',
  },
  {
    name: 'no h1',
    ruleId: 'SEO-ONPAGE-003',
    ctx: () => headings('<h2>Second</h2>'),
    evidence: 'seo-onpage-003.evidence.no-h1',
    recommendation: 'seo-onpage-003.recommendation',
  },
  {
    name: 'no h1 and a skipped level',
    ruleId: 'SEO-ONPAGE-003',
    ctx: () => headings('<h2>Second</h2><h4>Fourth</h4>'),
    evidence: 'seo-onpage-003.evidence.no-h1.level-skip',
    recommendation: 'seo-onpage-003.recommendation',
  },
  {
    name: 'several h1',
    ruleId: 'SEO-ONPAGE-003',
    ctx: () => headings('<h1>First</h1><h1>Second</h1>'),
    evidence: 'seo-onpage-003.evidence.multiple-h1',
    recommendation: 'seo-onpage-003.recommendation',
  },
  {
    name: 'several h1 and a skipped level',
    ruleId: 'SEO-ONPAGE-003',
    ctx: () => headings('<h1>First</h1><h1>Second</h1><h3>Third</h3>'),
    evidence: 'seo-onpage-003.evidence.multiple-h1.level-skip',
    recommendation: 'seo-onpage-003.recommendation',
  },
  {
    name: 'skipped level',
    ruleId: 'SEO-ONPAGE-003',
    ctx: () => loadFixtureContext('fx-SEO-ONPAGE-003-positive.html'),
    evidence: 'seo-onpage-003.evidence.level-skip',
    recommendation: 'seo-onpage-003.recommendation',
  },
  {
    name: 'images without alt',
    ruleId: 'SEO-ONPAGE-005',
    ctx: () => loadFixtureContext('fx-SEO-ONPAGE-005-positive.html'),
    evidence: 'seo-onpage-005.evidence',
    recommendation: 'seo-onpage-005.recommendation',
  },
  {
    name: 'malformed JSON-LD',
    ruleId: 'SEO-STRUCT-001',
    ctx: () => page('<script type="application/ld+json">{"@context":</script>'),
    evidence: 'seo-struct-001.evidence',
    recommendation: 'seo-struct-001.recommendation',
  },
  {
    name: 'incomplete JSON-LD',
    ruleId: 'SEO-STRUCT-002',
    ctx: () => page('<script type="application/ld+json">{"name":"Example"}</script>'),
    evidence: 'seo-struct-002.evidence',
    recommendation: 'seo-struct-002.recommendation',
  },
  {
    name: 'social preview fields missing',
    ruleId: 'SEO-SOCIAL-001',
    ctx: () => page('<meta property="og:title" content="Example" />'),
    evidence: 'seo-social-001.evidence',
    recommendation: 'seo-social-001.recommendation',
  },
];

describe('SEO finding messages', () => {
  it.each(CASES)('$ruleId, $name: $evidence', ({ ruleId, ctx, evidence, recommendation }) => {
    const findings = runSeoRule(ruleId, ctx());
    expect(findings).toHaveLength(1);
    const messages = findings[0]?.messages;
    expect(messages?.evidence.code).toBe(evidence);
    expect(messages?.recommendation.code).toBe(recommendation);
    if (messages === undefined) return;
    expect(renderFindingMessage(messages.evidence, 'uk')).not.toBeNull();
    expect(renderFindingMessage(messages.recommendation, 'uk')).not.toBeNull();
  });

  it('writes the stored evidence in English with the page data filled in', () => {
    const [finding] = runSeoRule('SEO-ONPAGE-003', headings('<h2>Second</h2><h4>Fourth</h4>'));
    expect(finding?.evidenceExcerpt).toBe(
      'The page has no h1, and the jump from h2 to h4 skips a level. Heading outline: h2 → h4',
    );
    const [linked] = runSeoRule(
      'SEO-TECH-008',
      noindexLinkedFrom({ head: '<meta name="robots" content="noindex">' }),
    );
    expect(linked?.evidenceExcerpt).toBe(
      '<meta name="robots" content="noindex"> is set, yet other pages link to it internally ' +
        '(linking pages: 1)',
    );
  });
});
