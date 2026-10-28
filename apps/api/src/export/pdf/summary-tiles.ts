// The summary: three tiles (how many problems are open, how bad they are, the
// overall score) and one sentence that says what to do first.

import type { FindingLanguage } from '@fluxradar/rules';

import type { ReportCopy } from './copy.ts';
import type { CoverContext } from './cover.ts';
import { SCORED_SEVERITIES, SEVERITY_COLOUR, type ScoredSeverity } from './document-graphics.ts';
import type { ReportDocument } from './document.ts';
import { moduleLabel } from './names.ts';
import { clampScore, reportOverallScore, type ReportOverallScore } from './report-format.ts';
import type { ActionPlanProjection } from './render.ts';
import type { PdfReportHeader, ReportSeverityCounts } from './report-data.ts';

const TILE_GAP = 12;
const TILE_MIN_HEIGHT = 76;
/** Open | severity | score; without open findings the severity tile is left out. */
const TILE_SHARES = [0.2, 0.5, 0.3] as const;
const TILE_SHARES_NO_OPEN = [0.4, 0.6] as const;
const TILE_PADDING = 12;
const SEVERITY_BAR_HEIGHT = 10;
const RING_RADIUS = 24;
/** The narrowest a non-empty severity segment is drawn, so a single finding shows. */
const MIN_SEGMENT = 3;
/** The coloured square and its gap before a legend entry's word. */
const LEGEND_MARK_WIDTH = 10;

interface Tile {
  readonly x: number;
  readonly width: number;
}

/** Where the first-step line sits on page one, to be written once the plan is placed. */
export interface FirstStepSlot {
  readonly page: number;
  readonly y: number;
  readonly title: string;
}

const FIRST_STEP_STYLE = { size: 9.5, lineGap: 3 } as const;

function layoutTiles(doc: ReportDocument, shares: readonly number[]): readonly Tile[] {
  const inner = doc.contentWidth - TILE_GAP * (shares.length - 1);
  const widths = shares.map((share) => inner * share);
  return widths.map((width, index) => ({
    x: doc.contentLeft + widths.slice(0, index).reduce((sum, w) => sum + w + TILE_GAP, 0),
    width,
  }));
}

/**
 * The summary tiles, the verdict, the severity key and, when a plan prints,
 * the space for its first step. Page one counts open findings only, so every
 * number on it describes the same population.
 */
export function summarySection(context: CoverContext): FirstStepSlot | null {
  const { doc, copy, header } = context;
  doc.heading(copy.summaryHeading, 2);
  const overall = reportOverallScore(header.scan.plan, header.modules);
  const hasOpen = severityTotal(header.openBySeverity) > 0;
  const tiles = layoutTiles(doc, hasOpen ? TILE_SHARES : TILE_SHARES_NO_OPEN);
  const openTile = tiles[0] as Tile;
  const scoreTile = tiles[tiles.length - 1] as Tile;
  const top = doc.y;
  const height = Math.max(
    TILE_MIN_HEIGHT,
    openTileHeight(doc, copy, header, openTile),
    scoreTileHeight(doc, copy, overall, scoreTile),
  );
  for (const tile of tiles) doc.fillRect(tile.x, top, tile.width, height, 'band', 4);
  drawOpenTile(doc, copy, header, openTile, top);
  if (hasOpen) drawSeverityTile(doc, copy, header.openBySeverity, tiles[1] as Tile, top);
  drawScoreTile(doc, copy, overall, scoreTile, top, height);
  doc.moveTo(top + height + 12);
  doc.text(verdictText(header, copy, context.language), { font: 'bold', size: 10, lineGap: 3 });
  const slot = firstStepSlot(doc, copy, context.plan);
  if (hasOpen) {
    doc.moveTo(doc.y + 3);
    doc.text(copy.severityMeaning, { size: 8, colour: 'muted', lineGap: 3 });
  }
  return slot;
}

/**
 * Keeps one line for "First step: … (plan, p. N)". The plan's page is known
 * only after the sections table has found its length, so the line is written
 * later (`writeFirstStep`), into the space measured here.
 */
