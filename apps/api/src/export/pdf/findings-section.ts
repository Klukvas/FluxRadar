// The findings chapter: a heading per severity group, then one card per
// finding, streamed in the order the loader hands them over (worst first).

import type { FindingLanguage } from '@fluxradar/rules';

import type { ReportCopy } from './copy.ts';
import { isScoredSeverity, SEVERITY_COLOUR, SEVERITY_LEVEL } from './document-graphics.ts';
import type { DrawColour, ReportDocument } from './document.ts';
import { moduleLabel, ruleTitle } from './names.ts';
import type { PdfReportHeader, ReportFinding } from './report-data.ts';
import { issueStatusText } from './status-text.ts';

/**
 * The least room the chapter opens on the current page with. The real test is
 * stricter: the heading, its lead, the first group header and the whole first
 * card must fit under it (`chapterBlockHeight`), so the heading is never left
 * alone at a page foot.
 */
const CHAPTER_MIN_SPACE = 180;
/** The space an H2 takes above and below its line (document.ts heading()). */
const H2_SPACING = 18 + 8;
/** An empty chapter is one heading and one sentence: it never needs a page of its own. */
const EMPTY_CHAPTER_MIN_SPACE = 100;
/**
 * A card taller than a page cannot be kept whole; it keeps at least its pips,
 * badge, title, URL and 30 pt more together and flows from there.
 */
const CARD_KEEP_TOGETHER = 70;
/** Measuring rounds; a card is kept whole with this much to spare. */
const CARD_SLACK = 4;
const GROUP_HEADER_HEIGHT = 34;
const EVIDENCE_PADDING = { x: 10, y: 5 } as const;
const META_X = 150;
/** A caps label never ends a page: it keeps its first line of text with it. */
const LABEL_KEEP_WITH_TEXT = 30;

export function severityColour(severity: string): DrawColour {
  return isScoredSeverity(severity) ? SEVERITY_COLOUR[severity] : 'muted';
}

const LEAD_STYLE = { size: 9, colour: 'muted', lineGap: 2 } as const;

/** The heading and its two lead sentences, as `findingsChapterStart` writes them. */
function chapterBlockHeight(doc: ReportDocument, header: PdfReportHeader, copy: ReportCopy) {
  return (
    H2_SPACING +
    doc.heightOf(copy.problemsHeading, { font: 'bold', size: 14 }) +
    doc.heightOf(copy.problemsLead, LEAD_STYLE) +
    doc.heightOf(copy.completeNote(header.totalFindings), LEAD_STYLE) +
    10
  );
}

/**
 * Opens the chapter. With findings it is called by the writer once the first
 * finding is known (`firstCard` is the room that card keeps together), so the
 * chapter starts on this page only when its heading, lead, first group header
 * and first card all fit; otherwise it starts on the next one.
 */
function findingsChapterStart(
  doc: ReportDocument,
  header: PdfReportHeader,
  copy: ReportCopy,
  firstCard = 0,
): void {
  const needed =
    header.totalFindings === 0
      ? EMPTY_CHAPTER_MIN_SPACE
      : Math.max(
          CHAPTER_MIN_SPACE,
          chapterBlockHeight(doc, header, copy) + GROUP_HEADER_HEIGHT + firstCard,
        );
  if (doc.remaining < needed) doc.newPage();
  doc.heading(copy.problemsHeading, 2);
  if (header.totalFindings === 0) {
    doc.paragraph(copy.noFindings);
    return;
  }
  doc.text(copy.problemsLead, LEAD_STYLE);
  doc.text(copy.completeNote(header.totalFindings), LEAD_STYLE);
  doc.moveTo(doc.y + 10);
}

/** The key the findings index and the writer share: one problem in one section. */
export function ruleGroupKey(group: {
  readonly ruleId: string;
  readonly severity: string;
  readonly module: string;
}): string {
  return `${group.ruleId}\u0000${group.severity}\u0000${group.module}`;
}

export interface FindingWriter {
  readonly write: (finding: ReportFinding) => void;
  /** Opens the chapter if no finding has yet: an empty or emptied scan still gets it. */
  readonly ensureChapter: () => void;
  /** The page each problem's first card landed on, for the index. */
  readonly firstPages: ReadonlyMap<string, number>;
}

