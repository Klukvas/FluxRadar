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
//   * no remote resource is ever referenced. Images use only in-memory PNG bytes validated at upload;
//     no links are fetched and no fonts downloaded — see fonts.ts.

import PDFDocument from 'pdfkit';

import { resolveReportFonts, type ReportFontName } from './fonts.ts';
import { structureColour } from './document-graphics.ts';
import { createGlyphGuard, type GlyphGuard } from './glyphs.ts';

export const PAGE_MARGIN = 48;
const A4_WIDTH = 595.28;
export const CONTENT_WIDTH = A4_WIDTH - PAGE_MARGIN * 2;

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
/** Where the footer's hairline and its text sit, measured up from the page foot. */
const FOOTER_RULE_FROM_BOTTOM = 54;
const FOOTER_TEXT_FROM_BOTTOM = 50;
/** The running header's baseline box on every page after the first. */
const RUNNING_HEADER_Y = 22;
/** Kept clear between the running header's two cells. */
const RUNNING_HEADER_GAP = 12;
const WHITE = '#ffffff';

/**
 * The only colours the report draws with. Each means one thing: the four
 * severity hues only ever mark a severity, `accent` only ever marks a URL, and
 * `band` is the neutral fill behind tiles, zebra rows and evidence.
 */
export const REPORT_COLOURS = {
  text: '#14161a',
  muted: '#5b6472',
  rule: '#e3e7ed',
  band: '#f3f5f8',
  accent: '#1f4fd8',
  critical: '#a3201a',
  high: '#a24f08',
  medium: '#7a6200',
  low: '#2f6f4e',
} as const;

export type ReportPalette = typeof REPORT_COLOURS & { readonly brand: string };
export type ReportInfo = { Title: string; Producer?: string; Creator?: string };
export type ReportColour = keyof ReportPalette;
/**
 * A palette colour, plain white (numerals on a filled circle), or `structure`:
 * the brand colour where it is dark enough to read, the text colour where not.
 */
export type DrawColour = ReportColour | 'white' | 'structure';

export interface TextOptions {
  readonly font?: ReportFontName;
  readonly size?: number;
  readonly colour?: DrawColour;
  readonly indent?: number;
  readonly gapAfter?: number;
  readonly lineGap?: number;
  readonly characterSpacing?: number;
}

/** Text written at a fixed position, for tiles, table cells and card rows. */
export interface PlacedTextOptions {
  readonly font?: ReportFontName;
  readonly size?: number;
  readonly colour?: DrawColour;
  readonly width?: number;
  readonly align?: 'left' | 'right' | 'center';
  readonly lineGap?: number;
  readonly characterSpacing?: number;
}

export interface RunningHeader {
  readonly left: string;
  readonly right: string;
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

  private readonly palette: ReportPalette;
  /** Bars, the ring and numbered circles: the brand, unless it is too pale. */
  private readonly structure: string;