function firstStepSlot(
  doc: ReportDocument,
  copy: ReportCopy,
  plan: ActionPlanProjection | null,
): FirstStepSlot | null {
  const title = plan?.actions[0]?.title;
  if (title === undefined) return null;
  doc.moveTo(doc.y + 2);
  const slot = { page: doc.pageNumber, y: doc.y, title };
  const height = doc.heightOf(copy.firstStep(title, doc.pageNumber + 1), FIRST_STEP_STYLE);
  doc.moveTo(doc.y + height);
  return slot;
}

export function writeFirstStep(
  doc: ReportDocument,
  copy: ReportCopy,
  slot: FirstStepSlot,
  planPage: number,
): void {
  doc.onPage(slot.page, () => {
    doc.textAt(copy.firstStep(slot.title, planPage), doc.contentLeft, slot.y, FIRST_STEP_STYLE);
  });
}

function severityTotal(counts: ReportSeverityCounts): number {
  return SCORED_SEVERITIES.reduce((sum, severity) => sum + counts[severity], 0);
}

/**
 * Open findings as page one counts them: the four scored severities only, the
 * same set the verdict and the severity bar are drawn from. A finding with a
 * severity outside them is still listed in the findings chapter.
 */
function openCount(header: PdfReportHeader): number {
  return severityTotal(header.openBySeverity);
}

/**
 * What to do first: the worst severity among the open findings, then, while
 * anything is open, the weakest scored section. Every number comes from the
 * open findings' severity counts.
 */
function verdictText(header: PdfReportHeader, copy: ReportCopy, language: FindingLanguage): string {
  const counts = header.openBySeverity;
  if (severityTotal(counts) === 0) return copy.verdict.clear;
  const lead =
    counts.Critical > 0
      ? copy.verdict.critical(counts.Critical)
      : counts.High > 0
        ? copy.verdict.high(counts.High)
        : copy.verdict.minor;
  const weakest = header.modules
    .flatMap((module) => {
      const score = clampScore(module.score);
      return score === null ? [] : [{ label: moduleLabel(module.module, language), score }];
    })
    .sort((left, right) => left.score - right.score || left.label.localeCompare(right.label))[0];
  return weakest === undefined
    ? lead
    : `${lead} ${copy.verdict.weakest(weakest.label, weakest.score)}`;
}

function openCaption(copy: ReportCopy, header: PdfReportHeader): string {
  const open = openCount(header);
  return open === 0 ? copy.summaryNone : copy.openCaption(open, header.openRuleCount);
}

function openTileHeight(
  doc: ReportDocument,
  copy: ReportCopy,
  header: PdfReportHeader,
  tile: Tile,
): number {
  const width = tile.width - 2 * TILE_PADDING;
  return 52 + doc.heightOf(openCaption(copy, header), { size: 8, width }) + 10;
}

function drawOpenTile(
  doc: ReportDocument,
  copy: ReportCopy,
  header: PdfReportHeader,
  tile: Tile,
  top: number,
): void {
  const x = tile.x + TILE_PADDING;
  const width = tile.width - 2 * TILE_PADDING;
  doc.capsLabelAt(copy.openLabel, x, top + 10, width);
  doc.textAt(String(openCount(header)), x, top + 20, { font: 'bold', size: 26, width });
  doc.textAt(openCaption(copy, header), x, top + 52, { size: 8, colour: 'muted', width });
}

function drawSeverityTile(
  doc: ReportDocument,
  copy: ReportCopy,
  counts: ReportSeverityCounts,
  tile: Tile,
  top: number,
): void {
  const x = tile.x + TILE_PADDING;
  const width = tile.width - 2 * TILE_PADDING;
  doc.capsLabelAt(copy.bySeverityLabel, x, top + 10, width);
  const barTop = top + 24;
  const total = severityTotal(counts);
  if (total === 0) {
    doc.fillRect(x, barTop, width, SEVERITY_BAR_HEIGHT, 'rule');
    return;
  }
  const present = SCORED_SEVERITIES.filter((severity) => counts[severity] > 0);
  const segments = segmentWidths(
    present.map((severity) => counts[severity]),
    width - (present.length - 1),
  );
  segments.reduce((left, segment, index) => {
    const severity = present[index] as ScoredSeverity;
    doc.fillRect(left, barTop, segment, SEVERITY_BAR_HEIGHT, SEVERITY_COLOUR[severity]);
    return left + segment + 1;
  }, x);
  severityLegend(doc, copy, counts, { x, width }, barTop + SEVERITY_BAR_HEIGHT + 9);
}

