// What the home page's slider says the made-up salon's report holds beyond its
// six problems: what two AI assistants answered about it, three of its security
// checks, the first steps of an AI action plan, and the message for a developer.
//
// The slider is a preview of the same `bloom-nails.example` the full example
// report describes (`example-report-fixture.ts`), for the reason
// `example-home-preview.ts` gives: two invented reports about one invented site
// is one too many. So the plan steps and the developer message are read off
// that fixture's own problems and its real generated message, and what is new
// here — the AI answers and the security rows — is data the full example does
// not draw at all.
//
// What is new adds no problem. The full example is a Complete report, which
// runs Security and asks AI assistants, and both it and the slider's first
// slide say "6 problems found". A security check that failed, or an answer
// that left the salon out or did not link its site (GEO-VIS-003 and GEO-VIS-004
// report each such answer), would be a seventh the full example does not list.
// So the types below admit only a check that passed and an answer that named
// the salon and linked one of its pages: a row that would add a problem cannot
// be written here without changing them.
//
// Every rule id is one the product runs and every provider is one a paid scan
// asks by default; `hero-offer.test.tsx` checks both against the source lists.

import { AI_PROCESSING_PROVIDERS } from './ai-processing-notice';
import { exampleReportContent } from './example-report-content';
import { EXAMPLE_DOMAIN, EXAMPLE_SUMMARY } from './example-report-fixture';
import type { Language } from './i18n';

/** One AI assistant's answer, which named the salon and linked one of its pages. */
export interface ExampleAiAnswer {
  readonly provider: (typeof AI_PROCESSING_PROVIDERS)[number];
  /** The salon's own page the answer linked to. */
  readonly citedPage: string;
}

/**
 * The question a customer would ask, in the language of the page it is shown
 * on. Data rather than copy: it is what this salon's report asked, not a label.
 */
export const EXAMPLE_AI_QUESTION: Readonly<Record<Language, string>> = {
  en: 'Recommend a nail salon with online booking',
  uk: 'Порадь салон манікюру з онлайн-записом',
  ru: 'Посоветуй салон маникюра с онлайн-записью',
};

/**
 * The two assistants a paid scan asks by default, in the order the notice
 * names them. Both named the salon and linked one of its pages, each a page
 * the full example's crawl read.
 */
export const EXAMPLE_AI_ANSWERS: readonly ExampleAiAnswer[] = [
  { provider: 'anthropic', citedPage: `${EXAMPLE_DOMAIN}/prices` },
  { provider: 'openai', citedPage: `${EXAMPLE_DOMAIN}/contact` },
];

/** One security check of the salon's report, which it passed. */
export interface ExampleSecurityRow {
  readonly ruleId: string;
}

/** Three of the eight Security checks, each one a check the salon's site passed. */
export const EXAMPLE_SECURITY_ROWS: readonly ExampleSecurityRow[] = [
  { ruleId: 'SEC-PASSIVE-001' },
  { ruleId: 'SEC-PASSIVE-003' },
  { ruleId: 'SEC-PASSIVE-007' },
];

/** One step of the action plan: a problem of the example, and how much of it is open. */
export interface ExamplePlanStep {
  readonly ruleId: string;
  readonly open: number;
  readonly total: number;
}

/**
 * The plan's first three steps are the three problems the home page already
 * previews, with the open/total counts the real plan prints from the summary —
 * findings, not pictures, so the image problem is three of three, one per page.
 */
const PLAN_RULE_IDS: readonly string[] = ['SEO-TECH-006', 'SEO-ONPAGE-002', 'SEO-ONPAGE-005'];

function planStep(ruleId: string): ExamplePlanStep {
  const group = EXAMPLE_SUMMARY.groups.find((candidate) => candidate.ruleId === ruleId);
  if (group === undefined) {
    throw new Error(`the example has no ${ruleId} to put in its action plan`);
  }
  return { ruleId, open: group.openIssues, total: group.issues };
}

export const EXAMPLE_PLAN_STEPS: readonly ExamplePlanStep[] = PLAN_RULE_IDS.map(planStep);

/** The three lines of the developer message the slide shows, and the whole of it. */
export interface ExampleDeveloperTask {
  readonly heading: string;
  readonly where: string;
  readonly whatToDo: string;
  /** The full message, as the full example prints it and the button copies it. */
  readonly text: string;
}

/**
 * An extract of the real message (`developer-task.ts`, and its Russian
 * composer), not a paraphrase: its first line names the task, its third says
 * how far it reaches, and its last paragraph says what to do. The slide is too
 * small for the example addresses and the check's technical name, which the
 * copied text still carries.
 */
function developerTaskExtract(language: Language): ExampleDeveloperTask {
  const text = exampleReportContent[language].developerTask;
  const lines = text.split('\n');
  const heading = lines[0];
  const where = lines[2];
  const whatToDo = lines.at(-1);
  if (heading === undefined || where === undefined || whatToDo === undefined) {
    throw new Error(`the example's developer message in ${language} is not the expected shape`);
  }
  return { heading, where, whatToDo, text };
}

export const EXAMPLE_DEVELOPER_TASK: Readonly<Record<Language, ExampleDeveloperTask>> = {
  en: developerTaskExtract('en'),
  uk: developerTaskExtract('uk'),
  ru: developerTaskExtract('ru'),
};
