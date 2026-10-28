import zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  actionPlan,
  fakePrisma,
  footerCounter,
  issueAt,
  RENDERED_AT,
  scanWithModules,
} from '../../test-utils/pdf-report-fixtures.ts';
import { extractPdfPages } from '../../test-utils/pdf-text.ts';
import type { ReportBrand } from '../../branding/load.ts';
import { sanitizeLogoPng } from '../../branding/png.ts';
import { brandedCopy, brandPalette, preparedBy } from './branding.ts';
import { REPORT_COLOURS, ReportDocument } from './document.ts';
import { neutralStatusCopy } from './status-text.ts';
import { neutralProviderCopy } from './provider-state.ts';
import { renderReportPdf } from './render.ts';

const brand: ReportBrand = {
  displayName: 'Studio Blue',
  accent: '#445566',
  contactLine: 'hello@example.com',
  logo: null,
};
const forbidden = /fluxradar(?!bot)|fluxlab|flux-lab|FluxRadarBot/i;
function walk(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return walk(Reflect.apply(value, null, [2, 2, 2, 2, 2, 2]));
  return typeof value === 'object' && value !== null ? Object.values(value).flatMap(walk) : [];
}
function rgba(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(200);
  header.writeUInt32BE(50, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (type: string, data: Buffer): Buffer => {
    const size = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([size, Buffer.from(type), data, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(50 * 801))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function modules() {
  return [
    ...[
      'TargetsUnreachable',
      'TargetsPartiallyUnreachable',
      'NoDeterministicOracle',
      'ProviderContract',
    ].map((statusReason) => ({ module: 'SEO', runtimeStatus: 'Unavailable', statusReason })),
    {
      module: 'Analytics',
      metadataJson: JSON.stringify({
        source: 'google',
        searchConsole: {
          state: 'unknown-provider-state',
          detail: 'FluxRadar fallback',
          data: null,
        },
        analytics: { state: 'no_data', detail: 'FluxRadar', data: null },
        bing: {
          snapshot: {
            source: 'bing',
            webmaster: { state: 'request_failed', detail: 'FluxRadar fallback', data: null },
          },
        },
      }),
    },
  ];
}

describe.each(['en', 'uk'] as const)('branded %s PDF', (language) => {
  it('sweeps all neutral report, status and provider leaves', () => {
    const leaves = walk({
      report: brandedCopy(language),
      status: neutralStatusCopy(language),
      provider: neutralProviderCopy(language),
    });
    expect(leaves.length).toBeGreaterThan(100);
    for (const leaf of leaves) expect(leaf).not.toMatch(forbidden);
  });
  it('contains the agency, neutral status/provider text, AI label and footer on every page', async () => {
    const plan = actionPlan(),
      issues = Array.from({ length: 20 }, (_, index) => issueAt(index));
    const { prisma } = fakePrisma(issues);
    const rendered = await renderReportPdf({
      prisma,
      scan: scanWithModules(modules()),
      language,
      now: RENDERED_AT,
      brand,
      loadActionPlan: async () => plan,
    });
    const pages = extractPdfPages(rendered.bytes),
      text = pages.join('\n');
    expect(text).toContain(brand.displayName);
    expect(text).toContain(preparedBy(brand.displayName, language));
    expect(text).toContain(brand.contactLine);
    expect(text).not.toMatch(forbidden);
    expect(rendered.bytes.toString('latin1')).not.toMatch(/FluxRadar/);
    expect(text).not.toContain(plan.metadata.modelId);
    expect(text).not.toContain(plan.metadata.promptVersion);
    expect(text).toContain(brandedCopy(language).aiGenerated);
    // Written the way the rest of the document writes a moment, not as raw ISO.
    expect(text).toContain('2026-09-22 11:30');
    expect(text).not.toContain(plan.metadata.generatedAt);
    pages.forEach((page, index) => {
      expect(page).toContain(brandedCopy(language).footer);
      expect(footerCounter(page)).toEqual({ index: index + 1, total: pages.length });
    });
    expect(rendered.bytes.toString('latin1')).not.toContain('/Subtype /Image');
  });
  it('keeps user text out of XMP and finishes an RGBA logo', async () => {
    const safe = await sanitizeLogoPng(rgba());
    const { prisma } = fakePrisma([]);
    const bytes = (
      await renderReportPdf({
        prisma,
        scan: scanWithModules(),
        language,
        now: RENDERED_AT,
        brand: {
          ...brand,
          displayName: '</rdf:li><x>',
          logo: { png: safe.png, width: safe.width, height: safe.height },
        },
      })
    ).bytes;
    expect(bytes.toString('latin1')).toContain('/Subtype /Image');
    expect(bytes.toString('latin1')).not.toContain('</rdf:li><x>');
    expect(extractPdfPages(bytes).join(' ')).toContain('</rdf:li><x>');
  });
});

it('keeps the finding URL accent distinct from the agency palette', async () => {
  expect(brandPalette(brand)).toEqual({ ...REPORT_COLOURS, brand: brand.accent });
  const text = vi.spyOn(ReportDocument.prototype, 'text');
  const { prisma } = fakePrisma([issueAt(1)]);
  await renderReportPdf({
    prisma,
    scan: scanWithModules(),
    language: 'en',
    now: RENDERED_AT,
    brand,
  });
  expect(text).toHaveBeenCalledWith(
    'https://example.com/page-1',
    expect.objectContaining({ colour: 'accent' }),
  );
  text.mockRestore();
});
