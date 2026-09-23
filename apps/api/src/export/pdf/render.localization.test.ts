// What the downloadable report SAYS, and in which language.
//
// Its own suite because that is a different question from the one
// `render.test.ts` asks: that file is about the structure of the document —
// pagination, the footer band, an excerpt longer than a page — and this one is
// about every string a reader meets. The defects behind it were all the same
// shape: a Ukrainian report printing the API's English. The Sections table read
// `Partial · PerformanceSamplesIncomplete`; the Search data section read
// `Google is not connected for this workspace.` one line under the same fact in
// Ukrainian; the Performance findings — which the browser report does not show at
// all, so this file is where a customer meets them — were five English paragraphs
// under Ukrainian headings with an English `INFO` badge above them.
//
// Every assertion reads the text back out of the produced file
// (test-utils/pdf-text.ts). Cell text wraps, so the layout's line breaks are
// collapsed before a sentence is looked for.

import { describe, expect, it } from 'vitest';

import {
  analyticsMetadata,
  bingFinding,
  fakePrisma,
  googleMetadata,
  isPdf,
  issueAt,
  performanceAudit,
  performanceFindings,
  render,
  RENDERED_AT,
  scanWithModules,
} from '../../test-utils/pdf-report-fixtures.ts';
import { extractPdfPages } from '../../test-utils/pdf-text.ts';
import { REPORT_COPY } from './copy.ts';
import { moduleLabel, ruleTitle } from './names.ts';
import { renderReportPdf } from './render.ts';
import { issueStatusText, moduleResultText, scanStatusText } from './status-text.ts';

