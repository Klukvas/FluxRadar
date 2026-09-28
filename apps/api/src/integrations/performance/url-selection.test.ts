// selectAuditUrlsByTemplate and countAuditTemplates: the T5 template-aware
// selection built on top of templates.ts. The plain selectAuditUrls above it
// already has coverage through audit.test.ts; this file is the new surface.

import { describe, expect, it } from 'vitest';

import {
  countAuditTemplates,
  selectAuditUrlsByTemplate,
  MAX_AUDITED_URLS_BY_TEMPLATE,
} from './url-selection.ts';

const ORIGIN = 'https://example.com/';

describe('selectAuditUrlsByTemplate', () => {
  it('audits the entry page plus one representative per template, largest template first', () => {
    const candidates = [
      `${ORIGIN}blog/2024/hello`,
      `${ORIGIN}blog/2025/world`,
      `${ORIGIN}blog/2026/again`,
      `${ORIGIN}about`,
      `${ORIGIN}product/1`,
      `${ORIGIN}product/2`,
    ];
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates);
    expect(selections[0]).toEqual({ url: ORIGIN, templateKey: '/', representedPages: 1 });
    // Blog (3 pages) outranks product (2 pages) outranks the single static
    // page. The bare year in `/blog/2024/...` has no date context (no
    // neighbouring month/day segment), so it reads as an id — see templates.ts.
    expect(selections.map((entry) => entry.templateKey)).toEqual([
      '/',
      '/blog/{id}/{slug}',
      '/product/{id}',
      '/about',
    ]);
    expect(selections[1]).toMatchObject({
      templateKey: '/blog/{id}/{slug}',
      representedPages: 3,
    });
  });

  it('picks the shallowest URL as the representative, ties broken alphabetically', () => {
    const candidates = [`${ORIGIN}product/9`, `${ORIGIN}product/2`, `${ORIGIN}product/1/specs`];
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates);
    // product/9 and product/2 are both depth 1 and share the '/product/{id}'
    // template; product/1/specs is depth 2 and a different template
    // ('/product/{id}/specs'), so it never competes for this representative.
    const product = selections.find((entry) => entry.templateKey === '/product/{id}');
    expect(product?.url).toBe(`${ORIGIN}product/2`);
  });

  it('records how many crawled pages each representative stands in for', () => {
    const candidates = [`${ORIGIN}blog/a`, `${ORIGIN}blog/b`, `${ORIGIN}blog/c`];
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates);
    const blog = selections.find((entry) => entry.templateKey === '/blog/{slug}');
    expect(blog?.representedPages).toBe(3);
  });

  it('excludes non-page extensions and off-origin candidates, same as selectAuditUrls', () => {
    const candidates = [
      `${ORIGIN}sitemap.xml`,
      `${ORIGIN}data.json`,
      'https://other.example/page',
      `${ORIGIN}about`,
    ];
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates);
    expect(selections.map((entry) => entry.url)).toEqual([ORIGIN, `${ORIGIN}about`]);
  });

  it('respects the limit, keeping the entry page and the largest templates', () => {
    const candidates = [
      `${ORIGIN}blog/a`,
      `${ORIGIN}blog/b`,
      `${ORIGIN}product/1`,
      `${ORIGIN}docs/x`,
      `${ORIGIN}team/jane`,
    ];
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates, 2);
    expect(selections).toHaveLength(2);
    expect(selections[0]?.url).toBe(ORIGIN);
    expect(selections[1]?.templateKey).toBe('/blog/{slug}');
  });

  it('is deterministic across repeated calls with the same input', () => {
    const candidates = [`${ORIGIN}blog/a`, `${ORIGIN}product/1`, `${ORIGIN}docs/x`];
    const first = selectAuditUrlsByTemplate(ORIGIN, candidates);
    const second = selectAuditUrlsByTemplate(ORIGIN, candidates);
    expect(first).toEqual(second);
  });

  it('defaults to MAX_AUDITED_URLS_BY_TEMPLATE when no limit is given', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => `${ORIGIN}section-${index}/x`);
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates);
    expect(selections.length).toBeLessThanOrEqual(MAX_AUDITED_URLS_BY_TEMPLATE);
  });
});

describe('countAuditTemplates', () => {
  it('counts the distinct templates the measurable candidates sort into', () => {
    const candidates = [
      `${ORIGIN}blog/a`,
      `${ORIGIN}blog/b`,
      `${ORIGIN}product/1`,
      `${ORIGIN}about`,
    ];
    // root ('/'), '/blog/{slug}', '/product/{id}', '/about'
    expect(countAuditTemplates(ORIGIN, candidates)).toBe(4);
  });

  it('counts templates regardless of the audit limit', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => `${ORIGIN}section-${index}/x`);
    // root plus 20 distinct single-segment templates.
    expect(countAuditTemplates(ORIGIN, candidates)).toBe(21);
  });
});

describe('selectAuditUrlsByTemplate over a large crawl', () => {
  it('stays fast and bounded over 50,000 candidate URLs', () => {
    const candidates: string[] = [];
    for (let index = 0; index < 50_000; index += 1) {
      const template = index % 50;
      candidates.push(`${ORIGIN}section-${template}/${index}`);
    }
    const started = Date.now();
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates);
    const templatesFound = countAuditTemplates(ORIGIN, candidates);
    const elapsedMs = Date.now() - started;
    expect(selections.length).toBeLessThanOrEqual(MAX_AUDITED_URLS_BY_TEMPLATE);
    expect(elapsedMs).toBeLessThan(5_000);
    // 50 section prefixes plus the root path. A bare-year index (e.g. 1234)
    // now needs date CONTEXT to read as {date} (see templates.ts M1 fix), and
    // none of these indices has a neighbouring month/day segment, so every
    // index — 4 digits or not — reads uniformly as {id} and each section
    // sorts into exactly one template.
    expect(templatesFound).toBe(51);
  });

  it('stays fast and bounded with one dominant template (49,990 of 50,000 URLs)', () => {
    const candidates: string[] = [];
    for (let index = 0; index < 49_990; index += 1) {
      candidates.push(`${ORIGIN}product/${index}`);
    }
    for (let index = 0; index < 10; index += 1) {
      candidates.push(`${ORIGIN}about-${index}`);
    }
    const started = Date.now();
    const selections = selectAuditUrlsByTemplate(ORIGIN, candidates);
    const templatesFound = countAuditTemplates(ORIGIN, candidates);
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(5_000);
    expect(templatesFound).toBe(12); // root, /product/{id}, 10 distinct /about-N pages
    const product = selections.find((entry) => entry.templateKey === '/product/{id}');
    expect(product?.representedPages).toBe(49_990);
  });
});