/**
 * Proportional widths that add up to `width`, every one at least MIN_SEGMENT
 * wide; what the narrow ones gain is taken from the widest.
 */
export function segmentWidths(counts: readonly number[], width: number): readonly number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const raw = counts.map((count) => (total === 0 ? 0 : (width * count) / total));
  const widened = raw.map((value) => Math.max(MIN_SEGMENT, value));
  const excess = widened.reduce((sum, value) => sum + value, 0) - width;
  const widest = widened.indexOf(Math.max(...widened));
  return widened.map((value, index) => (index === widest ? value - excess : value));
}

/**
 * Pips, the severity in title case and its count, laid out by measured width:
 * an entry that would not fit on the line starts the next one whole.
 */
function severityLegend(
  doc: ReportDocument,
  copy: ReportCopy,
  counts: ReportSeverityCounts,
  area: Tile,
  top: number,
): void {
  const right = area.x + area.width;
  SCORED_SEVERITIES.reduce(
    (cursor, severity) => {
      const label = `${copy.severity[severity]} ${counts[severity]}`;
      const entry = LEGEND_MARK_WIDTH + doc.widthOf(label, 'body', 7.5);
      const wraps = cursor.x > area.x && cursor.x + entry > right;
      const x = wraps ? area.x : cursor.x;
      const y = wraps ? cursor.y + 12 : cursor.y;
      doc.fillRect(x, y + 1.5, 6, 6, SEVERITY_COLOUR[severity], 1);
      doc.textAt(label, x + LEGEND_MARK_WIDTH, y, { size: 7.5, width: entry });
      return { x: x + entry + 10, y };
    },
    { x: area.x, y: top },
  );
}

const SCORE_TEXT_OFFSET = 70;

function scoreTextWidth(tile: Tile): number {
  return tile.width - SCORE_TEXT_OFFSET - 6;
}

function scoreTileHeight(
  doc: ReportDocument,
  copy: ReportCopy,
  overall: ReportOverallScore,
  tile: Tile,
): number {
  const width = scoreTextWidth(tile);
  const label = doc.heightOf(copy.overallScoreLabel.toUpperCase(), {
    font: 'bold',
    size: 7,
    characterSpacing: 0.6,
    width,
  });
  const body =
    overall.score === null
      ? doc.heightOf(copy.overallInsufficient, { size: 8, width })
      : 16 + (overall.verdict === 'provisional' ? 11 : 0);
  return 16 + label + 4 + body + 14;
}

/**
 * The overall score: a ring and "64 of 100"; a provisional score says so under
 * the number; with too little data, only the ring's track and a sentence.
 */
function drawScoreTile(
  doc: ReportDocument,
  copy: ReportCopy,
  overall: ReportOverallScore,
  tile: Tile,
  top: number,
  height: number,
): void {
  const centreX = tile.x + 36;
  const centreY = top + height / 2;
  doc.ring(centreX, centreY, RING_RADIUS, overall.score === null ? null : overall.score / 100);
  const x = tile.x + SCORE_TEXT_OFFSET;
  const width = scoreTextWidth(tile);
  const valueY = doc.capsLabelAt(copy.overallScoreLabel, x, top + 16, width) + 4;
  if (overall.score === null) {
    doc.textAt(copy.overallInsufficient, x, valueY, { size: 8, colour: 'muted', width });
    return;
  }
  doc.textAt(String(overall.score), centreX - RING_RADIUS, centreY - 10, {
    font: 'bold',
    size: 18,
    width: RING_RADIUS * 2,
    align: 'center',
  });
  const scoreBottom = doc.textAt(copy.scoreOutOf(overall.score), x, valueY, {
    font: 'bold',
    size: 12,
    width,
  });
  if (overall.verdict === 'provisional') {
    doc.textAt(copy.overallProvisional, x, scoreBottom + 1, { size: 7.5, colour: 'muted', width });
  }
}
