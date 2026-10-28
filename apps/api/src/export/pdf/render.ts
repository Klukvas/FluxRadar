// Composes the downloadable report.
//
// The document is written in one pass, front to back, and the findings are
// streamed into it a database page at a time (report-data.ts): a scan with four
// thousand findings produces a document with four thousand findings, and never
// holds more than one page of them in memory.
//
// The ACTION PLAN is an extension point and nothing more. Its projection type
// and its slot in the document live here; what fills them is the AI features
// lane's to write. When no projection is supplied the section is omitted
// entirely rather than rendered empty.

import type { PrismaClient, Scan, ScanModule } from '@prisma/client';
import type { FindingLanguage } from '@fluxradar/rules';

import type { BingDataSnapshot } from '../../integrations/bing/types.ts';
import type { GoogleDataSnapshot } from '../../integrations/google/types.ts';
import {
  INSTABILITY_WARNING_RATIO,
  type PerformanceAudit,
} from '../../integrations/performance/index.ts';
import { bingFindingText, storedBingFindings, type StoredBingFinding } from './bing-findings.ts';
import type { ReportBrand } from '../../branding/load.ts';
import { brandPalette, brandedCopy } from './branding.ts';
import { REPORT_COPY, type ReportCopy } from './copy.ts';
import { coverPage } from './cover.ts';
import { ReportDocument } from './document.ts';
import { fillIndexPages, findingsIndex } from './findings-index.ts';
import { findingWriter, severityColour } from './findings-section.ts';
import { glossarySection } from './glossary.ts';
import { performanceFindingText, storedPerformanceFindings } from './performance-findings.ts';
import { actionPlanSection, loadPlan } from './plan-section.ts';
import { bingStateText, googleStateText } from './provider-state.ts';
import { forEachFindingPage, loadReportHeader } from './report-data.ts';
import { displayDomain } from './report-format.ts';
import { writeFirstStep } from './summary-tiles.ts';

/**
 * The action plan, rendered if — and only if — a ready one is supplied.
 *
 * THIS IS A SLOT, NOT A FEATURE. The AI features lane owns the model, the prompt
 * and the service that produces a plan; this file owns nothing but the shape it
 * renders and the rules that shape has to obey. Nothing in this package fills it,
 * and when no loader is wired the section is absent rather than empty.
 *
 * Four rules the slot enforces, and the reasons they are rules:
 *
 *   1. NO RAW PROMPT, EVER. The projection has no field for prompt text, and the
 *      renderer has nothing to put one in. A prompt is our own instruction set;
 *      shipping it inside a customer deliverable gives away the product and can
 *      carry whatever the model was told about other customers' sites.
 *   2. ONE LANGUAGE, THE READER'S. A plan is stored per language
 *      (unique(scanId, language)); the loader is asked for the language the
 *      document is being written in and must not fall back to another one, or a
 *      Ukrainian report grows an English chapter.
 *   3. TENANT AND SCAN AUTHORIZED. The loader is handed the account the request
 *      was authenticated as, not just the scan id, so the plan it returns can be
 *      scoped to that account. This route has already checked ownership; the
 *      loader checking again is what keeps a mis-wired caller from leaking one.
 *   4. READY ONLY. A plan still being generated, or one whose generation failed,
 *      is not a plan: the loader returns null and the document simply has no
 *      action-plan section.
 */
export interface ActionPlanAction {
  readonly title: string;
  /** Why this matters, in the plan's own words. */
  readonly why: string;
  readonly steps: readonly string[];
  readonly effort: 'small' | 'medium' | 'large';
  /** The rule identifiers this action addresses, as the plan stated them. */
  readonly ruleIds: readonly string[];
  /** Findings of those rules still open at render time. */
  readonly openIssues: number;
  readonly totalIssues: number;
  /** True when every finding this action addresses is closed. */
  readonly settled: boolean;
}

