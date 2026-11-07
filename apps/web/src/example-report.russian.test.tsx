// The public example report (/ru/example-report) — the one report that is
// translated, and the line that keeps it honest.
//
// Everywhere else a Russian reader gets a Russian interface around a Ukrainian
// report: the finding sentences, the printable document, the PDF and the emails
// are the report's own words (`report-language.ts`). This page is the exception
// on purpose. It exists for somebody deciding whether to buy, and asking them
// to judge the product through six Ukrainian problems inside a Russian document
// is asking them to read the language they chose not to.
//
// So the example fixture is translated, and the page says so where it cannot be
// missed. What this file pins is both halves of that: the Russian words are
// really there, and nothing outside the example moved with them.

import { afterEach, describe, expect, it } from 'vitest';

import { TASK_EXAMPLE_LIMIT, developerTaskText } from './developer-task';
import { exampleReportCopy } from './example-report-copy';
import {
  russianExampleFindings,
  russianExampleNote,
  russianExampleTask,
} from './example-report-copy.ru';
import { exampleProblemTitles, exampleReportContent } from './example-report-content';
import { EXAMPLE_ISSUES, EXAMPLE_RULE_IDS, EXAMPLE_SUMMARY } from './example-report-fixture';
import {
  EXAMPLE_CSS,
  cleanupExamplePage,
  openExample,
  unfoldEveryProblem,
} from './example-report-test-support';
import { findingExplainer, problemTitle } from './finding-explainers';
import { findingsCopy } from './findings-copy';
import { findingsDocumentCopy, findingsDocumentCopyFor } from './findings-document-copy';
import { reportLanguage } from './report-language';
import { ruleTitle } from './rule-titles';

afterEach(cleanupExamplePage);

/** Letters Ukrainian has and Russian does not: a half-edited paste shows up here. */
const UKRAINIAN_ONLY = /[іїєґ]/i;

/** The document itself, with every fold open. Not the page chrome: the language
 * switcher names «Українська», which is a language's own name for itself. */
function openDocument(): HTMLElement {
  unfoldEveryProblem();
  const technical = document.querySelector('.example-technical');
  technical?.setAttribute('open', '');
  const article = document.querySelector('.example-report');
  if (article === null) throw new Error('expected the example document');
  return article as HTMLElement;
}

