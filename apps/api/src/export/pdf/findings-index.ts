// The findings index: for a long report, one line per problem before the
// cards, so a reader sees the whole list on a page instead of paging through
// sixty cards to learn there are twelve kinds of problem.

import type { FindingLanguage } from '@fluxradar/rules';

import type { ReportCopy } from './copy.ts';
import { SEVERITY_LEVEL } from './document-graphics.ts';
import type { ReportDocument } from './document.ts';
import { ruleGroupKey, severityColour } from './findings-section.ts';
import { moduleLabel, ruleTitle } from './names.ts';
import type { PdfReportHeader, ReportRuleGroup } from './report-data.ts';

/** Below this many findings the cards are short enough to read without an index. */
const INDEX_MIN_FINDINGS = 21;
/** Above this many distinct problems the index stops being a single glance. */
const INDEX_MAX_RULES = 80;
const TWO_COLUMN_FROM = 25;
const ROW_MIN_HEIGHT = 14;
const COLUMN_GAP = 16;
const COUNT_WIDTH = 34;
const PIPS_WIDTH = 24;
/** The page-reference column: «с. 12». */
const PAGE_WIDTH = 36;

interface IndexEntry {
  readonly group: ReportRuleGroup;
  readonly text: string;
}

function hasFindingsIndex(header: PdfReportHeader): boolean {
  return (
    header.totalFindings >= INDEX_MIN_FINDINGS &&
    header.ruleGroups.length > 0 &&
    header.ruleGroups.length <= INDEX_MAX_RULES
  );
}

/** Worst first, then the most frequent, then by title. */
function indexEntries(
  groups: readonly ReportRuleGroup[],
  language: FindingLanguage,
): readonly IndexEntry[] {
  return groups
    .map((group) => ({
      group,
      text: `${ruleTitle(group.ruleId, language)} · ${moduleLabel(group.module, language)}`,
    }))
    .sort(
      (left, right) =>
        (SEVERITY_LEVEL[right.group.severity] ?? 0) - (SEVERITY_LEVEL[left.group.severity] ?? 0) ||
        right.group.count - left.group.count ||
        left.text.localeCompare(right.text, language),
    );
}

/** Where one problem's page reference goes, once its first card is placed. */
export interface IndexPageSlot {
  readonly key: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Writes the index with everything but the page references, which are only
 * known once the findings have been laid out; returns where each one goes.
 * The rows are drawn now, so the pages the index takes are fixed here and the
 * references written later (`fillIndexPages`) can never move a page.
 */
export function findingsIndex(
  doc: ReportDocument,
  header: PdfReportHeader,
  copy: ReportCopy,
  language: FindingLanguage,
): readonly IndexPageSlot[] {
  if (!hasFindingsIndex(header)) return [];
  if (!doc.atPageTop) doc.newPage();
  doc.heading(copy.findingsIndexHeading, 2);
  const entries = indexEntries(header.ruleGroups, language);
  const columns = entries.length >= TWO_COLUMN_FROM ? 2 : 1;
  const columnWidth = (doc.contentWidth - COLUMN_GAP * (columns - 1)) / columns;
  const slots: IndexPageSlot[] = [];
  for (let start = 0; start < entries.length; start += columns) {
    const row = entries.slice(start, start + columns);
    const height = Math.max(
      ROW_MIN_HEIGHT,
      ...row.map((entry) => entryTextHeight(doc, entry, columnWidth) + 5),
    );
    doc.reserve(height);
    const top = doc.y;
    row.forEach((entry, index) => {
      const x = doc.contentLeft + index * (columnWidth + COLUMN_GAP);
      drawEntry(doc, entry, x, top, columnWidth);
      slots.push({
        key: ruleGroupKey(entry.group),
        page: doc.pageNumber,
        x: x + columnWidth - PAGE_WIDTH,
        y: top,
      });
    });
    doc.moveTo(top + height);
  }
  return slots;
}

/** Writes "p. N" beside each index row: the page its problem's first card is on. */
export function fillIndexPages(
  doc: ReportDocument,
  copy: ReportCopy,
  slots: readonly IndexPageSlot[],
  firstPages: ReadonlyMap<string, number>,
): void {
  for (const slot of slots) {
    const page = firstPages.get(slot.key);
    if (page === undefined) continue;
    doc.onPage(slot.page, () => {
      doc.textAt(copy.pageRef(page), slot.x, slot.y, {
        size: 8.5,
        colour: 'muted',
        width: PAGE_WIDTH,
        align: 'right',
      });
    });
  }
}

function entryTextHeight(doc: ReportDocument, entry: IndexEntry, width: number): number {
  return doc.heightOf(entry.text, {
    size: 8.5,
    width: width - PIPS_WIDTH - COUNT_WIDTH - PAGE_WIDTH,
  });
}

function drawEntry(
  doc: ReportDocument,
  entry: IndexEntry,
  x: number,
  top: number,
  width: number,
): void {
  const colour = severityColour(entry.group.severity);
  doc.pips(x, top + 1.5, SEVERITY_LEVEL[entry.group.severity] ?? 0, colour);
  doc.textAt(entry.text, x + PIPS_WIDTH, top, {
    size: 8.5,
    width: width - PIPS_WIDTH - COUNT_WIDTH - PAGE_WIDTH,
  });
  doc.textAt(`× ${entry.group.count}`, x + width - PAGE_WIDTH - COUNT_WIDTH, top, {
    size: 8.5,
    colour: 'muted',
    width: COUNT_WIDTH,
    align: 'right',
  });
}