/**
 * A writer that takes the findings one at a time and opens a severity group
 * whenever the severity changes from the finding before: the comparison is
 * with the previous finding, so it holds across the loader's pages.
 */
export function findingWriter(
  doc: ReportDocument,
  header: PdfReportHeader,
  copy: ReportCopy,
  language: FindingLanguage,
): FindingWriter {
  let previousSeverity: string | null = null;
  let chapterOpen = false;
  const firstPages = new Map<string, number>();
  const openChapter = (firstCard: number): void => {
    if (chapterOpen) return;
    chapterOpen = true;
    findingsChapterStart(doc, header, copy, firstCard);
  };
  const write = (finding: ReportFinding): void => {
    const height = cardHeight(doc, finding, copy, language);
    // The first card shares its page with the chapter heading, its lead and the
    // first group header, so it is kept whole only if it fits under them.
    const keep = chapterOpen
      ? keepTogether(doc, height, doc.pageContentHeight)
      : keepTogether(
          doc,
          height,
          doc.pageContentHeight - chapterBlockHeight(doc, header, copy) - GROUP_HEADER_HEIGHT,
        );
    openChapter(keep);
    if (finding.severity !== previousSeverity) {
      groupHeader(doc, header, copy, finding.severity, keep);
      previousSeverity = finding.severity;
    }
    doc.reserve(keep);
    const key = ruleGroupKey(finding);
    if (!firstPages.has(key)) firstPages.set(key, doc.pageNumber);
    findingCard(doc, finding, copy, language);
  };
  return { write, ensureChapter: () => openChapter(0), firstPages };
}

/** The whole card when `room` can hold it; otherwise its head. */
function keepTogether(doc: ReportDocument, height: number, room: number): number {
  return height + CARD_SLACK <= room ? height + CARD_SLACK : CARD_KEEP_TOGETHER;
}

function capsLabelHeight(doc: ReportDocument, label: string): number {
  return doc.heightOf(label.toUpperCase(), { font: 'bold', size: 7, characterSpacing: 0.6 }) + 2;
}

/** The card's height as `findingCard` draws it, down to its closing rule. */
function cardHeight(
  doc: ReportDocument,
  finding: ReportFinding,
  copy: ReportCopy,
  language: FindingLanguage,
): number {
  const meta = doc.heightOf(metaLine(finding, copy, language), {
    size: 8,
    width: doc.contentWidth - META_X,
  });
  const head =
    Math.max(13, meta + 3) +
    doc.heightOf(ruleTitle(finding.ruleId, language), { font: 'bold', size: 11, lineGap: 1 }) +
    2 +
    doc.heightOf(finding.targetUrl, { font: 'mono', size: 8 }) +
    6;
  const excerpt = finding.evidenceExcerpt;
  const evidenceBlock =
    excerpt === null || excerpt === ''
      ? 0
      : capsLabelHeight(doc, copy.evidence) + evidenceHeight(doc, excerpt) + 8;
  const fix =
    capsLabelHeight(doc, copy.recommendation) +
    doc.heightOf(finding.recommendation, { size: 9.5, lineGap: 2 }) +
    10;
  return head + evidenceBlock + fix;
}

function evidenceHeight(doc: ReportDocument, excerpt: string): number {
  const width = doc.contentWidth - EVIDENCE_PADDING.x * 2;
  return doc.heightOf(excerpt, { font: 'mono', size: 8, width }) + EVIDENCE_PADDING.y * 2;
}

function groupHeader(
  doc: ReportDocument,
  header: PdfReportHeader,
  copy: ReportCopy,
  severity: string,
  firstCard: number,
): void {
  const withCard = GROUP_HEADER_HEIGHT + firstCard;
  doc.reserve(
    withCard <= doc.pageContentHeight ? withCard : GROUP_HEADER_HEIGHT + CARD_KEEP_TOGETHER,
  );
  if (!doc.atPageTop) doc.moveTo(doc.y + 6);
  const top = doc.y;
  const colour = severityColour(severity);
  const label = copy.severity[severity as keyof ReportCopy['severity']] ?? severity;
  const title = isScoredSeverity(severity) ? `${label} · ${header.bySeverity[severity]}` : label;
  doc.pips(doc.contentLeft, top + 3.5, SEVERITY_LEVEL[severity] ?? 0, colour);
  const bottom = doc.textAt(title, doc.contentLeft + 24, top, { font: 'bold', size: 11, colour });
  const ruleY = bottom + 4;
  doc.line([doc.contentLeft, ruleY], [doc.contentLeft + doc.contentWidth, ruleY], 'rule', 0.75);
  doc.moveTo(ruleY + 10);
}