describe('the Russian example report', () => {
  it('names every problem in Russian, on the card and in the row above it', async () => {
    await openExample('ru');
    const document_ = openDocument();

    expect(EXAMPLE_RULE_IDS).toHaveLength(6);
    for (const ruleId of EXAMPLE_RULE_IDS) {
      const finding = russianExampleFindings[ruleId];
      if (finding === undefined) throw new Error(`no Russian words for ${ruleId}`);
      expect(document_.textContent, ruleId).toContain(finding.title);
      // And it is not the Ukrainian one, which is what the page used to print.
      expect(document_.textContent, ruleId).not.toContain(problemTitle(ruleId, 'uk'));
    }

    // "Fix these first" is the report's own block, so it names a problem
    // through the catalogue; here it is handed the names this page prints, or a
    // row would link down to a card with a different headline on it.
    const rows = Array.from(
      document.querySelectorAll('.fix-first__title'),
      (row) => row.textContent,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.values(exampleProblemTitles.ru)).toContain(row);
    }
  });

  it('holds no Ukrainian letters anywhere in the document', async () => {
    await openExample('ru');
    const text = openDocument().textContent ?? '';

    const offending = text
      .split(/(?<=[.!?»:])\s+/)
      .filter((sentence) => UKRAINIAN_ONLY.test(sentence));
    expect(offending).toEqual([]);
    // The walker has to be able to see one, or the check above is vacuous.
    expect(UKRAINIAN_ONLY.test(problemTitle('SEO-TECH-006', 'uk'))).toBe(true);
  });

  // The honesty constraint: the words below are a translation and the report
  // the reader will be sent is not. On the page, above the report, and not
  // folded into a disclosure they have to open.
  it('says on the page that the example is translated and the real report is not', async () => {
    await openExample('ru');
    // Queried by class, not by role: the EXAMPLE banner above is a note too,
    // and role="note" takes no name from its content.
    const note = document.querySelector('.example-translation');
    if (note === null) throw new Error('expected the translation note');

    expect(note.textContent).toBe(russianExampleNote);
    expect(note.getAttribute('role')).toBe('note');
    expect(note.closest('details')).toBeNull();
    // First inside the document, before the score and before anything that
    // could be mistaken for a result.
    const article = document.querySelector('.example-report');
    expect(article?.firstElementChild).toBe(note);
    // And the two disclosures that were already on the page agree with it.
    expect(exampleReportCopy.ru.exampleBody).toContain('на украинском');
    expect(exampleReportCopy.ru.scoreCallout).toContain('на украинском');
    expect(exampleReportCopy.ru.scoreCallout).toContain('переведён на русский');
  });

  // Its own palette, so it is not read as another "what it means" aside about
  // the number beside it.
  it('draws the note in the banner’s warning palette', () => {
    const rule = EXAMPLE_CSS.slice(
      EXAMPLE_CSS.indexOf('.example-translation {'),
      EXAMPLE_CSS.indexOf('}', EXAMPLE_CSS.indexOf('.example-translation {')),
    );
    expect(rule).toMatch(/background: var\(--warn-fill\);/);
    expect(rule).toMatch(/color: var\(--warn-text\);/);
    expect(rule).toMatch(/border-left-color: var\(--warn-line\);/);
  });

  it('writes the ready message for a developer in Russian', async () => {
    await openExample('ru');
    const task = document.querySelector('.example-task');
    if (task === null) throw new Error('expected the developer message');
    const first = EXAMPLE_SUMMARY.groups[0];
    if (first === undefined) throw new Error('expected a problem to write about');
    const finding = russianExampleFindings[first.ruleId];
    if (finding === undefined) throw new Error('expected Russian words for it');

    expect(task.textContent).toContain(`Задача: ${finding.title}`);
    expect(task.textContent).toContain(`(${first.ruleId})`);
    expect(task.textContent).toContain(finding.what);
    expect(task.textContent).toContain(finding.fix);
    // The same reach the card above it states, counted from the same list.
    expect(task.textContent).toContain(`Найдено на ${first.openIssues} страницах.`);
    expect(UKRAINIAN_ONLY.test(task.textContent ?? '')).toBe(false);
  });

  // How far a problem reaches is counted over every address it was found on,
  // and only the examples list is cut to three. The fixture's first problem has
  // exactly three pages, so a composer handed the already-cut list agreed with
  // the real generator by coincidence; a fourth page is where it stopped.
  it('states the same reach as the real generator past the example limit', () => {
    const first = EXAMPLE_SUMMARY.groups[0];
    if (first === undefined) throw new Error('expected a problem to write about');
    const finding = russianExampleFindings[first.ruleId];
    if (finding === undefined) throw new Error('expected Russian words for it');

    const found = EXAMPLE_ISSUES.filter((issue) => issue.ruleId === first.ruleId);
    const third = found[2];
    if (third === undefined) throw new Error('expected the fixture problem to span three pages');
    // A fourth address for the same problem, past the three the message lists.
    const issues = [
      ...found,
      {
        ...third,
        id: 'example-finding-0-4',
        fingerprint: 'example-0-4',
        targetUrl: 'https://bloom-nails.example/vouchers',
      },
    ];
    const targets = [...new Set(issues.map((issue) => issue.targetUrl))];
    expect(targets).toHaveLength(4);

    const russian = russianExampleTask({
      title: finding.title,
      ruleTitle: finding.ruleTitle,
      ruleId: first.ruleId,
      findings: issues.length,
      targets,
      what: finding.what,
      fix: finding.fix,
    });
    const real = (language: 'en' | 'uk'): string =>
      developerTaskText({
        ruleId: first.ruleId,
        language,
        issues,
        allLoaded: true,
        openFindings: issues.length,
      }) ?? '';

    // The third line of the message is the one that states the reach.
    const reach = (message: string): string | undefined =>
      /\d+/.exec(message.split('\n')[2] ?? '')?.[0];
    expect(reach(russian)).toBe('4');
    expect(reach(real('uk'))).toBe('4');
    expect(reach(real('en'))).toBe('4');

    // And the cut that does apply, to the examples list, applies in all three.
    const examples = (message: string): number =>
      message.split('\n').filter((line) => line.startsWith('- ')).length;
    expect(examples(russian)).toBe(TASK_EXAMPLE_LIMIT);
    expect(examples(real('uk'))).toBe(TASK_EXAMPLE_LIMIT);
  });

  // The severities, the statuses and the counts were already Russian: they are
  // interface, and the example reads them from the same catalogue the Issue
  // Center does. Pinned here because the page prints them beside the
  // translated titles, where a Ukrainian word would be the obvious regression.
  it('labels how urgent each problem is in Russian', async () => {
    await openExample('ru');
    const f = findingsCopy.ru;
    for (const group of EXAMPLE_SUMMARY.groups) {
      expect(openDocument().textContent).toContain(f.severity[group.severity]);
    }
    expect(f.severity.High).toBe('Высокая');
  });

  // The glossary explains the two words the page cannot avoid. It is written
  // for the words the page actually uses, and the page's words have changed.
  it('defines only words the Russian page uses', async () => {
    await openExample('ru');
    const text = (openDocument().textContent ?? '').toLowerCase();
    const glossary = document.querySelector('.example-glossary');
    for (const inGlossary of document.querySelectorAll('.example-glossary')) inGlossary.remove();
    const rest = (openDocument().textContent ?? '').toLowerCase();

    expect(exampleReportCopy.ru.glossary.length).toBeGreaterThan(0);
    for (const entry of exampleReportCopy.ru.glossary) {
      expect(glossary?.textContent).toContain(entry.term);
      // The field's own label where the entry carries one in brackets, which is
      // what the explanations name in running text.
      const word = (/\(([^)]+)\)$/.exec(entry.term)?.[1] ?? entry.term).toLowerCase();
      expect({ term: entry.term, used: rest.includes(word) }).toEqual({
        term: entry.term,
        used: true,
      });
    }
    expect(text.length).toBeGreaterThan(rest.length);
  });
});

