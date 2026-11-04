// "What AI says about your business": one card per AI engine, with how often it
// named the brand, how often it cited the domain, which other sites it cited
// instead, and the sentence the brand came up in.
//
// Everything here is read from what the scan stored, through the same
// fail-closed reader the API's dashboard uses (geoVisibilitySummaryFrom). Nothing
// is recomputed from the raw answers, and a missing, historical or malformed
// summary prints nothing at all: no heading over an empty chapter, and never a
// zero standing in for a figure that was not measured.
//
// It is informational only. It sits apart from page one, and it says so,
// because the overall score never counts it (GEO_SCORING_REASON).

import type { GeoProviderVisibility, GeoVisibilitySummary } from '@fluxradar/contracts';
import { GEO_MENTION_CONTEXT_MAX_CHARS } from '@fluxradar/ai';
import type { ScanModule } from '@prisma/client';

import { geoVisibilitySummaryFrom } from '../../scans/geo-report.ts';
import type { GeoVisibilityCopy, ReportCopy } from './copy.ts';
import type { ReportDocument } from './document.ts';

/** The module row the GEO scan writes, as the dashboard route looks it up. */
export const GEO_MODULE_NAME = 'AI SEO / GEO';

const CARD_RESERVE = 120;
const QUOTE_PADDING = 6;
const QUOTE_INDENT = 10;
const QUOTE_SIZE = 9;

/** One engine as the document shows it: its stored figures and, if any, its quote. */
export interface GeoEngineView {
  readonly provider: GeoProviderVisibility;
  readonly mentionContext: string | null;
}

