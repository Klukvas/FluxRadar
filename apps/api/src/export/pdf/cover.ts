// Page one: who the report is for, the facts of the scan, how to read the rest,
// then the picture (summary tiles) and the table (sections). Identical for the
// plain and the agency report except for the header block above the rule.

import type { FindingLanguage } from '@fluxradar/rules';

import type { ReportBrand } from '../../branding/load.ts';
import { brandedCover } from './branding.ts';
import type { ReportCopy } from './copy.ts';
import type { ReportDocument } from './document.ts';
import { displayDomain, planText, timestamp } from './report-format.ts';
import type { ActionPlanProjection } from './render.ts';
import type { PdfReportHeader } from './report-data.ts';
import { sectionsSection } from './sections-table.ts';
import { scanStatusText } from './status-text.ts';
import { summarySection, type FirstStepSlot } from './summary-tiles.ts';

export interface CoverContext {
  readonly doc: ReportDocument;
  readonly header: PdfReportHeader;
  readonly copy: ReportCopy;
  readonly language: FindingLanguage;
  readonly now: Date;
  readonly brand: ReportBrand | null;
  /** The plan that will print on page two, or null when none will. */
  readonly plan: ActionPlanProjection | null;
}

interface Fact {
  readonly label: string;
  readonly value: string;
}

/** The H1 shrinks from 22 pt to this before it breaks a line. */
const TITLE_SIZES = { max: 22, min: 16 } as const;
/** A status sentence wider than this leaves the fact row for a line of its own. */
const STATUS_INLINE_MAX = 118;
const FACT_COLUMNS = 4;

/**
 * Draws page one. Returns where the first-step line was kept, for the page
 * number of the plan, which is only known once the plan is placed.
 */
export function coverPage(context: CoverContext): FirstStepSlot | null {
  const { doc, copy, header } = context;
  const headerBottom = context.brand
    ? brandedCover(doc, context.brand, context.language)
    : plainHeader(doc);
  const ruleY = headerBottom + 10;
  doc.line([doc.contentLeft, ruleY], [doc.contentLeft + doc.contentWidth, ruleY], 'brand', 2);
  doc.moveTo(ruleY + 18);
  title(doc, copy, displayDomain(header.scan.domain));
  factRow(context);
  howToReadBox(doc, context.plan === null ? copy.howToReadNoPlan : copy.howToRead);
  const slot = summarySection(context);
  sectionsSection(context);
  return slot;
}

/**
 * The H1, never broken inside the domain: it shrinks until the whole title
 * fits on one line, and below 16 pt it breaks before the domain instead.
 */
function title(doc: ReportDocument, copy: ReportCopy, domain: string): void {
  const full = copy.preparedFor(domain);
  for (let size = TITLE_SIZES.max; size >= TITLE_SIZES.min; size -= 1) {
    if (doc.widthOf(full, 'bold', size) <= doc.contentWidth) {
      doc.heading(full, 1, size);
      return;
    }
  }
  const at = full.lastIndexOf(domain);
  const broken = at > 0 ? `${full.slice(0, at).trimEnd()}\n${full.slice(at)}` : full;
  doc.heading(broken, 1, TITLE_SIZES.min);
}

function plainHeader(doc: ReportDocument): number {
  return doc.textAt('FluxRadar', doc.contentLeft, doc.y, {
    font: 'bold',
    size: 11,
    colour: 'accent',
  });
}

/**
 * The scan's facts in one row. The agency report leaves out the tariff: its
 * name is ours, and the agency's client did not buy it from us.
 */
function factRow({ doc, copy, header, language, now, brand }: CoverContext): void {
  const status = scanStatusText(header.scan, language, brand ? 'neutral' : 'fluxradar');
  const facts: readonly Fact[] = [
    ...(brand ? [] : [{ label: copy.plan, value: planText(header.scan.plan, copy) }]),
    { label: copy.scanned, value: timestamp(header.scan.completedAt ?? header.scan.createdAt) },
    { label: copy.generatedLabel, value: timestamp(now) },
  ];
  const columnWidth = doc.contentWidth / FACT_COLUMNS;
  const statusInline = doc.widthOf(status, 'body', 10) <= STATUS_INLINE_MAX;
  const row = statusInline ? [...facts, { label: copy.status, value: status }] : facts;
  const top = doc.y + 2;
  const bottoms = row.map((fact, index) => {
    const x = doc.contentLeft + index * columnWidth;
    const width = index === row.length - 1 ? doc.contentLeft + doc.contentWidth - x : columnWidth;
    doc.capsLabelAt(fact.label, x, top, width - 8);
    return doc.textAt(fact.value, x, top + 11, { size: 10, width: width - 8 });
  });
  doc.moveTo(Math.max(...bottoms) + 8);
  if (!statusInline) {
    doc.capsLabel(copy.status);
    doc.text(status, { size: 9, lineGap: 2 });
    doc.moveTo(doc.y + 8);
  }
}

/** The orientation note: its first sentence in bold, the rest beneath it. */
function howToReadBox(doc: ReportDocument, text: string): void {
  const split = text.indexOf('. ');
  const title = split < 0 ? text : text.slice(0, split + 1);
  const body = split < 0 ? '' : text.slice(split + 2);
  const width = doc.contentWidth - 20;
  const style = { size: 8.5, width, lineGap: 1.5 } as const;
  const titleHeight = doc.heightOf(title, { ...style, font: 'bold' });
  const bodyHeight = body === '' ? 0 : doc.heightOf(body, style) + 2;
  const height = titleHeight + bodyHeight + 16;
  const top = doc.y + 4;
  doc.fillRect(doc.contentLeft, top, doc.contentWidth, height, 'band', 4);
  const x = doc.contentLeft + 10;
  const titleBottom = doc.textAt(title, x, top + 8, { ...style, font: 'bold' });
  if (body !== '') doc.textAt(body, x, titleBottom + 2, { ...style, colour: 'muted' });
  doc.moveTo(top + height);
}
