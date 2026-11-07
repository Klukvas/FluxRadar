// "What AI says about your business" in the downloadable report: what it says
// in both languages, when it says nothing at all, and that it never moves page
// one. Every assertion reads the text back out of the produced file.

import type { ScanModule } from '@prisma/client';
import { GEO_MENTION_CONTEXT_MAX_CHARS } from '@fluxradar/ai';
import type { FindingLanguage } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

import type { ReportBrand } from '../../branding/load.ts';
import {
  fakePrisma,
  footerCounter,
  geoAnsweredRequest,
  geoModuleMetadata,
  geoProviderVisibility,
  geoProviderWithoutScore,
  issueAt,
  RENDERED_AT,
  scanWithModules,
  withoutFooter,
} from '../../test-utils/pdf-report-fixtures.ts';
import { extractPdfPages } from '../../test-utils/pdf-text.ts';
import { brandedCopy } from './branding.ts';
import { REPORT_COPY } from './copy.ts';
import {
  boundedMentionContext,
  GEO_MODULE_NAME,
  storedMentionContexts,
} from './geo-visibility-section.ts';
import { renderReportPdf } from './render.ts';

const MENTION = 'Lagoda Kava roasts its own beans and is a favourite near the old town.';

function geoModule(metadata: unknown): Partial<ScanModule> {
  return {
    module: GEO_MODULE_NAME,
    score: null,
    metadataJson: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
  };
}

function fullMetadata(mention = MENTION) {
  return geoModuleMetadata(undefined, [
    geoAnsweredRequest('openai', mention),
    geoAnsweredRequest('google'),
  ]);
}

async function renderPages(
  metadata: unknown,
  options: { readonly language?: FindingLanguage; readonly brand?: ReportBrand } = {},
): Promise<readonly string[]> {
  const { prisma } = fakePrisma([issueAt(0), issueAt(1)]);
  const modules = metadata === undefined ? [{}] : [{}, geoModule(metadata)];
  const rendered = await renderReportPdf({
    prisma,
    scan: scanWithModules(modules),
    language: options.language ?? 'en',
    now: RENDERED_AT,
    ...(options.brand === undefined ? {} : { brand: options.brand }),
  });
  return extractPdfPages(rendered.bytes);
}

function flat(pages: readonly string[]): string {
  return pages.join('\n').replace(/\s+/g, ' ');
}

describe.each(['en', 'uk'] as const)('the AI visibility block in %s', (language) => {
  const text = REPORT_COPY[language].geoVisibility;

  it('shows both engines, their figures, cited sites and the mention sentence', async () => {
    const body = flat(await renderPages(fullMetadata(), { language }));
    expect(body).toContain(text.heading);
    expect(body).toContain(text.lead);
    expect(body).toContain('ChatGPT · OpenAI');
    expect(body).toContain('Gemini · Google');
    expect(body).toContain(`${text.scoreLabel}: ${REPORT_COPY[language].scoreOutOf(52)}`);
    expect(body).toContain(text.brandShare(3, 5, 60));
    expect(body).toContain(text.domainShare(2, 5, 40));
    expect(body).toContain(text.citedInsteadEntry('coffee-guide.example', 2));
    expect(body).toContain(text.citedInsteadEntry('city-cafes.example', 1));
    expect(body).toContain(text.citedInsteadNone);
    expect(body).toContain(text.mentionLabel.toUpperCase());
    expect(body).toContain(`“${MENTION}”`);
  });

  it('states a missing score as not enough data, never as zero', async () => {
    const body = flat(await renderPages(fullMetadata(), { language }));
    expect(body).toContain(text.notEnoughData(1, 0, 2));
    expect(body).toContain(text.domainNotMeasurable);
    expect(body).not.toContain(REPORT_COPY[language].scoreOutOf(0));
  });
});

