// A small layout vocabulary over PDFKit: headings, paragraphs, key/value rows,
// tables and callouts, all of which know how to break across pages.
//
// It exists so the report renderer (render.ts) reads as a document rather than
// as a sequence of coordinates, and so the three rules the report must not break
// are enforced in one place:
//
//   * nothing is ever truncated. Long evidence wraps and flows onto the next
//     page; it is never cut, shortened or summarised. The only bound on the
//     document's size is the route's refusal above `PDF_FINDING_LIMIT`, which
//     renders nothing at all rather than something that looks complete.
//   * nothing is ever dropped. A character the chosen face cannot draw is
//     escaped so it can be read back (glyphs.ts), not laid out as `.notdef`.
//   * no remote resource is ever referenced. There are no images, no links to
//     fetch and no fonts to download — see fonts.ts.

import PDFDocument from 'pdfkit';

import { resolveReportFonts, type ReportFontName } from './fonts.ts';
import { createGlyphGuard, type GlyphGuard } from './glyphs.ts';

const PAGE_MARGIN = 48;
const A4_WIDTH = 595.28;
const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

/**
 * The strip at the foot of every page that carries the page number and the
 * legal note, and that content is therefore kept out of.
 *
 * It is reserved by widening the bottom margin, which is what makes `reserve()`,
 * the table's own page breaks and PDFKit's text flow all stop above the footer
 * without any of them knowing it exists. Writing the footer into the margin
 * without reserving it is what produced a 531-page file out of 177 pages of
 * content: every `text()` below `page.maxY()` starts a page of its own.
 */
const FOOTER_BAND = 18;
const FOOTER_SIZE = 7.5;

export const REPORT_COLOURS = {
  text: '#14161a',
  muted: '#5b6472',
  rule: '#d8dde5',
  accent: '#1f4fd8',
  critical: '#b3261e',
  high: '#b5580b',
  medium: '#8a6d09',
  low: '#3f6212',
} as const;

export type ReportColour = keyof typeof REPORT_COLOURS;

export interface TextOptions {
  readonly font?: ReportFontName;
  readonly size?: number;
  readonly colour?: ReportColour;
  readonly indent?: number;
  readonly gapAfter?: number;
}

export interface TableColumn {
  readonly heading: string;
  /** Share of the content width, 0..1. The shares should add up to 1. */
  readonly width: number;
  readonly align?: 'left' | 'right';
}

export class ReportDocument {
  private readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly finished: Promise<Buffer>;
  private readonly glyphs: GlyphGuard;
  private escapedCharacters = 0;

