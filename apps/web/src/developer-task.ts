// The text an owner hands to whoever will fix one problem.
//
// An owner who has understood a problem still has to explain it to someone else,
// and the Issue Center's rows are the wrong thing to forward: one per page,
// headlined for the owner. This is one message per problem — what it is, how far
// it reaches, where to look and what the check recommends — written for the
// developer, so it keeps the rule's technical name and id beside the plain one.
//
// It describes the work still to do, so a finding the owner ignored, marked
// false or the scanner resolved is neither counted nor offered as an example.
// And it only says what the loaded findings support: the page count is exact
// when every finding of the problem is loaded, or when one finding is one page;
// otherwise it says which part of the count is partial.

import type { Issue } from './api';
import { findingCountsPages, findingExplainer, problemTitle } from './finding-explainers';
import { findingsCopy } from './findings-copy';
import type { Language } from './i18n';
import { ruleTitle } from './rule-titles';

/** How many example addresses the task lists. */
export const TASK_EXAMPLE_LIMIT = 3;

/**
 * The statuses of a finding that still asks for work — the same three the
 * summary's `openIssues` counts (`IssueRuleGroup`).
 */
export const OPEN_STATUSES: readonly string[] = ['New', 'Acknowledged', 'Reopened'];

export interface DeveloperTaskInput {
  readonly ruleId: string;
  readonly language: Language;
  /** The problem's findings loaded so far, of any status, in the order the API sent them. */
  readonly issues: readonly Issue[];
  /** Whether `issues` is every finding of the problem (`meta.total` reached). */
  readonly allLoaded: boolean;
  /**
   * The problem's open findings, loaded or not — the summary's `openIssues` —
   * or null when there is no summary (an older API, or the summary failed), and
   * only the loaded findings are known.
   */
  readonly openFindings: number | null;
}

function openOf(issues: readonly Issue[]): readonly Issue[] {
  return issues.filter((issue) => OPEN_STATUSES.includes(issue.status));
}

function distinctTargets(issues: readonly Issue[]): readonly string[] {
  return [...new Set(issues.map((issue) => issue.targetUrl))];
}

/**
 * Whether the problem is known to have nothing open — every finding ignored,
 * marked false or resolved — so there is no task to hand on.
 */
export function nothingOpen(input: DeveloperTaskInput): boolean {
  if (input.openFindings !== null) return input.openFindings === 0;
  return input.allLoaded && openOf(input.issues).length === 0;
}

function whereLine(input: DeveloperTaskInput, open: readonly Issue[], pages: number): string {
  const t = findingsCopy[input.language].task;
  // A summary fetched before a finding was reopened can lag behind the page:
  // never claim fewer open findings than are loaded.
  const total = input.openFindings === null ? null : Math.max(input.openFindings, open.length);
  // Open findings exist, but none is among the loaded ones: only the count is known.
  if (open.length === 0) {
    return findingCountsPages(input.ruleId) ? t.wherePages(total ?? 0) : t.whereOpen(total ?? 0);
  }
  if (input.allLoaded) return t.whereComplete(open.length, pages);
  // No summary: the loaded part is all that is known, and it says so.
  if (total === null) return t.whereAtLeast(open.length, pages);
  if (findingCountsPages(input.ruleId)) return t.wherePages(total);
  return t.wherePartial(total, open.length, pages);
}

function examplesBlock(language: Language, targets: readonly string[]): readonly string[] {
  if (targets.length === 0) return [];
  const t = findingsCopy[language].task;
  return ['', t.examples, ...targets.slice(0, TASK_EXAMPLE_LIMIT).map((target) => `- ${target}`)];
}

/**
 * The task as plain text, ready for the clipboard; null when no open finding is
 * loaded and none is known to be open past what is loaded.
 *
 * Open findings that sit past the loaded page still make a task: it says how
 * many are open and leaves out the examples it does not have.
 */
export function developerTaskText(input: DeveloperTaskInput): string | null {
  const open = openOf(input.issues);
  if (open.length === 0 && (input.openFindings ?? 0) === 0) return null;
  const t = findingsCopy[input.language].task;
  const targets = distinctTargets(open);
  const explainer = findingExplainer(input.ruleId, input.language);
  // The recommendation comes from an open finding only: an AI rule's advice is
  // per finding, and a settled or rejected one must not be handed on. With no
  // open finding loaded the task goes without it, and the plain advice stands in.
  const first = open[0];
  // The API renders the recommendation per language from message codes; an
  // older finding, or one written by AI, has only its stored text, which may
  // be in another language. Then the plain-language advice goes along too, so
  // the task still says what to do in the reader's language.
  const localized = first?.localized?.[input.language]?.recommendation ?? null;
  const recommendation = first === undefined ? '' : (localized ?? first.recommendation).trim();
  const advice = localized === null && explainer !== null ? explainer.fix : null;
  const lines = [
    t.heading(problemTitle(input.ruleId, input.language)),
    t.check(ruleTitle(input.ruleId, input.language), input.ruleId),
    whereLine(input, open, targets.length),
    ...examplesBlock(input.language, targets),
    ...(explainer === null ? [] : ['', `${t.found} ${explainer.what}`]),
    ...(advice === null ? [] : ['', `${t.advice} ${advice}`]),
    ...(recommendation === '' ? [] : ['', `${t.recommendation} ${recommendation}`]),
  ];
  return lines.join('\n');
}
