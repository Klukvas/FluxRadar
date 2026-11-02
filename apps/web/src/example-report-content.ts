// What the public example report says about its six invented problems.
//
// The page is assembled from the real report's components over a typed fixture,
// so everything on it comes from the catalogues the product itself reads. That
// holds for English and Ukrainian here too: the entries below are *derived*
// from `problemTitle`, `findingExplainer`, `ruleTitle` and the real
// `developerTaskText`, so the two languages a report exists in cannot drift
// away from the product by way of this file.
//
// Russian is the one branch written by hand. A report is Ukrainian for a
// Russian reader (`report-language.ts`), which left this page showing six
// Ukrainian problems inside a Russian document — the one page on the site whose
// whole job is to be read by somebody who has not bought anything yet. The
// translation lives in `example-report-copy.ru.ts` and carries the note that
// says it is one.
//
// Nothing else changes language: the report screen, the Issue Center, the
// printable document, the PDF and the emails are still handed
// `reportLanguage(language)`, and `russian-api-boundary.test.tsx` and
// `PrintReport.russian.test.tsx` pin that.

import { developerTaskText } from './developer-task';
import {
  russianExampleFindings,
  russianExampleNote,
  russianExampleTask,
} from './example-report-copy.ru';
import { EXAMPLE_ISSUES, EXAMPLE_RULE_IDS, EXAMPLE_SUMMARY } from './example-report-fixture';
import type { IssueRuleGroup } from './api';
import { findingExplainer, problemTitle } from './finding-explainers';
import type { Language } from './i18n';
import type { ReportLanguage } from './report-language';
import { ruleTitle } from './rule-titles';

/** One problem of the example, in the words the page prints for it. */
export interface ExampleFinding {
  readonly title: string;
  /** The rule's own name, shown only in the page's technical fold. */
  readonly ruleTitle: string;
  readonly what: string;
  readonly fix: string;
  readonly why: string;
}

export interface ExampleReportContent {
  /**
   * The disclosure a translated example owes its reader, or null in the two
   * languages a report is actually written in, which owe none.
   */
  readonly translationNote: string | null;
  readonly findings: Readonly<Record<string, ExampleFinding>>;
  /** The ready message for the first, most urgent problem. */
  readonly developerTask: string;
}

/** The problem the page shows a ready message for: the first of the summary. */
function messageProblem(): IssueRuleGroup {
  const group = EXAMPLE_SUMMARY.groups[0];
  if (group === undefined) {
    throw new Error('the example report has no problem to write a developer message about');
  }
  return group;
}

const MESSAGE_PROBLEM = messageProblem();

/** Its findings, one per affected address, as the Issue Center receives them. */
const MESSAGE_ISSUES = EXAMPLE_ISSUES.filter((issue) => issue.ruleId === MESSAGE_PROBLEM.ruleId);

function reportFinding(ruleId: string, language: ReportLanguage): ExampleFinding {
  const explainer = findingExplainer(ruleId, language);
  // Every rule of the fixture is explained in plain language, which
  // `example-report.truthfulness.test.tsx` pins against the real registry; a
  // rule that lost its explanation would otherwise show a blank card.
  if (explainer === null) {
    throw new Error(`the example report has no plain-language explanation of ${ruleId}`);
  }
  return {
    title: problemTitle(ruleId, language),
    ruleTitle: ruleTitle(ruleId, language),
    what: explainer.what,
    fix: explainer.fix,
    why: explainer.why,
  };
}

function findingsOf(
  read: (ruleId: string) => ExampleFinding,
): Readonly<Record<string, ExampleFinding>> {
  return Object.fromEntries(EXAMPLE_RULE_IDS.map((ruleId) => [ruleId, read(ruleId)]));
}

/** The example as the product itself words it, in one of a report's languages. */
function reportContent(language: ReportLanguage): ExampleReportContent {
  const message = developerTaskText({
    ruleId: MESSAGE_PROBLEM.ruleId,
    language,
    issues: MESSAGE_ISSUES,
    // Every finding of the problem is in the fixture, so the message states its
    // reach exactly, and the number in it is the number on the card above.
    allLoaded: true,
    openFindings: MESSAGE_PROBLEM.openIssues,
  });
  if (message === null) {
    throw new Error(`the example report has no developer message for ${MESSAGE_PROBLEM.ruleId}`);
  }
  return {
    translationNote: null,
    findings: findingsOf((ruleId) => reportFinding(ruleId, language)),
    developerTask: message,
  };
}

/** The example translated, with the note that says the real report is not. */
function russianContent(): ExampleReportContent {
  const findings = findingsOf((ruleId) => {
    const finding = russianExampleFindings[ruleId];
    if (finding === undefined) {
      throw new Error(`the Russian example has no words for ${ruleId}`);
    }
    return finding;
  });
  const first = findings[MESSAGE_PROBLEM.ruleId];
  if (first === undefined) {
    throw new Error(`the Russian example has no words for ${MESSAGE_PROBLEM.ruleId}`);
  }
  return {
    translationNote: russianExampleNote,
    findings,
    developerTask: russianExampleTask({
      title: first.title,
      ruleTitle: first.ruleTitle,
      ruleId: MESSAGE_PROBLEM.ruleId,
      findings: MESSAGE_PROBLEM.openIssues,
      // Every distinct address, uncut, because that is what the real generator
      // counts the reach from; it lists only the first few, and so does the
      // Russian composer. Cutting here made the two disagree the moment a
      // problem reached a fourth page.
      targets: [...new Set(MESSAGE_ISSUES.map((issue) => issue.targetUrl))],
      what: first.what,
      fix: first.fix,
    }),
  };
}

export const exampleReportContent: Readonly<Record<Language, ExampleReportContent>> = {
  en: reportContent('en'),
  uk: reportContent('uk'),
  ru: russianContent(),
};

function titlesOf(language: Language): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(exampleReportContent[language].findings).map(([ruleId, finding]) => [
      ruleId,
      finding.title,
    ]),
  );
}

/**
 * Every problem's plain name, for the report's own "Fix these first" block.
 *
 * That block names a problem through the catalogue, as a report must; here the
 * rows link down this page, so they are handed the names this page prints.
 */
export const exampleProblemTitles: Readonly<Record<Language, Readonly<Record<string, string>>>> = {
  en: titlesOf('en'),
  uk: titlesOf('uk'),
  ru: titlesOf('ru'),
};