function metaLine(finding: ReportFinding, copy: ReportCopy, language: FindingLanguage): string {
  return [
    finding.ruleId,
    moduleLabel(finding.module, language),
    // A site-wide check (TLS, robots.txt, DNS) has no pages to count.
    finding.targetKind === 'page'
      ? copy.affectedPages(finding.affectedTargets, finding.applicableTargets)
      : copy.wholeSite,
    // "New" is what nearly every finding is; only a different state is news.
    ...(finding.status === 'New' ? [] : [issueStatusText(finding.status, language)]),
  ].join(' · ');
}

function findingCard(
  doc: ReportDocument,
  finding: ReportFinding,
  copy: ReportCopy,
  language: FindingLanguage,
): void {
  const top = doc.y;
  const left = doc.contentLeft;
  const colour = severityColour(finding.severity);
  doc.pips(left, top + 2, SEVERITY_LEVEL[finding.severity] ?? 0, colour);
  const badge = copy.severity[finding.severity as keyof ReportCopy['severity']] ?? finding.severity;
  doc.textAt(badge.toUpperCase(), left + 24, top + 1, {
    font: 'bold',
    size: 7.5,
    colour,
    characterSpacing: 0.5,
    width: META_X - 24,
  });
  const metaBottom = doc.textAt(metaLine(finding, copy, language), left + META_X, top, {
    size: 8,
    colour: 'muted',
    width: doc.contentWidth - META_X,
    align: 'right',
  });
  doc.moveTo(Math.max(top + 13, metaBottom + 3));
  // The problem, in the reader's words. Its id stays on the meta line above:
  // it is what a reader quotes to support, and a rule this build has no title
  // for still prints the id as the heading.
  doc.text(ruleTitle(finding.ruleId, language), { font: 'bold', size: 11, lineGap: 1 });
  doc.moveTo(doc.y + 2);
  doc.text(finding.targetUrl, { font: 'mono', size: 8, colour: 'accent' });
  doc.moveTo(doc.y + 6);
  if (finding.evidenceExcerpt !== null && finding.evidenceExcerpt !== '') {
    doc.reserve(LABEL_KEEP_WITH_TEXT);
    doc.capsLabel(copy.evidence);
    evidence(doc, finding.evidenceExcerpt, colour);
  }
  doc.reserve(LABEL_KEEP_WITH_TEXT);
  doc.capsLabel(copy.recommendation);
  doc.text(finding.recommendation, { size: 9.5, lineGap: 2 });
  const ruleY = doc.y + 10;
  doc.line([left, ruleY], [left + doc.contentWidth, ruleY], 'rule', 0.5);
  doc.moveTo(ruleY + 14);
}

/**
 * The excerpt in full, however long it is. The document says every finding is
 * included and nothing was left out; an excerpt cut at a round number would
 * make that false on exactly the findings a reader most needs to see.
 *
 * It is boxed only when the box fits on this page. A longer excerpt is written
 * as indented text that flows across pages like any other paragraph — the
 * rules engine bounds it at 2 048 characters, which measure in tens of ms.
 */
function evidence(doc: ReportDocument, excerpt: string, colour: DrawColour): void {
  const width = doc.contentWidth - EVIDENCE_PADDING.x * 2;
  const height = evidenceHeight(doc, excerpt);
  if (height + 2 > doc.remaining) {
    doc.text(excerpt, { font: 'mono', size: 8, indent: EVIDENCE_PADDING.x });
    doc.moveTo(doc.y + 8);
    return;
  }
  const top = doc.y;
  const left = doc.contentLeft;
  doc.fillRect(left, top, doc.contentWidth, height, 'band', 3);
  doc.fillRect(left, top, 2.5, height, colour);
  doc.textAt(excerpt, left + EVIDENCE_PADDING.x, top + EVIDENCE_PADDING.y, {
    font: 'mono',
    size: 8,
    width,
  });
  doc.moveTo(top + height + 8);
}