describe('when the block is left out', () => {
  const cases: readonly [string, unknown][] = [
    ['no GEO module', undefined],
    ['unparseable metadata', '{not json'],
    ['a scan from before the summary', { providerVisibility: { requests: [] } }],
    [
      'a summary that disagrees with itself',
      geoModuleMetadata([geoProviderVisibility({ visibilityScore: null })]),
    ],
    [
      'no engine with a usable signal',
      geoModuleMetadata([
        geoProviderWithoutScore({
          brandMeasuredCount: 0,
          brandMentionedCount: 0,
          brandMentionedShare: null,
          scoreUnavailableReason: 'not-measurable',
        }),
        geoProviderVisibility({ provider: 'anthropic', questionsAnswered: 0 }),
      ]),
    ],
  ];

  it.each(cases)('renders no heading for %s', async (_name, metadata) => {
    const pages = await renderPages(metadata);
    const body = flat(pages);
    expect(body).not.toContain(REPORT_COPY.en.geoVisibility.heading);
    expect(body).not.toContain(REPORT_COPY.en.geoVisibility.scoreLabel);
    // The real baseline: a GEO module row whose metadata carries no summary.
    expect(pages).toHaveLength((await renderPages({})).length);
  });
});

describe('the rest of the report', () => {
  it('leaves page one exactly as it is without the block', async () => {
    const footer = REPORT_COPY.en.footer;
    const withBlock = await renderPages(fullMetadata());
    const without = await renderPages({});
    expect(flat(withBlock)).toContain(REPORT_COPY.en.geoVisibility.heading);
    expect(withoutFooter(withBlock[0] ?? '', footer)).toBe(withoutFooter(without[0] ?? '', footer));
    expect(withBlock[0]).not.toContain(REPORT_COPY.en.geoVisibility.heading);
  });

  it.each(['en', 'uk'] as const)('keeps the branded %s PDF free of FluxRadar', async (language) => {
    const brand: ReportBrand = {
      displayName: 'Студія Приклад',
      accent: '#335577',
      contactLine: 'hello@studio.example',
      logo: null,
    };
    const { prisma } = fakePrisma([issueAt(0)]);
    const rendered = await renderReportPdf({
      prisma,
      scan: scanWithModules([{}, geoModule(fullMetadata())]),
      language,
      now: RENDERED_AT,
      brand,
    });
    const body = flat(extractPdfPages(rendered.bytes));
    expect(body).toContain(brandedCopy(language).geoVisibility.heading);
    expect(body).not.toMatch(/fluxradar|flux-lab|fluxlab/i);
    expect(rendered.bytes.toString('latin1')).not.toMatch(/FluxRadar/);
  });

  it('caps a long mention sentence and keeps every page footer in order', async () => {
    const long = `${'Lagoda Kava is mentioned here\nagain and again. '.repeat(80)}TAIL-MARKER`;
    const pages = await renderPages(fullMetadata(long), { language: 'uk' });
    const body = flat(pages);
    expect(body).toContain(REPORT_COPY.uk.geoVisibility.mentionLabel.toUpperCase());
    expect(body).not.toContain('TAIL-MARKER');
    expect(body).toContain('…”');
    pages.forEach((page, index) => {
      expect(footerCounter(page)).toEqual({ index: index + 1, total: pages.length });
    });
  });
});

describe('stored mention sentences', () => {
  it('keeps the first answered sentence per engine and skips anything else', () => {
    const contexts = storedMentionContexts(
      JSON.stringify(
        geoModuleMetadata(undefined, [
          { ...geoAnsweredRequest('openai'), status: 'unavailable', mentionContext: 'skipped' },
          geoAnsweredRequest('openai', '  first\n sentence '),
          geoAnsweredRequest('openai', 'second sentence'),
          geoAnsweredRequest('google', '   '),
          'not a record',
        ]),
      ),
    );
    expect([...contexts]).toEqual([['openai', 'first sentence']]);
    expect(storedMentionContexts('{broken')).toEqual(new Map());
  });

  it('never returns more than the scan-time bound', () => {
    const bounded = boundedMentionContext('х'.repeat(1_000));
    expect([...bounded]).toHaveLength(GEO_MENTION_CONTEXT_MAX_CHARS);
    expect(bounded.endsWith('…')).toBe(true);
    expect(boundedMentionContext('short')).toBe('short');
  });
});

describe('the Ukrainian copy', () => {
  const leaves = Object.values(REPORT_COPY.uk.geoVisibility).map((value) =>
    typeof value === 'function'
      ? String(Reflect.apply(value, null, ['site.example', 2, 3]))
      : value,
  );

  it('uses no dash construction and none of the barred words', () => {
    for (const leaf of leaves) {
      expect(leaf).not.toMatch(/ [—–] /);
      expect(leaf).not.toMatch(/безкоштовн|без картки|claude|anthropic/i);
    }
  });
});
