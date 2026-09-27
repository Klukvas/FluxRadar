import { describe, expect, it } from 'vitest';

import { assessAiCrawlerReadiness } from './ai-readiness.js';
import { htmlContext } from './testing/fixture-harness.js';

describe('public AI crawler readiness', () => {
  it('runs without provider credentials and reports robots/page signals', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Readable page</title>' +
        '<link rel="canonical" href="https://fixture.test/page.html" />' +
        '<meta property="og:title" content="Readable" />' +
        '<meta property="og:description" content="A description" />' +
        '<meta property="og:image" content="https://fixture.test/image.png" />' +
        '<meta property="og:url" content="https://fixture.test/page.html" />' +
        '<meta name="twitter:card" content="summary" />' +
        '<script type="application/ld+json">' +
        '{"@context":"https://schema.org","@type":"Article"}' +
        '</script></head><body><main><h1>Readable page</h1>' +
        `<p>${'Useful public content '.repeat(20)}</p></main></body></html>`,
    );
    const report = assessAiCrawlerReadiness({
      ...ctx.crawl,
      robotsTxt: 'User-agent: GPTBot\nDisallow: /private\n',
    });
    expect(report.providerTokenRequired).toBe(false);
    expect(report.robots.status).toBe('available');
    expect(report.robots.agents.find((agent) => agent.userAgent === 'GPTBot')?.status).toBe(
      'allowed',
    );
    expect(report.pages).toMatchObject({
      checked: 1,
      extractableContent: 1,
      structuredData: 1,
      socialPreview: 1,
    });
  });

  it('measures extractable content on the decoded text, at the 200-character boundary', () => {
    // The gate reads the same visible text CONTENT-003 measures, and that text
    // has its entities decoded: `&amp;` is one character a reader sees, not
    // five. On this page the markup is 595 characters long and the text is 199,
    // so counting the markup would report a page as extractable that an AI
    // crawler has almost nothing to extract from.
    const escaped = (units: number, tail = ''): string =>
      `<!doctype html><html lang="en"><head><title>Entities</title></head>` +
      `<body><main><h1>H</h1><p>${'A&amp;'.repeat(units)}${tail}</p></main></body></html>`;

    const below = assessAiCrawlerReadiness(htmlContext(escaped(99)).crawl);
    expect(below.pages).toMatchObject({ checked: 1, extractableContent: 0 });

    const atBoundary = assessAiCrawlerReadiness(htmlContext(escaped(99, 'A')).crawl);
    expect(atBoundary.pages).toMatchObject({ checked: 1, extractableContent: 1 });
  });

  it('marks an explicit AI bot block and missing robots as unknown', () => {
    const ctx = htmlContext(
      '<!doctype html><html><head><title>Page</title></head><body></body></html>',
    );
    const blocked = assessAiCrawlerReadiness({
      ...ctx.crawl,
      robotsTxt: 'User-agent: ClaudeBot\nDisallow: /\n',
    });
    expect(blocked.robots.agents.find((agent) => agent.userAgent === 'ClaudeBot')?.status).toBe(
      'blocked',
    );
    const unknown = assessAiCrawlerReadiness(ctx.crawl);
    expect(unknown.robots.status).toBe('unavailable');
    expect(unknown.robots.agents.every((agent) => agent.status === 'unknown')).toBe(true);
  });
});
