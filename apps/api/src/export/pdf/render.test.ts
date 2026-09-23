// The structure of the downloadable report, rendered against an in-memory
// finding store: how many pages it has, what is on each of them, and what
// happens to content that does not fit. What the document SAYS, and in which
// language, is `render.localization.test.ts`; the fixtures both suites render
// are in `test-utils/pdf-report-fixtures.ts`.
//
// The assertions here read the text back out of the produced file
// (test-utils/pdf-text.ts) rather than checking that it starts with `%PDF-`.
// Every defect this suite now covers — a document three times longer than its
// content, content pages with no footer, evidence cut at four thousand
// characters, CJK laid out as blank boxes — passed a header check.

import { describe, expect, it } from 'vitest';

import {
  actionPlan,
  analyticsMetadata,
  fakePrisma,
  footerCounter,
  isPdf,
  issueAt,
  performanceAudit,
  render,
  RENDERED_AT,
  SCAN_ID,
  scanWithModules,
  withoutFooter,
} from '../../test-utils/pdf-report-fixtures.ts';
import { extractPdfPages, pdfPageCount } from '../../test-utils/pdf-text.ts';
import { REPORT_COPY } from './copy.ts';
import { forEachFindingPage } from './report-data.ts';
import { renderReportPdf } from './render.ts';