describe('the report’s own words', () => {
  it('renders the Ukrainian document in Ukrainian, headings and all', async () => {
    const audit = performanceAudit();
    const { prisma } = fakePrisma([issueAt(0)]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules([
        { module: 'Performance', metadataJson: JSON.stringify({ audit }) },
        { module: 'Analytics', metadataJson: JSON.stringify(analyticsMetadata()) },
      ]),
      language: 'uk',
      now: RENDERED_AT,
    });
    const text = extractPdfPages(result.bytes).join('\n');

    expect(isPdf(result.bytes)).toBe(true);
    // Table headings, device names, the run count and the provider totals —
    // the strings that used to be English inside the Ukrainian document.
    expect(text).toContain(REPORT_COPY.uk.device);
    expect(text).toContain(REPORT_COPY.uk.runs);
    expect(text).toContain(REPORT_COPY.uk.deviceName.mobile);
    expect(text).toContain(REPORT_COPY.uk.query);
    expect(text).toContain(REPORT_COPY.uk.bingTotals(140, 5_200, 19));
    expect(text).toContain(REPORT_COPY.uk.footer);
    // The metric table's own figures, in the reader's units: the acronyms above
    // them stay as the provider states them, the durations do not.
    expect(text).toContain('3.4 с');
    expect(text).toContain('900 мс');
    expect(text).not.toContain('3.4 s');
    // `900 ms` is deliberately not asserted against: this fixture's one finding
    // carries evidence its sentence cannot be rebuilt from, so it keeps the
    // stored English, and that sentence states the same figure in the API's units.
    //
    // Where the finding stands, in the same words the Issue Center uses.
    expect(text).toContain(issueStatusText('New', 'uk'));
    expect(text).not.toContain('days reported');
    expect(text).not.toContain('Runs');
    expect(text).not.toContain('New');
  });

  // The Sections table used to print the API's own vocabulary: a Ukrainian
  // report read "Partial · PerformanceSamplesIncomplete", which is neither a
  // status the reader can act on nor a language they read.
  it('states the scan and section reasons in the reader’s language, not as tokens', async () => {
    const { prisma } = fakePrisma([]);
    const scan = scanWithModules([
      {
        module: 'Performance',
        runtimeStatus: 'Partial',
        statusReason: 'PerformanceSamplesIncomplete',
        coverage: 0.5,
        score: null,
      },
      {
        module: 'Analytics',
        runtimeStatus: 'Unavailable',
        statusReason: 'AnalyticsIntegrationNotConnected',
        coverage: 0,
        score: null,
      },
    ]);
    const result = await renderReportPdf({
      prisma,
      scan: { ...scan, status: 'Partial', statusReason: 'ExternalModuleFailure' },
      language: 'uk',
      now: RENDERED_AT,
    });
    // Cells wrap, so the line breaks the layout added are collapsed before the
    // sentences are looked for.
    const text = extractPdfPages(result.bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain(
      scanStatusText({ status: 'Partial', statusReason: 'ExternalModuleFailure' }, 'uk'),
    );
    expect(text).toContain(
      moduleResultText(
        { runtimeStatus: 'Partial', statusReason: 'PerformanceSamplesIncomplete' },
        'uk',
      ),
    );
    expect(text).toContain(
      moduleResultText(
        { runtimeStatus: 'Unavailable', statusReason: 'AnalyticsIntegrationNotConnected' },
        'uk',
      ),
    );
    for (const token of [
      'PerformanceSamplesIncomplete',
      'AnalyticsIntegrationNotConnected',
      'ExternalModuleFailure',
      'Partial',
      'Unavailable',
    ]) {
      expect(text).not.toContain(token);
    }
  });

  // The names were the last English left in a Ukrainian document: the Sections
  // table printed the API's `module` (`Content Quality`) and every problem was
  // headlined by its rule id, with the status and the recommendation localized
  // around them.
  it('names its sections and its problems in the reader’s language', async () => {
    const { prisma } = fakePrisma([
      issueAt(0, { ruleId: 'SEC-PASSIVE-002', module: 'Security' }),
      // A Performance finding: written by the audit, so the registry has no
      // title for it and it keeps its id rather than losing its heading.
      issueAt(1, { ruleId: 'PERF-LCP-001', module: 'Performance' }),
    ]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules([
        { module: 'Security', score: 71 },
        { module: 'Content Quality', score: 88 },
      ]),
      language: 'uk',
      now: RENDERED_AT,
    });
    const text = extractPdfPages(result.bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain(moduleLabel('Content Quality', 'uk'));
    expect(text).toContain(moduleLabel('Security', 'uk'));
    expect(text).toContain(ruleTitle('SEC-PASSIVE-002', 'uk'));
    // The id keeps its line under the heading: it is what a reader quotes to
    // support, and what a rule this build has no title for still prints.
    expect(text).toContain('SEC-PASSIVE-002');
    expect(text).toContain('PERF-LCP-001');
    for (const english of ['Content Quality', 'Security', 'Performance']) {
      expect(text).not.toContain(english);
    }
  });

  it('names them in English in the English document, sections and problems alike', async () => {
    const { bytes } = await render(
      [issueAt(0, { ruleId: 'SEC-PASSIVE-002', module: 'Security' })],
      [{ module: 'Content Quality' }],
    );
    const text = extractPdfPages(bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain(moduleLabel('Content Quality', 'en'));
    expect(text).toContain(ruleTitle('SEC-PASSIVE-002', 'en'));
    expect(text).toContain('SEC-PASSIVE-002');
  });

  // Nothing connected is the ordinary case, and it used to state the same fact
  // twice: in Ukrainian in the Sections table, in English under Search data.
  it('says why a provider has no figures in the reader’s language, not the API’s', async () => {
    const { prisma } = fakePrisma([]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules([
        {
          module: 'Analytics',
          metadataJson: JSON.stringify({
            ...googleMetadata(),
            bing: {
              snapshot: {
                source: 'bing',
                readOnly: true,
                fetchedAt: '2026-09-22T11:00:00.000Z',
                dateRange: { startDate: '2026-08-26', endDate: '2026-09-22' },
                webmaster: {
                  state: 'not_connected',
                  detail: 'Bing Webmaster Tools is not connected for this workspace.',
                  data: null,
                },
              },
              findings: [],
            },
          }),
        },
      ]),
      language: 'uk',
      now: RENDERED_AT,
    });
    const text = extractPdfPages(result.bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain('Google не підключено для цього робочого простору.');
    expect(text).toContain('Bing Webmaster Tools не підключено для цього робочого простору.');
    for (const english of [
      'Google is not connected',
      'No Analytics 4 property',
      'Bing Webmaster Tools is not connected',
    ]) {
      expect(text).not.toContain(english);
    }
  });

  it('quotes a provider state this build does not know rather than guessing at it', async () => {
    const { bytes } = await render(
      [],
      [
        {
          module: 'Analytics',
          metadataJson: JSON.stringify(googleMetadata('quota_exhausted')),
        },
      ],
    );
    const text = extractPdfPages(bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain('Google is not connected for this workspace.');
  });

  it('writes the Performance findings in Ukrainian, badge and all', async () => {
    const audit = { ...performanceAudit(), findings: performanceFindings() };
    const { prisma } = fakePrisma([]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules([{ module: 'Performance', metadataJson: JSON.stringify({ audit }) }]),
      language: 'uk',
      now: RENDERED_AT,
    });
    const text = extractPdfPages(result.bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain('Час до першого байта (TTFB) — 1.9 с на мобільному');
    expect(text).toContain('Затримку реакції на дію (INP) для цього сайту виміряти не вдалося.');
    // The informational badge, which used to print the raw `INFO` severity.
    expect(text).toContain(REPORT_COPY.uk.severity.Info.toUpperCase());
    for (const english of [
      'Time to First Byte is',
      'Interaction to Next Paint could not be measured',
      'The server spends this long',
      'INFO',
    ]) {
      expect(text).not.toContain(english);
    }
  });

  it('describes the method the audit actually used, not the largest one it can', async () => {
    const audit = performanceAudit();
    const repeated = await render(
      [],
      [{ module: 'Performance', metadataJson: JSON.stringify({ audit }) }],
    );
    const device = audit.urls[0]?.devices[0];
    const single = await render(
      [],
      [
        {
          module: 'Performance',
          metadataJson: JSON.stringify({
            audit: {
              ...audit,
              urls: [
                {
                  ...audit.urls[0],
                  devices: [
                    {
                      ...device,
                      requestedSamples: 1,
                      usableSamples: 1,
                      metrics: Object.fromEntries(
                        Object.entries(device?.metrics ?? {}).map(([name, series]) => [
                          name,
                          { ...series, samples: [series.median] },
                        ]),
                      ),
                    },
                  ],
                },
              ],
            },
          }),
        },
      ],
    );
    const repeatedText = extractPdfPages(repeated.bytes).join('\n').replaceAll(/\s+/gu, ' ');
    const singleText = extractPdfPages(single.bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(repeatedText).toContain('medians of repeated Lighthouse runs');
    // One run per page and device: a keyless deployment's audit, which must not
    // open by describing medians it never took.
    expect(singleText).toContain('single Lighthouse runs');
    expect(singleText).not.toContain('medians of repeated Lighthouse runs');
  });

  it('states that the previous scan could not be compared, instead of saying nothing', async () => {
    const audit = {
      ...performanceAudit(),
      regressions: [],
      comparison: {
        previousScanId: 'scan-0',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
        incomparableReason: 'Lighthouse 11 measured the previous scan and Lighthouse 12 this one',
        incomparable: { code: 'LighthouseMajorChanged', previous: '11', current: '12' },
      },
    };
    const { prisma } = fakePrisma([]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules([{ module: 'Performance', metadataJson: JSON.stringify({ audit }) }]),
      language: 'uk',
      now: RENDERED_AT,
    });
    const text = extractPdfPages(result.bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain('попереднє сканування виміряв Lighthouse 11, а це — Lighthouse 12');
    expect(text).not.toContain('measured the previous scan');
  });

  // Reports written before the code was stored carry only the sentence. Losing
  // the fact would leave the section reading as "nothing got worse".
  it('keeps the stored sentence for a comparison written before the code existed', async () => {
    const audit = {
      ...performanceAudit(),
      regressions: [],
      comparison: {
        previousScanId: 'scan-0',
        previousObservedAt: '2026-09-01T00:00:00.000Z',
        incomparableReason:
          'the previous scan was measured by performance-audit-v0, this one by performance-audit-v1',
      },
    };
    const { bytes } = await render(
      [],
      [{ module: 'Performance', metadataJson: JSON.stringify({ audit }) }],
    );
    const text = extractPdfPages(bytes).join('\n').replaceAll(/\s+/gu, ' ');

    expect(text).toContain('performance-audit-v0');
  });

  // The browser report shows these notes; the download used to omit them, so the
  // same scan said two different things depending on which deliverable you read.
  it('carries the Bing notes the browser report shows', async () => {
    const { prisma } = fakePrisma([]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules([
        {
          module: 'Analytics',
          metadataJson: JSON.stringify(
            analyticsMetadata('https://example.com/', [
              bingFinding(),
              bingFinding({
                code: 'BING-PARTIAL-PERIOD',
                severity: 'info',
                summary: 'Bing reported 19 of the 28 days in this period.',
                evidence: { reportedDays: 19, windowDays: 28 },
              }),
            ]),
          ),
        },
      ]),
      language: 'en',
      now: new Date('2026-09-22T12:00:00.000Z'),
    });
    const text = extractPdfPages(result.bytes).join('\n');

    expect(text).toContain(REPORT_COPY.en.bingFindingsHeading);
    expect(text).toContain('Bing clicks fell 45.0% against the previous period.');
    expect(text).toContain('Bing reported 19 of the 28 days in this period.');
    expect(text).toContain('BING-TRAFFIC-DROP');
    // Informational, never a scored severity: the note must not borrow the
    // vocabulary the findings chapter uses for issues the score was cut for.
    // Badges are stamped in capitals (document.ts).
    expect(text).toContain(REPORT_COPY.en.bingSeverity.attention.toUpperCase());
    expect(text).toContain(REPORT_COPY.en.bingSeverity.info.toUpperCase());
    expect(text).not.toContain(REPORT_COPY.en.severity.High.toUpperCase());
  });

  it('writes the Bing notes in Ukrainian, not in the API’s English', async () => {
    const { prisma } = fakePrisma([]);
    const result = await renderReportPdf({
      prisma,
      scan: scanWithModules([
        {
          module: 'Analytics',
          metadataJson: JSON.stringify(
            analyticsMetadata('https://example.com/', [
              bingFinding(),
              // A code this build has no copy for: the stored English is the
              // fallback, because a note nobody can read is worse than that.
              bingFinding({
                code: 'BING-SOMETHING-LATER',
                severity: 'info',
                summary: 'A note this build has never seen.',
                evidence: {},
              }),
            ]),
          ),
        },
      ]),
      language: 'uk',
      now: new Date('2026-09-22T12:00:00.000Z'),
    });
    const text = extractPdfPages(result.bytes).join('\n');

    expect(text).toContain(REPORT_COPY.uk.bingFindingsHeading);
    expect(text).toContain('Кліки з Bing впали на 45.0% порівняно з попереднім періодом.');
    expect(text).not.toContain('Bing clicks fell');
    expect(text).toContain('A note this build has never seen.');
  });
});