  constructor(
    title: string,
    glyphs: GlyphGuard = createGlyphGuard(),
    options: { readonly palette?: ReportPalette; readonly info?: ReportInfo } = {},
  ) {
    const fonts = resolveReportFonts();
    this.glyphs = glyphs;
    this.palette = options.palette ?? { ...REPORT_COLOURS, brand: REPORT_COLOURS.text };
    this.structure = structureColour(this.palette.brand, this.palette.text);
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
      info: options.info ?? { Title: title, Producer: 'FluxRadar', Creator: 'FluxRadar' },
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

  get contentLeft(): number {
    return PAGE_MARGIN;
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

  /** Where the next flowing block starts. */
  get y(): number {
    return this.doc.y;
  }

  moveTo(y: number): void {
    this.doc.y = y;
  }

  /** The lowest point content may reach on this page: the top of the footer band. */
  get pageBottom(): number {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  /** Points left on this page above the footer band. */
  get remaining(): number {
    return this.pageBottom - this.doc.y;
  }

  /** The page being written, counted from 1. */
  get pageNumber(): number {
    const range = this.doc.bufferedPageRange();
    return range.start + range.count;
  }

  /**
   * Draws on an earlier page, then returns to the page being written with the
   * cursor where it was. For what is only known later: a page reference.
   */
  onPage(pageNumber: number, draw: () => void): void {
    const current = this.pageNumber;
    const cursor = this.doc.y;
    this.doc.switchToPage(pageNumber - 1);
    draw();
    this.doc.switchToPage(current - 1);
    this.doc.y = cursor;
  }

  get atPageTop(): boolean {
    return this.doc.y <= this.doc.page.margins.top + 0.5;
  }

  /** Every string on its way to the page passes through here. */
  private drawable(value: string, font: ReportFontName): string {
    const escaped = this.glyphs.escapeUnsupported(font, value);
    this.escapedCharacters += escaped.escaped;
    return escaped.text;
  }

  /** The same escaping for a string that is only measured, so it is not counted twice. */
  private measurable(value: string, font: ReportFontName): string {
    return this.glyphs.escapeUnsupported(font, value).text;
  }

  private colour(colour: DrawColour): string {
    if (colour === 'white') return WHITE;
    if (colour === 'structure') return this.structure;
    return this.palette[colour];
  }

  /** Starts a new page when less than `needed` points remain on this one. */
  reserve(needed: number): void {
    if (this.remaining < needed) this.doc.addPage();
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
      .fillColor(this.colour(options.colour ?? 'text'))
      .text(this.drawable(value, font), PAGE_MARGIN + indent, this.doc.y, {
        width: CONTENT_WIDTH - indent,
        align: 'left',
        lineGap: options.lineGap ?? 0,
        characterSpacing: options.characterSpacing ?? 0,
      });
    if (options.gapAfter !== undefined) this.doc.moveDown(options.gapAfter);
  }

  /**
   * Text at a fixed position that leaves the flowing cursor where it was, and
   * returns where its last line ended. The caller has measured that it fits.
   */
  textAt(value: string, x: number, y: number, options: PlacedTextOptions = {}): number {
    const font = options.font ?? 'body';
    const cursor = this.doc.y;
    this.doc
      .font(font)
      .fontSize(options.size ?? 9.5)
      .fillColor(this.colour(options.colour ?? 'text'))
      .text(this.drawable(value, font), x, y, {
        width: options.width ?? CONTENT_WIDTH,
        align: options.align ?? 'left',
        lineGap: options.lineGap ?? 0,
        characterSpacing: options.characterSpacing ?? 0,
      });
    const bottom = this.doc.y;
    this.doc.y = cursor;
    return bottom;
  }

  heightOf(value: string, options: PlacedTextOptions = {}): number {
    const font = options.font ?? 'body';
    this.doc.font(font).fontSize(options.size ?? 9.5);
    return this.doc.heightOfString(this.measurable(value, font), {
      width: options.width ?? CONTENT_WIDTH,
      lineGap: options.lineGap ?? 0,
      characterSpacing: options.characterSpacing ?? 0,
    });
  }

  widthOf(value: string, font: ReportFontName, size: number, characterSpacing = 0): number {
    this.doc.font(font).fontSize(size);
    return this.doc.widthOfString(this.measurable(value, font), { characterSpacing });
  }

  fillRect(x: number, y: number, width: number, height: number, colour: DrawColour, radius = 0) {
    const shape =
      radius > 0
        ? this.doc.roundedRect(x, y, width, height, radius)
        : this.doc.rect(x, y, width, height);
    shape.fill(this.colour(colour));
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    style: { readonly radius: number; readonly colour: DrawColour; readonly lineWidth: number },
  ): void {
    this.doc
      .lineWidth(style.lineWidth)
      .roundedRect(x, y, width, height, style.radius)
      .stroke(this.colour(style.colour));
  }

  fillCircle(x: number, y: number, radius: number, colour: DrawColour): void {
    this.doc.circle(x, y, radius).fill(this.colour(colour));
  }

  line(
    from: readonly [number, number],
    to: readonly [number, number],
    colour: DrawColour,
    width = 0.5,
  ) {
    this.doc
      .lineWidth(width)
      .moveTo(from[0], from[1])
      .lineTo(to[0], to[1])
      .stroke(this.colour(colour));
  }

  /**
   * A score ring: the full track in the rule colour and, when there is a score,
   * an arc clockwise from twelve o'clock in the structure colour.
   */
  ring(x: number, y: number, radius: number, share: number | null, strokeWidth = 6): void {
    this.doc.lineWidth(strokeWidth).circle(x, y, radius).stroke(this.colour('rule'));
    if (share === null || share <= 0) return;
    this.doc.lineCap('round').lineWidth(strokeWidth);
    if (share >= 0.999) {
      this.doc.circle(x, y, radius).stroke(this.colour('structure'));
    } else {
      const end = -Math.PI / 2 + 2 * Math.PI * share;
      const endX = x + radius * Math.cos(end);
      const endY = y + radius * Math.sin(end);
      const largeArc = share > 0.5 ? 1 : 0;
      this.doc
        .path(`M ${x} ${y - radius} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`)
        .stroke(this.colour('structure'));
    }
    this.doc.lineCap('butt');
  }

  /** Four 3x8 pips, the first `filled` in the severity colour: readable in greyscale. */
  pips(x: number, y: number, filled: number, colour: DrawColour): void {
    for (let index = 0; index < 4; index += 1) {
      this.fillRect(x + index * 5, y, 3, 8, index < filled ? colour : 'rule', 1);
    }
  }

  imageAt(png: Uint8Array, x: number, y: number, fit: { width: number; height: number }): void {
    this.doc.image(Buffer.from(png), x, y, { fit: [fit.width, fit.height] });
  }

  /**
   * H1 22/28, H2 14/20 behind a short brand bar, H3 11/15. Each keeps enough of
   * the page below it for the first lines of what it introduces.
   */
  heading(value: string, level: 1 | 2 | 3 = 1, size = 22): void {
    if (level === 1) {
      this.reserve(90);
      this.text(value, { font: 'bold', size, lineGap: size * 0.11 });
      this.doc.y += 6;
      return;
    }
    if (level === 2) {
      this.reserve(94);
      if (!this.atPageTop) this.doc.y += 18;
      const top = this.doc.y;
      this.fillRect(PAGE_MARGIN, top + 4, 3, 12, 'brand');
      const bottom = this.textAt(value, PAGE_MARGIN + 10, top, {
        font: 'bold',
        size: 14,
        width: CONTENT_WIDTH - 10,
      });
      this.doc.y = bottom + 8;
      return;
    }
    this.reserve(60);
    if (!this.atPageTop) this.doc.y += 6;
    this.text(value, { font: 'bold', size: 11, lineGap: 1.5 });
    this.doc.y += 4;
  }

  /** A small bold label in capitals, spaced out, above the value it names. */
  capsLabel(value: string, indent = 0): void {
    this.text(value.toUpperCase(), {
      font: 'bold',
      size: 7,
      colour: 'muted',
      characterSpacing: 0.6,
      indent,
    });
    this.doc.y += 2;
  }

  /** The same caps label at a fixed position; returns where it ends. */
  capsLabelAt(value: string, x: number, y: number, width: number): number {
    return this.textAt(value.toUpperCase(), x, y, {
      font: 'bold',
      size: 7,
      colour: 'muted',
      characterSpacing: 0.6,
      width,
    });
  }

  rule(colour: DrawColour = 'rule', width = 0.75): void {
    const y = this.doc.y;
    this.line([PAGE_MARGIN, y], [PAGE_MARGIN + CONTENT_WIDTH, y], colour, width);
    this.doc.y = y + 8;
  }

  paragraph(value: string, options: TextOptions = {}): void {
    this.text(value, options);
    this.doc.moveDown(0.5);
  }

  keyValue(label: string, value: string, options: { readonly mono?: boolean } = {}): void {
    this.reserve(40);
    this.text(label, { font: 'bold', size: 8, colour: 'muted' });
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
      if (height > this.pageContentHeight) {
        // A row taller than a whole page cannot be laid out in columns: the
        // first cell would flow onto the next page and the second would then be
        // drawn on top of it. Such a row is stated as stacked label/value blocks
        // instead, which flow correctly — the content is kept, the grid is not.
        this.stackedRow(columns, row);
        this.tableHeader(columns, widths);
        continue;
      }
      if (this.doc.y + height > this.pageBottom) {
        this.doc.addPage();
        this.tableHeader(columns, widths);
      }
      this.tableRow(columns, widths, row, height);
    }
    this.doc.moveDown(0.6);
  }

  /** The height a page offers between its top margin and the footer band. */
  get pageContentHeight(): number {
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
    this.doc.font('bold').fontSize(8).fillColor(this.palette.muted);
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
    this.doc.font('body').fontSize(9).fillColor(this.palette.text);
    columns.forEach((column, index) => {
      const width = widths[index] ?? 0;
      this.doc.text(row[index] ?? '', x, top, { width, align: column.align ?? 'left' });
      x += width;
    });
    this.doc.y = top + height;
  }

  /** A tinted label, used for severities. */
  badge(label: string, colour: DrawColour): void {
    this.text(label.toUpperCase(), { font: 'bold', size: 7.5, colour, characterSpacing: 0.5 });
  }

  /**
   * Stamps the running header, the page number and the legal note on every page
   * and closes the document.
   *
   * The count is only knowable at the end, which is why the document buffers its
   * pages; the header and footer are written in a second pass over them.
   *
   * THIS PASS MUST NOT ADD A PAGE. Both lines sit outside the content area — the
   * header above the top margin, the footer in the band `FOOTER_BAND` reserved
   * at the foot of the page, below `page.maxY()` — so the margins are taken to
   * zero for the length of the write and restored afterwards (PDFKit's
   * documented footer recipe), and no line is allowed to wrap. Without that,
   * every `text()` below the margin appends a page, the appended page gets a
   * footer of its own, and a 177-page report is delivered as 531 pages of which
   * two thirds are blank.
   */
  async finish(footerNote: string, header?: RunningHeader): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      this.doc.switchToPage(range.start + index);
      const restore = { ...this.doc.page.margins };
      this.doc.page.margins.bottom = 0;
      this.doc.page.margins.top = 0;
      if (header !== undefined && index > 0) this.runningHeader(header);
      this.footer(footerNote, `${index + 1} / ${range.count}`);
      this.doc.page.margins.bottom = restore.bottom;
      this.doc.page.margins.top = restore.top;
    }
    this.doc.end();
    return this.finished;
  }