/** How much of the report's open work the plan actually covers. */
export interface ActionPlanReach {
  /** Addressed open findings as a share of all open findings, 0..1. */
  readonly share: number;
  readonly addressedOpenIssues: number;
  readonly totalOpenIssues: number;
  readonly rules: number;
}

/** What produced the plan. Identifiers and versions only — never a prompt. */
export interface ActionPlanMetadata {
  readonly modelId: string | null;
  readonly promptVersion: string | null;
  readonly noticeVersion: string | null;
  readonly generatedAt: string | null;
}

export interface ActionPlanProjection {
  readonly overview: string;
  /**
   * What the scan could not see when the plan was written — an unavailable
   * module, a section that ran Partial. A plan drawn from an incomplete report
   * is still useful; one that does not say it was is not, and the web report
   * already says so. Empty is the ordinary case.
   */
  readonly caveats: readonly string[];
  readonly actions: readonly ActionPlanAction[];
  readonly reach: ActionPlanReach;
  readonly metadata: ActionPlanMetadata;
}

export interface ActionPlanRequest {
  readonly scanId: string;
  /** The account the PDF request was authenticated as. */
  readonly accountId: string;
  /** The language the document is being written in. */
  readonly language: FindingLanguage;
}

/** Returns the ready plan for that scan, account and language, or null. */
export type ActionPlanLoader = (request: ActionPlanRequest) => Promise<ActionPlanProjection | null>;

export interface RenderReportOptions {
  readonly brand?: ReportBrand | null;
  readonly prisma: PrismaClient;
  readonly scan: Scan & { readonly modules: ScanModule[] };
  readonly language: FindingLanguage;
  readonly now: Date;
  /** Optional; when absent the action-plan section is omitted. */
  readonly loadActionPlan?: ActionPlanLoader;
}

