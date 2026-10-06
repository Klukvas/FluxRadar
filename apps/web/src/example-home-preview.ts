// The home page's preview of the example report, with its numbers filled in.
//
// The preview and the full example describe the same made-up salon, and they
// described it differently: "4 pages have no description" on the home page over
// a fixture that said seven, "3 links lead to a page that no longer exists"
// over a fixture that agreed by accident, and "12 photos have no text
// description" over a fixture with no photo problem at all — while the full
// example's glossary defined "alt text" for nobody. A visitor who followed the
// link met a second invented report about one invented site.
//
// So the copy carries a `{count}` on each line's "Where" (the titles carry no
// number, so no count can disagree with their grammar) and the numbers come
// from the fixture the full example is drawn from (`EXAMPLE_HOME_PREVIEW`).
// `home-plain-language.test.tsx` reads both and fails if the preview ever
// stops being an extract of the example.

import { EXAMPLE_HOME_PREVIEW, type ExamplePreviewLine } from './example-report-fixture';
import { copy, fillCopy, type Language } from './i18n';

/** One finding of the preview, as the block draws it. */
export interface HomePreviewFinding {
  readonly ruleId: string;
  readonly tone: string;
  readonly severity: string;
  readonly where: string;
  readonly title: string;
  readonly action: string;
}

/**
 * How urgent the line says a problem is, from the problem's own severity.
 *
 * Two words rather than four, because the preview is not the report: it is
 * three lines on a marketing page, and "Fix first" against "Worth fixing" is
 * the distinction a reader can act on. The severity itself comes from the
 * fixture, so a line cannot say "Fix first" over a problem the full example
 * shows as the least urgent of six.
 */
function toneFor(line: ExamplePreviewLine): 'high' | 'medium' {
  return line.severity === 'Critical' || line.severity === 'High' ? 'high' : 'medium';
}

/** The three findings the home page shows, in the full example's own order. */
export function homePreviewFindings(language: Language): readonly HomePreviewFinding[] {
  const t = copy[language].home.example;
  return EXAMPLE_HOME_PREVIEW.lines.map((line, index) => {
    const text = t.findings[index];
    if (text === undefined) {
      throw new Error(`the home example has no line ${index + 1} to fill`);
    }
    const tone = toneFor(line);
    const values = { count: line.count };
    return {
      ruleId: line.ruleId,
      tone,
      severity: tone === 'high' ? t.severityFixFirst : t.severityWorthFixing,
      where: fillCopy(text.where, values),
      title: fillCopy(text.title, values),
      action: text.action,
    };
  });
}

/**
 * The line over the window: how big the site is, and how many problems the
 * full example has. Labelled as the full example's count, because the list
 * under it draws only three of them.
 */
export function homePreviewSummary(language: Language): string {
  return fillCopy(copy[language].home.example.summary, {
    problems: EXAMPLE_HOME_PREVIEW.problems,
    pages: EXAMPLE_HOME_PREVIEW.pagesRead,
  });
}

/**
 * What the block's own lead says: that these three are an extract.
 *
 * It used to read "Findings in plain words, with what to do", which is true of
 * three findings and of six, so a visitor had no way to tell that the page they
 * were on showed half of what the link led to.
 */
export function homePreviewLead(language: Language): string {
  return fillCopy(copy[language].home.example.lead, {
    shown: EXAMPLE_HOME_PREVIEW.lines.length,
    problems: EXAMPLE_HOME_PREVIEW.problems,
  });
}