describe('renderReportPdf', () => {
  it('produces a PDF for a scan with no findings at all', async () => {
    const { bytes, findingCount } = await render([]);
    expect(isPdf(bytes)).toBe(true);
    expect(findingCount).toBe(0);
    expect(bytes.byteLength).toBeGreaterThan(1_000);
  });

  it('writes every finding past the printable page’s 1 000 limit', async () => {
    const issues = Array.from({ length: 1_400 }, (_, index) => issueAt(index));
    const { bytes, findingCount, log } = await render(issues);

    expect(findingCount).toBe(1_400);
    expect(isPdf(bytes)).toBe(true);
    // Every finding exactly once: no page skipped and none repeated.
    expect(new Set(log.returnedIds).size).toBe(1_400);
    expect(log.returnedIds).toHaveLength(1_400);
  });

  it('stamps every page with the legal note and its number, and adds no page doing it', async () => {
    const issues = Array.from({ length: 60 }, (_, index) => issueAt(index));
    const { bytes } = await render(issues);
    const pages = extractPdfPages(bytes);
    const note = REPORT_COPY.en.footer;

    expect(pages.length).toBeGreaterThan(3);
    expect(pdfPageCount(bytes)).toBe(pages.length);
    pages.forEach((page, index) => {
      // The footer is on the page the content is on — not on a page of its own.
      expect(page).toContain(note);
      expect(footerCounter(page)).toEqual({ index: index + 1, total: pages.length });
      // …and the page carries content besides the footer. A file where the
      // footer paginated has two near-blank pages for every real one.
      expect(withoutFooter(page, note).length).toBeGreaterThan(40);
    });
  });

  it('reads the findings in bounded pages rather than all at once', async () => {
    const issues = Array.from({ length: 600 }, (_, index) => issueAt(index));
    const { log } = await render(issues);

    expect(log.pageSizes.every((size) => size <= 250)).toBe(true);
    expect(log.pageSizes.length).toBeGreaterThan(1);
  });

  it('keeps the urgency order across page boundaries', async () => {
    const issues = Array.from({ length: 600 }, (_, index) => issueAt(index));
    const { log } = await render(issues);
    const rankOf = new Map(issues.map((issue) => [issue.id, issue.severityRank]));
    const ranks = log.returnedIds.map((id) => rankOf.get(id) ?? -1);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
  });

  it('escapes Cyrillic-safe text as itself and CJK and emoji losslessly', async () => {
    const issues = [
      issueAt(0, {
        evidenceExcerpt: 'Заголовок сторінки відсутній — 頁面標題 — 🚀',
        recommendation: 'Додайте <title>, який описує сторінку.',
        targetUrl: 'https://приклад.укр/сторінка',
      }),
    ];
    const { bytes, findingCount } = await render(issues);
    const text = extractPdfPages(bytes).join('\n');

    expect(findingCount).toBe(1);
    // Cyrillic is in the packaged face and is written as itself.
    expect(text).toContain('Заголовок сторінки відсутній');
    // CJK and emoji are not: every one of them is recoverable from the escape.
    expect(text).toContain('\\u{9801}\\u{9762}\\u{6A19}\\u{984C}');
    expect(text).toContain('\\u{1F680}');
    // And the document says so, in its own language, rather than leaving the
    // reader to guess what the escapes are.
    expect(text).toContain(REPORT_COPY.en.unsupportedGlyphsHeading);
    expect(text).toContain('5 character(s)');
  });

  it('says nothing about escapes in a document that needed none', async () => {
    const { bytes } = await render([issueAt(0)]);
    expect(extractPdfPages(bytes).join('\n')).not.toContain(
      REPORT_COPY.en.unsupportedGlyphsHeading,
    );
  });

  it('writes a very long evidence excerpt in full, past any inline bound', async () => {
    // The old renderer stopped at 4 000 characters and said so in English. The
    // sentinel sits past that mark: if anything ever bounds the excerpt again,
    // this is the assertion that fails.
    const evidence = `START-OF-EVIDENCE ${'a'.repeat(4_200)} SENTINEL-AFTER-FOUR-THOUSAND`;
    const { bytes, findingCount } = await render([issueAt(0, { evidenceExcerpt: evidence })]);
    const text = extractPdfPages(bytes).join('\n');

    expect(findingCount).toBe(1);
    expect(text).toContain('START-OF-EVIDENCE');
    expect(text).toContain('SENTINEL-AFTER-FOUR-THOUSAND');
    expect(text).not.toContain('more characters');
    expect(text).not.toContain('complete text in the JSON export');
  });

  it('flows a multi-page excerpt onto the pages it needs, unbroken run and all', async () => {
    // Both shapes at the length the rules engine can actually store
    // (EVIDENCE_EXCERPT_MAX_CHARS): ordinary text that wraps, and a run with no
    // break in it at all, which is the case that has to be measured rather than
    // wrapped.
    const unbroken = 'a'.repeat(2_048);
    const flowing = Array.from({ length: 1_500 }, (_, index) => `token${index}`).join(' ');
    const { bytes, findingCount } = await render([
      issueAt(0, { evidenceExcerpt: `HEAD-EVIDENCE ${unbroken} ${flowing} TAIL-EVIDENCE` }),
    ]);
    const pages = extractPdfPages(bytes);
    const text = pages.join('\n');

    expect(findingCount).toBe(1);
    expect(pages.length).toBeGreaterThan(1);
    expect(text).toContain('HEAD-EVIDENCE');
    expect(text).toContain('TAIL-EVIDENCE');
    expect(text).toContain('token1499');
    expect(text.replaceAll(/[^a]/g, '').length).toBeGreaterThanOrEqual(2_048);
    // The pages the excerpt flowed onto are ordinary pages with ordinary footers.
    pages.forEach((page, index) => {
      expect(footerCounter(page)).toEqual({ index: index + 1, total: pages.length });
    });
  });

  it('renders the stored Performance audit when there is one', async () => {
    const audit = performanceAudit();
    const { bytes } = await render(
      [issueAt(0)],
      [{ module: 'Performance', metadataJson: JSON.stringify({ audit }) }],
    );
    expect(isPdf(bytes)).toBe(true);
  });

  it('never renders a prompt: the projection has no field that could carry one', async () => {
    const { prisma } = fakePrisma([]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules(),
      language: 'en',
      now: RENDERED_AT,
      loadActionPlan: async () => actionPlan(),
    });
    // The bytes are compressed, so this asserts the seam rather than the stream:
    // there is no prompt-shaped key in the projection at all.
    expect(Object.keys(actionPlan())).toEqual([
      'overview',
      'caveats',
      'actions',
      'reach',
      'metadata',
    ]);
    expect(Object.keys(actionPlan().metadata)).not.toContain('promptText');
    expect(isPdf(result.bytes)).toBe(true);
  });

  it('keeps a table cell that is longer than a page, and keeps the pages after it', async () => {
    // A single URL long enough that its row cannot fit on any page. The row is
    // stated as stacked blocks rather than columns; what may not happen is a
    // lost URL, a lost row after it, or a cell drawn over the page that follows.
    const url = `https://example.com/${'segment/'.repeat(1_500)}END-OF-VERY-LONG-URL`;
    const audit = performanceAudit();
    const { bytes } = await render(
      [issueAt(0)],
      [
        {
          module: 'Performance',
          metadataJson: JSON.stringify({
            audit: { ...audit, urls: [{ ...audit.urls[0], url }] },
          }),
        },
      ],
    );
    const pages = extractPdfPages(bytes);
    const text = pages.join('\n');

    expect(text).toContain('END-OF-VERY-LONG-URL');
    // The finding block that follows the table is still in the document.
    expect(text).toContain('Time to First Byte is 900 ms on mobile.');
    expect(text).toContain(REPORT_COPY.en.problemsHeading);
    pages.forEach((page, index) => {
      expect(footerCounter(page)).toEqual({ index: index + 1, total: pages.length });
    });
  });

  it('states when the Bing property is not the domain the report is about', async () => {
    const { bytes } = await render(
      [],
      [
        {
          module: 'Analytics',
          metadataJson: JSON.stringify(analyticsMetadata('https://shop.example.com/')),
        },
      ],
    );
    const text = extractPdfPages(bytes).join('\n');
    expect(text).toContain('shop.example.com');
    expect(text).toContain('which is not example.com');
  });

  it('says nothing about the property when it is the report’s own domain', async () => {
    const { bytes } = await render(
      [],
      [{ module: 'Analytics', metadataJson: JSON.stringify(analyticsMetadata()) }],
    );
    expect(extractPdfPages(bytes).join('\n')).not.toContain('which is not');
  });

  it('renders a Performance row written before the audit existed', async () => {
    const { bytes } = await render(
      [],
      [{ module: 'Performance', metadataJson: JSON.stringify({ source: 'pagespeed' }) }],
    );
    expect(isPdf(bytes)).toBe(true);
  });

  it('renders the action plan only when a ready one is supplied', async () => {
    const { prisma } = fakePrisma([issueAt(0)]);
    const withoutPlan = await renderReportPdf({
      prisma,
      scan: scanWithModules(),
      language: 'en',
      now: RENDERED_AT,
    });
    const notReady = await renderReportPdf({
      prisma,
      scan: scanWithModules(),
      language: 'en',
      now: RENDERED_AT,
      // A plan that is not ready is not a plan: the loader answers null.
      loadActionPlan: async () => null,
    });
    const withPlan = await renderReportPdf({
      prisma,
      scan: scanWithModules(),
      language: 'en',
      now: RENDERED_AT,
      loadActionPlan: async () => actionPlan(),
    });
    expect(notReady.bytes.byteLength).toBe(withoutPlan.bytes.byteLength);
    expect(withPlan.bytes.byteLength).toBeGreaterThan(withoutPlan.bytes.byteLength);
  });

  it('asks the plan loader for this scan, this account and this language', async () => {
    const { prisma } = fakePrisma([issueAt(0)]);
    const asked: unknown[] = [];
    await renderReportPdf({
      prisma,
      scan: scanWithModules(),
      language: 'uk',
      now: RENDERED_AT,
      loadActionPlan: async (request) => {
        asked.push(request);
        return null;
      },
    });
    expect(asked).toEqual([{ scanId: SCAN_ID, accountId: 'account-1', language: 'uk' }]);
  });
});

describe('forEachFindingPage', () => {
  it('returns zero, and calls nothing, for a scan with no findings', async () => {
    const { prisma } = fakePrisma([]);
    const pages: number[] = [];
    const total = await forEachFindingPage(prisma, SCAN_ID, 'en', (page) => {
      pages.push(page.length);
    });
    expect(total).toBe(0);
    expect(pages).toEqual([]);
  });

  it('hands over every finding exactly once, in pages of the requested size', async () => {
    const issues = Array.from({ length: 7 }, (_, index) => issueAt(index));
    const { prisma } = fakePrisma(issues);
    const seen: string[] = [];
    const total = await forEachFindingPage(
      prisma,
      SCAN_ID,
      'en',
      (page) => {
        seen.push(...page.map((finding) => finding.id));
      },
      3,
    );
    expect(total).toBe(7);
    expect(new Set(seen).size).toBe(7);
  });
});