  /**
   * The report's name on the left and who prepared it on the right, each cut
   * with an ellipsis by measured width so neither can run into the other.
   */
  private runningHeader(header: RunningHeader): void {
    const cells = [
      { value: header.left, x: PAGE_MARGIN, width: CONTENT_WIDTH * 0.6, align: 'left' as const },
      {
        value: header.right,
        x: PAGE_MARGIN + CONTENT_WIDTH * 0.6,
        width: CONTENT_WIDTH * 0.4,
        align: 'right' as const,
      },
    ];
    for (const cell of cells) {
      const fitted = this.ellipsized(cell.value, cell.width - RUNNING_HEADER_GAP);
      this.doc.font('body').fontSize(FOOTER_SIZE).fillColor(this.palette.muted);
      this.doc.text(this.drawable(fitted, 'body'), cell.x, RUNNING_HEADER_Y, {
        width: cell.width,
        align: cell.align,
        lineBreak: false,
      });
    }
  }

  /** `value`, shortened with an ellipsis until it fits `width` at the header size. */
  private ellipsized(value: string, width: number): string {
    if (this.widthOf(value, 'body', FOOTER_SIZE) <= width) return value;
    const characters = [...value];
    let length = characters.length;
    while (
      length > 1 &&
      this.widthOf(`${characters.slice(0, length).join('')}…`, 'body', FOOTER_SIZE) > width
    ) {
      length -= 1;
    }
    return `${characters.slice(0, length).join('').trimEnd()}…`;
  }

  private footer(note: string, counter: string): void {
    const ruleY = this.doc.page.height - FOOTER_RULE_FROM_BOTTOM;
    this.line([PAGE_MARGIN, ruleY], [PAGE_MARGIN + CONTENT_WIDTH, ruleY], 'rule', 0.5);
    const y = this.doc.page.height - FOOTER_TEXT_FROM_BOTTOM;
    this.doc.font('body').fontSize(FOOTER_SIZE).fillColor(this.palette.muted);
    this.doc
      .text(this.drawable(note, 'body'), PAGE_MARGIN, y, {
        width: CONTENT_WIDTH * 0.8,
        align: 'left',
        lineBreak: false,
      })
      .text(counter, PAGE_MARGIN + CONTENT_WIDTH * 0.8, y, {
        width: CONTENT_WIDTH * 0.2,
        align: 'right',
        lineBreak: false,
      });
  }
}