function parseMetadata(module: ScanModule | undefined): Readonly<Record<string, unknown>> | null {
  if (module === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(module.metadataJson);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The stored audit, or null for a Performance row written before it existed.
 * Checked rather than asserted: a report from an older release must render
 * without its Performance detail instead of throwing halfway through the file.
 */
function storedPerformanceAudit(
  metadata: Readonly<Record<string, unknown>> | null,
): PerformanceAudit | null {
  const audit = metadata?.audit;
  if (typeof audit !== 'object' || audit === null) return null;
  const candidate = audit as PerformanceAudit;
  return Array.isArray(candidate.urls) && candidate.field !== undefined ? candidate : null;
}

/**
 * Whether the audit measured each page and device more than once.
 *
 * A deployment with no PageSpeed API key takes one run per page and device, so
 * the section's lead has to state which of the two it is describing. An audit
 * that says neither is read as the smaller claim: understating the work done is a
 * missed detail, while overstating it is a false statement about the method.
 */
function measuredRepeatedly(audit: PerformanceAudit): boolean {
  return audit.urls.some((entry) =>
    entry.devices.some(
      (device) =>
        (typeof device.requestedSamples === 'number' && device.requestedSamples > 1) ||
        Object.values(device.metrics ?? {}).some((series) => (series?.samples?.length ?? 0) > 1),
    ),
  );
}

/** Why the previous scan was not compared, in the reader's language. */
function incomparableClause(audit: PerformanceAudit, copy: ReportCopy): string | null {
  const comparison = audit.comparison;
  if (comparison == null) return null;
  const detail = comparison.incomparable;
  const stated =
    detail == null ? undefined : copy.incomparable[detail.code]?.(detail.previous, detail.current);
  // A report written before the code existed, or one carrying a code this build
  // does not know, keeps the sentence the audit stored rather than losing the fact.
  return stated ?? comparison.incomparableReason ?? null;
}

function performanceSection(
  doc: ReportDocument,
  modules: readonly ScanModule[],
  copy: ReportCopy,
  language: FindingLanguage,
): void {
  const metadata = parseMetadata(modules.find((module) => module.module === 'Performance'));
  const audit = storedPerformanceAudit(metadata);
  if (audit === null) return;

  doc.heading(copy.performanceHeading, 2);
  doc.paragraph(measuredRepeatedly(audit) ? copy.performanceLead : copy.performanceLeadSingleRun, {
    colour: 'muted',
    size: 9,
  });
  const rows = audit.urls.flatMap((entry) =>
    entry.devices.map((device) => [
      entry.url,
      deviceName(device.strategy, copy),
      device.metrics.performanceScore.median === null
        ? copy.noData
        : String(Math.round(device.metrics.performanceScore.median)),
      formatMs(device.metrics.lcpMs.median, copy),
      formatMs(device.metrics.ttfbMs.median, copy),
      formatMs(device.metrics.tbtMs.median, copy),
      String(device.usableSamples),
    ]),
  );
  doc.table(
    [
      { heading: copy.url, width: 0.34 },
      { heading: copy.device, width: 0.11 },
      { heading: copy.score, width: 0.09, align: 'right' },
      // The four metric acronyms are the same token in both languages, and are
      // what the provider's own report calls them.
      { heading: 'LCP', width: 0.12, align: 'right' },
      { heading: 'TTFB', width: 0.12, align: 'right' },
      { heading: 'TBT', width: 0.12, align: 'right' },
      { heading: copy.runs, width: 0.1, align: 'right' },
    ],
    rows,
  );
  if (audit.field.metrics === null) {
    doc.paragraph(copy.performanceNoField, { colour: 'muted', size: 9 });
  } else {
    const field = audit.field.metrics;
    doc.keyValue(
      copy.fieldDataLabel,
      `LCP ${formatMs(field.lcpP75Ms, copy)} · INP ${formatMs(field.inpP75Ms, copy)} · CLS ${
        field.clsP75 === null ? copy.noData : field.clsP75.toFixed(3)
      } · TTFB ${formatMs(field.ttfbP75Ms, copy)}`,
      { mono: true },
    );
  }
  const unstable = audit.urls.flatMap((entry) =>
    entry.devices.flatMap((device) =>
      (device.metrics.lcpMs.instability ?? 0) >= INSTABILITY_WARNING_RATIO
        ? [`${entry.url} · ${deviceName(device.strategy, copy)}: ${copy.performanceInstability}`]
        : [],
    ),
  );
  if (unstable.length > 0) doc.bullets(unstable, { colour: 'muted' });
  if (audit.regressions.length > 0) {
    doc.heading(copy.performanceRegressions, 3);
    doc.bullets(
      audit.regressions.map((regression) =>
        copy.performanceRegression(
          regression.metric,
          deviceName(regression.strategy, copy),
          regression.url,
          String(regression.previous),
          String(regression.current),
        ),
      ),
    );
  } else {
    const clause = incomparableClause(audit, copy);
    // Silence here would read as "nothing got worse". It was not measured.
    if (clause !== null) {
      doc.paragraph(copy.performanceComparisonNone(clause), { colour: 'muted', size: 9 });
    }
  }
  // The findings the audit concluded, rebuilt in the reader's language from their
  // rule id and evidence: the stored sentences are English, and this is the only
  // deliverable that shows them at all (the browser report does not).
  for (const finding of storedPerformanceFindings(audit.findings)) {
    const text = performanceFindingText(finding, language);
    doc.reserve(70);
    const severity = capitalised(finding.severity);
    doc.badge(
      copy.severity[severity as keyof ReportCopy['severity']] ?? finding.severity,
      severityColour(severity),
    );
    doc.text(text.summary, { font: 'bold', size: 10 });
    doc.text(text.recommendation, { size: 9 });
    doc.text(
      `${finding.ruleId} · ${finding.url}${
        finding.strategy === null ? '' : ` · ${deviceName(finding.strategy, copy)}`
      }`,
      { font: 'mono', size: 8, colour: 'muted', gapAfter: 0.5 },
    );
  }
}

function capitalised(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The emulated device, in the reader's language rather than the API's token. */
function deviceName(strategy: string, copy: ReportCopy): string {
  return copy.deviceName[strategy as keyof ReportCopy['deviceName']] ?? strategy;
}

/** A duration in the reader's units, or an em dash for a metric nobody measured. */
function formatMs(value: number | null, copy: ReportCopy): string {
  return value === null ? '—' : copy.duration(value);
}

function searchDataSection(
  doc: ReportDocument,
  modules: readonly ScanModule[],
  copy: ReportCopy,
  language: FindingLanguage,
  domain: string,
  voice: 'fluxradar' | 'neutral' = 'fluxradar',
): void {
  const metadata = parseMetadata(modules.find((module) => module.module === 'Analytics'));
  if (metadata === null) return;
  const google = metadata as unknown as GoogleDataSnapshot;
  const section = metadata.bing as { snapshot?: BingDataSnapshot; findings?: unknown } | undefined;
  const bing = section?.snapshot;
  if (google.source !== 'google' && bing === undefined) return;

  doc.heading(copy.searchDataHeading, 2);
  if (google.source === 'google') {
    doc.heading(copy.googleHeading, 3);
    const totals = google.searchConsole.data?.totals;
    // Where a service produced no figures, the reason is written from its state
    // rather than taken from the snapshot: the stored sentence is English, and it
    // used to appear one line below the same fact stated in Ukrainian.
    doc.keyValue(
      copy.searchConsoleLabel,
      totals === undefined
        ? googleStateText(google.searchConsole, language, voice)
        : copy.searchConsoleTotals(
            totals.clicks,
            totals.impressions,
            `${(totals.ctr * 100).toFixed(1)}%`,
          ),
    );
    const analytics = google.analytics.data;
    doc.keyValue(
      copy.analyticsLabel,
      analytics === null || analytics === undefined
        ? googleStateText(google.analytics, language, voice)
        : copy.analyticsTotals(analytics.users, analytics.sessions, analytics.pageViews),
    );
  }
  if (bing !== undefined) {
    doc.heading(copy.bingHeading, 3);
    const summary = bing.webmaster.data;
    const totals = summary?.totals ?? null;
    doc.keyValue(
      summary === null ? copy.noData : summary.siteUrl,
      // Three distinct answers, never collapsed into one: the section was not
      // available — said from its state, in the reader's language — the traffic
      // read did not answer, or here are the numbers.
      summary === null
        ? bingStateText(bing.webmaster, language, voice)
        : totals === null
          ? copy.bingTrafficUnavailable
          : copy.bingTotals(totals.clicks, totals.impressions, totals.days),
    );
    // The bound property may legitimately be a subdomain or another host the
    // owner verified with Bing. It is still a different site from the one this
    // report is about, and the reader is told so rather than left to compare the
    // two strings themselves.
    const mismatch = summary === null ? null : propertyMismatch(summary.siteUrl, domain);
    if (mismatch !== null) {
      doc.paragraph(copy.bingSiteMismatch(mismatch.property, mismatch.domain), {
        colour: 'muted',
        size: 9,
      });
    }
    if (summary !== null && summary.topQueries !== null && summary.topQueries.length > 0) {
      doc.table(
        [
          { heading: copy.query, width: 0.5 },
          { heading: copy.clicks, width: 0.17, align: 'right' },
          { heading: copy.impressions, width: 0.18, align: 'right' },
          // The rate's acronym, which both languages use.
          { heading: 'CTR', width: 0.15, align: 'right' },
        ],
        summary.topQueries.map((row) => [
          row.query,
          String(row.clicks),
          String(row.impressions),
          `${(row.ctr * 100).toFixed(1)}%`,
        ]),
      );
    }
    bingFindingsBlock(doc, storedBingFindings(section?.findings), copy, language);
  }
}

/**
 * The Bing notes, which the browser report also shows. They are never a severity
 * colour and never a score: Bing coverage is informational in this release, and
 * a note styled as an issue reads as something the score was cut for.
 */
function bingFindingsBlock(
  doc: ReportDocument,
  findings: readonly StoredBingFinding[],
  copy: ReportCopy,
  language: FindingLanguage,
): void {
  if (findings.length === 0) return;
  doc.heading(copy.bingFindingsHeading, 3);
  doc.paragraph(copy.bingFindingsNote, { colour: 'muted', size: 9 });
  for (const finding of findings) {
    const text = bingFindingText(finding, language);
    doc.reserve(60);
    doc.badge(copy.bingSeverity[finding.severity], 'muted');
    doc.text(text.summary, { font: 'bold', size: 10 });
    doc.text(text.recommendation, { size: 9 });
    doc.text(finding.code, { font: 'mono', size: 8, colour: 'muted', gapAfter: 0.5 });
  }
}

/**
 * The two hosts, when the search property is not the site this report is about.
 *
 * Bing states a property as a URL (`https://shop.example.com/`) or as a bare
 * host, so both are reduced to a host before they are compared. Equal hosts —
 * and anything unparseable, where a guess would be worse than silence — produce
 * no notice.
 */
function propertyMismatch(
  siteUrl: string,
  domain: string,
): { readonly property: string; readonly domain: string } | null {
  const property = displayDomain(siteUrl).toLowerCase();
  const reportDomain = displayDomain(domain).toLowerCase();
  if (property === '' || reportDomain === '' || property === reportDomain) return null;
  return { property, domain: reportDomain };
}

/**
 * The complete report as PDF bytes. Returns the byte count alongside so the
 * caller can record what it stored without re-measuring the buffer.
 */
export async function renderReportPdf(
  options: RenderReportOptions,
): Promise<{ readonly bytes: Buffer; readonly findingCount: number }> {
  const copy = options.brand ? brandedCopy(options.language) : REPORT_COPY[options.language];
  const header = await loadReportHeader(options.prisma, options.scan);
  const title = copy.documentTitle(displayDomain(options.scan.domain));
  const doc = new ReportDocument(
    title,
    undefined,
    options.brand ? { palette: brandPalette(options.brand), info: { Title: title } } : {},
  );
  // Read first: page one says whether a plan follows, and names its first step.
  const plan = await loadPlan(options);
  const firstStep = coverPage({
    doc,
    header,
    copy,
    language: options.language,
    now: options.now,
    brand: options.brand ?? null,
    plan,
  });
  if (plan !== null) {
    const planPage = actionPlanSection(doc, plan, copy);
    if (firstStep !== null) writeFirstStep(doc, copy, firstStep, planPage);
  }
  const indexSlots = findingsIndex(doc, header, copy, options.language);
  performanceSection(doc, header.modules, copy, options.language);
  searchDataSection(
    doc,
    header.modules,
    copy,
    options.language,
    options.scan.domain,
    options.brand ? 'neutral' : 'fluxradar',
  );
  // The writer opens the chapter at its first finding, when it knows how much
  // room that finding's card needs; with none, it is opened after the loop.
  const writer = findingWriter(doc, header, copy, options.language);
  const written = await forEachFindingPage(
    options.prisma,
    options.scan.id,
    options.language,
    (page) => {
      for (const finding of page) writer.write(finding);
    },
  );
  writer.ensureChapter();
  fillIndexPages(doc, copy, indexSlots, writer.firstPages);
  // Only a report with findings uses the terms it explains.
  if (header.totalFindings > 0) glossarySection(doc, copy);
  // Last, because only now is it known whether it is needed: the document states
  // the escape convention, in its own language, exactly when it had to use one.
  if (doc.escapedCharacterCount > 0) {
    doc.heading(copy.unsupportedGlyphsHeading, 2);
    doc.paragraph(copy.unsupportedGlyphs(doc.escapedCharacterCount), { colour: 'muted', size: 9 });
  }
  const runningHeader = {
    left: copy.preparedFor(displayDomain(options.scan.domain)),
    right: options.brand ? options.brand.displayName : 'FluxRadar',
  };
  return { bytes: await doc.finish(copy.footer, runningHeader), findingCount: written };
}