describe('what the translated example does not change', () => {
  // The branch this page is the exception to. If any of these moved, a customer
  // would be sent a document in a language the API does not write.
  it('leaves the report, the document and the catalogues in Ukrainian', () => {
    expect(reportLanguage('ru')).toBe('uk');
    expect(findingsDocumentCopyFor('ru')).toBe(findingsDocumentCopy.uk);
    for (const ruleId of EXAMPLE_RULE_IDS) {
      expect(problemTitle(ruleId, 'ru')).toBe(problemTitle(ruleId, 'uk'));
      expect(ruleTitle(ruleId, 'ru')).toBe(ruleTitle(ruleId, 'uk'));
      expect(findingExplainer(ruleId, 'ru')).toBe(findingExplainer(ruleId, 'uk'));
    }
  });

  // English and Ukrainian are derived from the catalogues rather than written
  // again, so the example cannot drift away from the product in those two.
  it('reads the English and Ukrainian example off the product’s own words', () => {
    for (const language of ['en', 'uk'] as const) {
      const content = exampleReportContent[language];
      expect(content.translationNote).toBeNull();
      for (const ruleId of EXAMPLE_RULE_IDS) {
        const explainer = findingExplainer(ruleId, language);
        expect(content.findings[ruleId]).toEqual({
          title: problemTitle(ruleId, language),
          ruleTitle: ruleTitle(ruleId, language),
          what: explainer?.what,
          fix: explainer?.fix,
          why: explainer?.why,
        });
      }
      const first = EXAMPLE_SUMMARY.groups[0];
      if (first === undefined) throw new Error('expected a problem to write about');
      expect(content.developerTask).toBe(
        developerTaskText({
          ruleId: first.ruleId,
          language,
          issues: EXAMPLE_ISSUES.filter((issue) => issue.ruleId === first.ruleId),
          allLoaded: true,
          openFindings: first.openIssues,
        }),
      );
    }
  });

  it('shows the Ukrainian example its own Ukrainian findings', async () => {
    await openExample('uk');
    const text = openDocument().textContent ?? '';
    for (const ruleId of EXAMPLE_RULE_IDS) {
      expect(text, ruleId).toContain(problemTitle(ruleId, 'uk'));
    }
    expect(document.querySelector('.example-translation')).toBeNull();
  });
});