  constructor(title: string, glyphs: GlyphGuard = createGlyphGuard()) {
    const fonts = resolveReportFonts();
    this.glyphs = glyphs;
    this.doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: PAGE_MARGIN,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
        bottom: PAGE_MARGIN + FOOTER_BAND,
      },
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: title, Producer: 'FluxRadar', Creator: 'FluxRadar' },
    });
    for (const [name, path] of Object.entries(fonts)) {
      this.doc.registerFont(name, path);
    }
    this.finished = new Promise<Buffer>((resolve, reject) => {
      this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
    this.doc.addPage();
  }

  get contentWidth(): number {
    return CONTENT_WIDTH;
  }

  /** Pages written so far. The footer pass must not change this. */
  get pageCount(): number {
    return this.doc.bufferedPageRange().count;
  }

  /**
   * How many characters the fonts could not draw and were written as escapes.
   *
   * The renderer asks at the end and states the convention in the document when
   * the answer is not zero — a reader who meets `\u{9801}` on page nine is owed
   * an explanation inside the same file.
   */
  get escapedCharacterCount(): number {
    return this.escapedCharacters;
  }

  /** Every string on its way to the page passes through here. */
  private drawable(value: string, font: ReportFontName): string {
    const escaped = this.glyphs.escapeUnsupported(font, value);
    this.escapedCharacters += escaped.escaped;
    return escaped.text;
  }

  /** Starts a new page when less than `needed` points remain on this one. */
  reserve(needed: number): void {
    const remaining = this.doc.page.height - this.doc.page.margins.bottom - this.doc.y;
    if (remaining < needed) this.doc.addPage();
  }

  newPage(): void {
    this.doc.addPage();
  }

  text(value: string, options: TextOptions = {}): void {
    const indent = options.indent ?? 0;
    const font = options.font ?? 'body';
    this.doc
      .font(font)
      .fontSize(options.size ?? 10)
      .fillColor(REPORT_COLOURS[options.colour ?? 'text'])
      .text(this.drawable(value, font), PAGE_MARGIN + indent, this.doc.y, {
        width: CONTENT_WIDTH - indent,
        align: 'left',
      });
    if (options.gapAfter !== undefined) this.doc.moveDown(options.gapAfter);
  }

  heading(value: string, level: 1 | 2 | 3 = 1): void {
    const sizes = { 1: 20, 2: 14, 3: 11 } as const;
    this.reserve(level === 1 ? 90 : 60);
    this.doc.moveDown(level === 1 ? 0.8 : 0.6);
    this.text(value, { font: 'bold', size: sizes[level] });
    this.doc.moveDown(0.35);
    if (level === 1) this.rule();
  }

  rule(): void {
    const y = this.doc.y;
    this.doc
      .strokeColor(REPORT_COLOURS.rule)
      .lineWidth(0.75)
      .moveTo(PAGE_MARGIN, y)
      .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
      .stroke();
    this.doc.y = y + 8;
  }

  paragraph(value: string, options: TextOptions = {}): void {
    this.text(value, options);
    this.doc.moveDown(0.5);
  }

  /** A label above its value, for cover-page facts. */
  fact(label: string, value: string): void {
    this.text(label, { font: 'bold', size: 8, colour: 'muted' });
    this.text(value, { size: 12 });
    this.doc.moveDown(0.4);
  }

  keyValue(label: string, value: string, options: { readonly mono?: boolean } = {}): void {
    this.reserve(40);
    this.text(label, { font: 'bold', size: 9, colour: 'muted' });
    this.text(value, { size: 9, ...(options.mono === true ? { font: 'mono' as const } : {}) });
    this.doc.moveDown(0.3);
  }

  bullets(values: readonly string[], options: TextOptions = {}): void {
    for (const value of values) {
      this.reserve(28);
      this.text(`•  ${value}`, { size: 9, indent: 8, ...options });
    }
    this.doc.moveDown(0.3);
  }

  /**
   * A table that repeats its header on every page it continues onto. Cells wrap;
   * a long cell grows the row rather than being cut.
   */
  table(columns: readonly TableColumn[], rows: readonly (readonly string[])[]): void {
    const widths = columns.map((column) => column.width * CONTENT_WIDTH);
    // Escaped before anything is measured: an escape is longer than the
    // character it replaces, and a row measured before it would wrap out of
    // its own cell.
    const drawable = rows.map((row) => row.map((cell) => this.drawable(cell, 'body')));
    this.reserve(70);
    this.tableHeader(columns, widths);
    for (const row of drawable) {
      const height = this.rowHeight(row, widths);
      if (height > this.pageContentHeight()) {
        // A row taller than a whole page cannot be laid out in columns: the
        // first cell would flow onto the next page and the second would then be
        // drawn on top of it. Such a row is stated as stacked label/value blocks
        // instead, which flow correctly — the content is kept, the grid is not.
        this.stackedRow(columns, row);
        this.tableHeader(columns, widths);
        continue;
      }
      if (this.doc.y + height > this.doc.page.height - this.doc.page.margins.bottom) {
        this.doc.addPage();
        this.tableHeader(columns, widths);
      }
      this.tableRow(columns, widths, row, height);
    }
    this.doc.moveDown(0.6);
  }

  private pageContentHeight(): number {
    return this.doc.page.height - this.doc.page.margins.top - this.doc.page.margins.bottom;
  }

  /** One table row written as labelled blocks, for a row no page can hold. */
  private stackedRow(columns: readonly TableColumn[], row: readonly string[]): void {
    this.doc.moveDown(0.4);
    columns.forEach((column, index) => {
      const cell = row[index] ?? '';
      if (cell === '') return;
      this.text(column.heading, { font: 'bold', size: 8, colour: 'muted' });
      this.text(cell, { size: 9 });
    });
    this.doc.moveDown(0.4);
  }

  private tableHeader(columns: readonly TableColumn[], widths: readonly number[]): void {
    const top = this.doc.y;
    let x = PAGE_MARGIN;
    this.doc.font('bold').fontSize(9).fillColor(REPORT_COLOURS.muted);
    columns.forEach((column, index) => {
      const width = widths[index] ?? 0;
      this.doc.text(this.drawable(column.heading, 'bold'), x, top, {
        width,
        align: column.align ?? 'left',
      });
      x += width;
    });
    this.doc.y = top + 14;
    this.rule();
  }

  private rowHeight(row: readonly string[], widths: readonly number[]): number {
    this.doc.font('body').fontSize(9);
    const heights = row.map((cell, index) =>
      this.doc.heightOfString(cell, { width: widths[index] ?? 0 }),
    );
    return Math.max(...heights, 12) + 8;
  }

  private tableRow(
    columns: readonly TableColumn[],
    widths: readonly number[],
    row: readonly string[],
    height: number,
  ): void {
    const top = this.doc.y;
    let x = PAGE_MARGIN;
    this.doc.font('body').fontSize(9).fillColor(REPORT_COLOURS.text);
    columns.forEach((column, index) => {
      const width = widths[index] ?? 0;
      this.doc.text(row[index] ?? '', x, top, { width, align: column.align ?? 'left' });
      x += width;
    });
    this.doc.y = top + height;
  }

  /** A tinted label, used for severities. */
  badge(label: string, colour: ReportColour): void {
    this.text(label.toUpperCase(), { font: 'bold', size: 8, colour });
  }

  /**
   * Stamps the page number and the legal note on every page and closes the
   * document.
   *
   * The count is only knowable at the end, which is why the document buffers its
   * pages; the footer is written in a second pass over them.
   *
   * THIS PASS MUST NOT ADD A PAGE. Both lines sit in the band `FOOTER_BAND`
   * reserved at the foot of the page, which is below `page.maxY()` — so the
   * bottom margin is taken to zero for the length of the write and restored
   * afterwards (PDFKit's documented footer recipe), and neither line is allowed
   * to wrap. Without that, every `text()` below the margin appends a page, the
   * appended page gets a footer of its own, and a 177-page report is delivered
   * as 531 pages of which two thirds are blank.
   */
  async finish(footerNote: string): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      this.doc.switchToPage(range.start + index);
      const restore = this.doc.page.margins.bottom;
      this.doc.page.margins.bottom = 0;
      this.doc.font('body').fontSize(FOOTER_SIZE).fillColor(REPORT_COLOURS.muted);
      const y = this.doc.page.height - PAGE_MARGIN - this.doc.currentLineHeight();
      this.doc
        .text(this.drawable(footerNote, 'body'), PAGE_MARGIN, y, {
          width: CONTENT_WIDTH * 0.8,
          align: 'left',
          lineBreak: false,
        })
        .text(`${index + 1} / ${range.count}`, PAGE_MARGIN + CONTENT_WIDTH * 0.8, y, {
          width: CONTENT_WIDTH * 0.2,
          align: 'right',
          lineBreak: false,
        });
      this.doc.page.margins.bottom = restore;
    }
    this.doc.end();
    return this.finished;
  }
}
