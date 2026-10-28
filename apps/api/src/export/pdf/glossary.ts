// The last page's glossary: the handful of technical words the findings use,
// each in one plain line, for a reader who meets them for the first time.

import type { ReportCopy } from './copy.ts';
import type { ReportDocument } from './document.ts';

const TERM_SHARE = 0.26;
const ROW_GAP = 6;

export function glossarySection(doc: ReportDocument, copy: ReportCopy): void {
  doc.heading(copy.glossary.heading, 2);
  const termWidth = doc.contentWidth * TERM_SHARE;
  const meaningX = doc.contentLeft + termWidth;
  const meaningWidth = doc.contentWidth - termWidth;
  for (const entry of copy.glossary.entries) {
    const height = Math.max(
      doc.heightOf(entry.term, { font: 'bold', size: 9, width: termWidth - 10 }),
      doc.heightOf(entry.meaning, { size: 9, width: meaningWidth, lineGap: 1.5 }),
    );
    doc.reserve(height + ROW_GAP);
    const top = doc.y;
    doc.textAt(entry.term, doc.contentLeft, top, { font: 'bold', size: 9, width: termWidth - 10 });
    doc.textAt(entry.meaning, meaningX, top, { size: 9, width: meaningWidth, lineGap: 1.5 });
    doc.moveTo(top + height + ROW_GAP);
  }
}
