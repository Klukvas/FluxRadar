// The sections table on page one: each audit area with a score bar, the score,
// the share of its checks that ran, and its result. Weakest first, so the eye
// lands on what needs work; sections without a score go last.

import type { ScanModule } from '@prisma/client';
import type { FindingLanguage } from '@fluxradar/rules';

import type { CoverContext } from './cover.ts';
import type { ReportDocument } from './document.ts';
import { moduleLabel } from './names.ts';
import { clampScore, percent } from './report-format.ts';
import { moduleResultText } from './status-text.ts';

/** Column shares: name | bar | score | checks done | result. */
const COLUMN_SHARES = [0.24, 0.28, 0.1, 0.11, 0.27] as const;
const MIN_ROW_HEIGHT = 20;
const ROW_PADDING = 8;
const BAR_HEIGHT = 7;
/** The legend's band edges, marked on every track: 0–49 | 50–74 | 75–100. */
const BAND_TICKS = [50, 75] as const;
const TICK_OVERHANG = 2;

interface SectionRow {
  readonly label: string;
  readonly score: number | null;
  readonly coverage: string;
  readonly result: string;
}

interface Columns {
  readonly x: readonly number[];
  readonly width: readonly number[];
}

export function sectionsSection(context: CoverContext): void {
  const { doc, copy, header, language, brand } = context;
  doc.heading(copy.sectionsHeading, 2);
  doc.text(copy.sectionsLead(header.modules.length), { size: 9, colour: 'muted' });
  doc.moveTo(doc.y + 8);
  const rows = sectionRows(header.modules, language, brand ? 'neutral' : 'fluxradar');
  const columns = layoutColumns(doc);
  const headings = [copy.section, '', copy.score, copy.coverage, copy.result];
  doc.reserve(60);
  tableHeading(doc, columns, headings);
  rows.forEach((row, index) => {
    const height = rowHeight(doc, columns, row, copy.noScore);
    if (doc.y + height > doc.pageBottom) {
      doc.newPage();
      tableHeading(doc, columns, headings);
    }
    drawRow(doc, columns, row, { height, zebra: index % 2 === 0, noScore: copy.noScore });
  });
  doc.moveTo(doc.y + 8);
  const withTicks = `${copy.scoreLegend} ${copy.scoreTicks}`;
  const fits = doc.widthOf(withTicks, 'body', 8) <= doc.contentWidth;
  doc.text(fits ? withTicks : copy.scoreLegend, { size: 8, colour: 'muted', lineGap: 2 });
  doc.text(copy.coverageLegend, { size: 8, colour: 'muted', lineGap: 2 });
}

/** Lowest score first; unscored sections last, by the name the reader sees. */
function sectionRows(
  modules: readonly ScanModule[],
  language: FindingLanguage,
  voice: 'fluxradar' | 'neutral',
): readonly SectionRow[] {
  return modules
    .map((module) => ({
      label: moduleLabel(module.module, language),
      score: clampScore(module.score),
      coverage: percent(module.coverage),
      result: moduleResultText(module, language, voice),
    }))
    .sort(
      (left, right) =>
        (left.score ?? Number.POSITIVE_INFINITY) - (right.score ?? Number.POSITIVE_INFINITY) ||
        left.label.localeCompare(right.label, language),
    );
}

function layoutColumns(doc: ReportDocument): Columns {
  const width = COLUMN_SHARES.map((share) => share * doc.contentWidth);
  const x = width.map(
    (_, index) => doc.contentLeft + width.slice(0, index).reduce((sum, value) => sum + value, 0),
  );
  return { x, width };
}

function column(columns: Columns, index: number): { x: number; width: number } {
  return { x: columns.x[index] ?? 0, width: columns.width[index] ?? 0 };
}

function tableHeading(doc: ReportDocument, columns: Columns, headings: readonly string[]): void {
  const top = doc.y;
  headings.forEach((heading, index) => {
    if (heading === '') return;
    const { x, width } = column(columns, index);
    const numeric = index === 2 || index === 3;
    doc.textAt(heading, numeric ? x : x + 6, top, {
      font: 'bold',
      size: 8,
      colour: 'muted',
      width: width - 6,
      align: numeric ? 'right' : 'left',
    });
  });
  const ruleY = top + 22;
  doc.line([doc.contentLeft, ruleY], [doc.contentLeft + doc.contentWidth, ruleY], 'rule', 0.75);
  doc.moveTo(ruleY + 2);
}

function rowHeight(doc: ReportDocument, columns: Columns, row: SectionRow, noScore: string) {
  const heights = [
    doc.heightOf(row.label, { size: 9, width: column(columns, 0).width - 10 }),
    row.score === null
      ? doc.heightOf(noScore, { size: 8, width: column(columns, 1).width - 16 })
      : 0,
    doc.heightOf(row.result, { size: 8, width: column(columns, 4).width - 12 }),
  ];
  return Math.max(MIN_ROW_HEIGHT, Math.max(...heights) + ROW_PADDING);
}

function drawRow(
  doc: ReportDocument,
  columns: Columns,
  row: SectionRow,
  style: { readonly height: number; readonly zebra: boolean; readonly noScore: string },
): void {
  const top = doc.y;
  if (style.zebra) doc.fillRect(doc.contentLeft, top, doc.contentWidth, style.height, 'band');
  const textY = top + 5;
  const name = column(columns, 0);
  doc.textAt(row.label, name.x + 6, textY, { size: 9, width: name.width - 10 });
  const bar = column(columns, 1);
  if (row.score === null) {
    doc.textAt(style.noScore, bar.x, textY + 1, {
      size: 8,
      colour: 'muted',
      width: bar.width - 16,
    });
  } else {
    const barY = top + Math.min(style.height, 24) / 2 - BAR_HEIGHT / 2;
    const trackWidth = bar.width - 16;
    doc.fillRect(bar.x, barY, trackWidth, BAR_HEIGHT, 'rule', 2);
    bandTicks(doc, bar.x, barY, trackWidth);
    const filled = Math.max(BAR_HEIGHT, (trackWidth * row.score) / 100);
    doc.fillRect(bar.x, barY, filled, BAR_HEIGHT, 'structure', 2);
  }
  const score = column(columns, 2);
  doc.textAt(row.score === null ? '—' : String(row.score), score.x, textY, {
    font: row.score === null ? 'body' : 'bold',
    size: 9,
    colour: row.score === null ? 'muted' : 'text',
    width: score.width - 6,
    align: 'right',
  });
  const coverage = column(columns, 3);
  doc.textAt(row.coverage, coverage.x, textY, {
    size: 9,
    colour: 'muted',
    width: coverage.width - 6,
    align: 'right',
  });
  const result = column(columns, 4);
  doc.textAt(row.result, result.x + 8, textY + 1, {
    size: 8,
    colour: 'muted',
    width: result.width - 12,
  });
  doc.moveTo(top + style.height);
}

/**
 * Thin muted ticks at the legend's band edges, standing a little above and
 * below the track. Drawn under the fill, so a filled bar keeps its colour and
 * the ticks show only as notches at its edges: no band is ever coloured.
 */
function bandTicks(doc: ReportDocument, x: number, y: number, width: number): void {
  for (const tick of BAND_TICKS) {
    const tickX = x + (width * tick) / 100;
    doc.line([tickX, y - TICK_OVERHANG], [tickX, y + BAR_HEIGHT + TICK_OVERHANG], 'muted', 0.75);
  }
}