export interface GeoVisibilityView {
  readonly minMeasuredForScore: number;
  readonly engines: readonly GeoEngineView[];
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storedRequests(metadataJson: string): readonly unknown[] {
  try {
    const metadata = recordValue(JSON.parse(metadataJson));
    const requests = recordValue(metadata?.providerVisibility)?.requests;
    return Array.isArray(requests) ? requests : [];
  } catch {
    // Deliberate: geoVisibilitySummaryFrom already refused this metadata; here it means no quote, never a crash.
    return [];
  }
}

/**
 * The stored sentence, on one line and never longer than the scan itself would
 * have stored it. It was redacted and bounded at scan time; the bound is applied
 * again because a page that trusted a stored length would be the one to overflow.
 */
export function boundedMentionContext(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  const codePoints = [...flat];
  if (codePoints.length <= GEO_MENTION_CONTEXT_MAX_CHARS) return flat;
  return `${codePoints.slice(0, GEO_MENTION_CONTEXT_MAX_CHARS - 1).join('')}…`;
}

/**
 * The first stored mention sentence per provider, in the order the questions
 * were asked. An entry that is not an answered request with a non-empty
 * sentence is skipped rather than guessed at.
 */
export function storedMentionContexts(metadataJson: string): ReadonlyMap<string, string> {
  const entries = storedRequests(metadataJson).flatMap((entry): [string, string][] => {
    const request = recordValue(entry);
    const provider = request?.provider;
    const context = request?.mentionContext;
    if (
      request?.status !== 'response' ||
      typeof provider !== 'string' ||
      typeof context !== 'string' ||
      context.trim() === ''
    ) {
      return [];
    }
    return [[provider, boundedMentionContext(context)]];
  });
  // Reversed so the earliest question's sentence is the one a Map keeps.
  return new Map([...entries].reverse());
}

/**
 * Whether an engine has anything to show. An engine that answered nothing, or
 * whose answers measured neither signal and cited no other site, has no card:
 * a card of "not measurable" lines tells the reader nothing.
 */
function hasUsableSignal(provider: GeoProviderVisibility): boolean {
  return (
    provider.questionsAnswered > 0 &&
    (provider.brandMentionedShare !== null ||
      provider.domainCitedShare !== null ||
      provider.citedInstead.length > 0)
  );
}

/** What the section shows for this scan, or null when it shows nothing. */
export function geoVisibilityView(modules: readonly ScanModule[]): GeoVisibilityView | null {
  const metadataJson = modules.find((module) => module.module === GEO_MODULE_NAME)?.metadataJson;
  const summary: GeoVisibilitySummary | null = geoVisibilitySummaryFrom(metadataJson);
  if (metadataJson === undefined || summary === null) return null;
  const contexts = storedMentionContexts(metadataJson);
  const engines = summary.providers
    .filter(hasUsableSignal)
    .map((provider) => ({ provider, mentionContext: contexts.get(provider.provider) ?? null }));
  return engines.length === 0
    ? null
    : { minMeasuredForScore: summary.minMeasuredForScore, engines };
}

function percentOf(share: number): number {
  return Math.round(share * 100);
}

function scoreText(
  provider: GeoProviderVisibility,
  min: number,
  copy: ReportCopy,
): { readonly text: string; readonly scored: boolean } {
  const text = copy.geoVisibility;
  if (provider.visibilityScore !== null) {
    const score = copy.scoreOutOf(Math.round(provider.visibilityScore));
    return { text: `${text.scoreLabel}: ${score}`, scored: true };
  }
  const reason =
    provider.scoreUnavailableReason === 'not-measurable'
      ? text.notMeasurable
      : text.notEnoughData(provider.brandMeasuredCount, provider.domainMeasuredCount, min);
  return { text: reason, scored: false };
}

function basisText(provider: GeoProviderVisibility, text: GeoVisibilityCopy): string | null {
  if (provider.scoreBasis === 'brand-only') return text.basisBrandOnly;
  if (provider.scoreBasis === 'domain-only') return text.basisDomainOnly;
  return null;
}

function signalLines(provider: GeoProviderVisibility, text: GeoVisibilityCopy): readonly string[] {
  const brand =
    provider.brandMentionedShare === null
      ? text.brandNotMeasurable
      : text.brandShare(
          provider.brandMentionedCount,
          provider.brandMeasuredCount,
          percentOf(provider.brandMentionedShare),
        );
  const domain =
    provider.domainCitedShare === null
      ? text.domainNotMeasurable
      : text.domainShare(
          provider.domainCitedCount,
          provider.domainMeasuredCount,
          percentOf(provider.domainCitedShare),
        );
  return [brand, domain];
}

function citedInstead(
  doc: ReportDocument,
  provider: GeoProviderVisibility,
  text: GeoVisibilityCopy,
) {
  doc.reserve(40);
  doc.capsLabel(text.citedInsteadHeading);
  if (provider.citedInstead.length === 0) {
    doc.paragraph(text.citedInsteadNone, { size: 9, colour: 'muted' });
    return;
  }
  doc.bullets(
    provider.citedInstead.map((entry) => text.citedInsteadEntry(entry.hostname, entry.answerCount)),
  );
}

/** The quoted sentence on a tinted band, kept whole on one page. */
function mentionQuote(doc: ReportDocument, context: string, text: GeoVisibilityCopy): void {
  const quote = `“${context}”`;
  const width = doc.contentWidth - QUOTE_INDENT * 2;
  const height = doc.heightOf(quote, { size: QUOTE_SIZE, width, lineGap: 1.5 }) + QUOTE_PADDING * 2;
  doc.reserve(height + 28);
  if (!doc.atPageTop) doc.moveTo(doc.y + 4);
  doc.capsLabel(text.mentionLabel);
  const top = doc.y;
  doc.fillRect(doc.contentLeft, top, doc.contentWidth, height, 'band', 3);
  doc.textAt(quote, doc.contentLeft + QUOTE_INDENT, top + QUOTE_PADDING, {
    size: QUOTE_SIZE,
    width,
    lineGap: 1.5,
  });
  doc.moveTo(top + height + 6);
}

function engineCard(
  doc: ReportDocument,
  engine: GeoEngineView,
  min: number,
  copy: ReportCopy,
): void {
  const text = copy.geoVisibility;
  const { provider } = engine;
  doc.reserve(CARD_RESERVE);
  doc.text(provider.label, { font: 'bold', size: 11, gapAfter: 0.2 });
  const score = scoreText(provider, min, copy);
  doc.text(score.text, {
    font: score.scored ? 'bold' : 'body',
    size: score.scored ? 10 : 9,
    colour: score.scored ? 'structure' : 'muted',
  });
  const basis = basisText(provider, text);
  if (basis !== null) doc.text(basis, { size: 8.5, colour: 'muted' });
  doc.moveTo(doc.y + 4);
  for (const line of signalLines(provider, text)) doc.text(line, { size: 9.5, gapAfter: 0.15 });
  doc.moveTo(doc.y + 4);
  citedInstead(doc, provider, text);
  if (engine.mentionContext !== null) mentionQuote(doc, engine.mentionContext, text);
  doc.moveTo(doc.y + 2);
  doc.rule();
}

/**
 * Writes the chapter from a fresh page, or nothing when the scan stored no
 * usable summary.
 */
export function geoVisibilitySection(
  doc: ReportDocument,
  modules: readonly ScanModule[],
  copy: ReportCopy,
): void {
  const view = geoVisibilityView(modules);
  if (view === null) return;
  if (!doc.atPageTop) doc.newPage();
  doc.heading(copy.geoVisibility.heading, 2);
  doc.paragraph(copy.geoVisibility.lead, { size: 9, colour: 'muted' });
  doc.moveTo(doc.y + 4);
  for (const engine of view.engines) engineCard(doc, engine, view.minMeasuredForScore, copy);
}
