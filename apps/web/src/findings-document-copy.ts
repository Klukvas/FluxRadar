// The half of the findings copy that belongs to the report, not to the app.
//
// Two blocks live here: the printable client report, and the message the
// "copy task for developer" button puts on the clipboard. Both are documents
// the owner hands on — one printed, one pasted into a chat — and both stand
// around sentences the API wrote (a rule's name, a finding's evidence, its
// recommendation). So they exist in the two languages a report exists in, and
// a Russian reader reads the Ukrainian one (`report-language.ts`).
//
// That is why the record is keyed by `ReportLanguage`: a caller holding an
// interface language cannot index it without saying `reportLanguage(language)`
// first, which is exactly the mapping that must not be forgotten. The chrome
// around these two blocks — the buttons that open them, their hints, the
// toasts, and the print route's own toolbar — is in `findings-copy.ts` and is
// translated.

import { takesUkSingular, type Language } from './i18n';
import { reportLanguage, type ReportLanguage } from './report-language';

export type FindingsDocumentCopy = {
  /**
   * The message the copy button produces, assembled in `developer-task.ts`.
   * The button, its hint and its failure state are chrome and live elsewhere.
   */
  readonly task: {
    readonly heading: (title: string) => string;
    readonly check: (technicalTitle: string, ruleId: string) => string;
    /** Every finding is loaded: the page count is exact. */
    readonly whereComplete: (findings: number, pages: number) => string;
    /** Only part is loaded, but one finding is one page: the total is the page count. */
    readonly wherePages: (pages: number) => string;
    /** Only part is loaded and findings are not pages: say both, and which is partial. */
    readonly wherePartial: (findings: number, loaded: number, pages: number) => string;
    /** No summary and only part loaded: the loaded open findings are a lower bound. */
    readonly whereAtLeast: (loaded: number, pages: number) => string;
    /** Open findings exist, none of them loaded: only the count is known. */
    readonly whereOpen: (findings: number) => string;
    readonly examples: string;
    readonly found: string;
    /** The plain-language advice, sent along when no localized recommendation exists. */
    readonly advice: string;
    readonly recommendation: string;
  };
  /**
   * The printable client report: its cover and its pages.
   *
   * Not its toolbar. The window around the document — Back, Print, the loading
   * and failure lines, the retry — is interface chrome and is translated, so it
   * lives in `findings-copy.ts` under `print.toolbar`. The name the browser
   * offers for the saved file stays here: it names the document.
   */
  readonly print: {
    readonly documentTitle: (domain: string) => string;
    readonly preparedFor: (domain: string) => string;
    readonly generated: (date: string) => string;
    readonly plan: string;
    readonly scanned: string;
    readonly score: string;
    readonly noScore: string;
    readonly coverage: string;
    readonly summaryHeading: string;
    readonly sectionsHeading: string;
    readonly section: string;
    readonly result: string;
    readonly problemsHeading: string;
    readonly problemsLead: string;
    readonly affectedPages: (count: number) => string;
    readonly morePages: (count: number) => string;
    readonly evidence: string;
    readonly recommendation: string;
    readonly noFindings: string;
    readonly truncated: (shown: number, total: number) => string;
    readonly footer: string;
  };
};

const enPages = (count: number): string => (count === 1 ? 'page' : 'pages');
const enFindings = (count: number): string => (count === 1 ? 'finding' : 'findings');

/** Locative, after «на»: «на 1 сторінці», «на 61 сторінці», «на 5 сторінках». */
const ukPagesOn = (count: number): string => (takesUkSingular(count) ? 'сторінці' : 'сторінках');

const EN: FindingsDocumentCopy = {
  task: {
    heading: (title) => `Task: ${title}`,
    check: (technicalTitle, ruleId) => `FluxRadar check: ${technicalTitle} (${ruleId})`,
    whereComplete: (findings, pages) =>
      findings === pages
        ? `Found on ${pages} ${enPages(pages)}.`
        : `${findings} ${enFindings(findings)} on ${pages} ${enPages(pages)}.`,
    wherePages: (pages) => `Found on ${pages} ${enPages(pages)}.`,
    wherePartial: (findings, loaded, pages) =>
      `${findings} open ${enFindings(findings)}; the ${loaded} open ${loaded === 1 ? 'one loaded so far is' : 'ones loaded so far are'} on ${pages} ${enPages(pages)}.`,
    whereAtLeast: (loaded, pages) =>
      `At least ${loaded} open ${enFindings(loaded)} on ${pages} ${enPages(pages)}; only part of the list is loaded.`,
    whereOpen: (findings) => `${findings} open ${enFindings(findings)}.`,
    examples: 'Example pages:',
    found: 'What was found:',
    advice: 'What to do:',
    recommendation: 'Recommendation:',
  },
  print: {
    documentTitle: (domain) => `Website audit — ${domain}`,
    preparedFor: (domain) => `Public website audit of ${domain}`,
    generated: (date) => `Generated ${date} by FluxRadar`,
    plan: 'Plan',
    scanned: 'Scanned',
    score: 'Score',
    noScore: 'Not scored',
    coverage: 'Coverage',
    summaryHeading: 'Summary',
    sectionsHeading: 'Sections',
    section: 'Section',
    result: 'Result',
    problemsHeading: 'Problems and fixes',
    problemsLead:
      'Most urgent first. Each problem lists the pages it was found on, one piece of evidence and the recommended fix.',
    affectedPages: (count) => `${count} ${enPages(count)}`,
    morePages: (count) => `…and ${count} more`,
    evidence: 'Evidence',
    recommendation: 'Fix',
    noFindings: 'FluxRadar found nothing to report on the pages it could read.',
    truncated: (shown, total) =>
      `This document lists the first ${shown} of ${total} findings. The full list is in the Issue Center and the CSV export.`,
    footer:
      'FluxRadar reads public pages only. Findings describe what was observed at scan time; they are not a legal or certification statement.',
  },
};

const UK: FindingsDocumentCopy = {
  task: {
    heading: (title) => `Завдання: ${title}`,
    check: (technicalTitle, ruleId) => `Перевірка FluxRadar: ${technicalTitle} (${ruleId})`,
    whereComplete: (findings, pages) =>
      findings === pages
        ? `Знайдено на ${pages} ${ukPagesOn(pages)}.`
        : `Знахідок: ${findings}, на ${pages} ${ukPagesOn(pages)}.`,
    wherePages: (pages) => `Знайдено на ${pages} ${ukPagesOn(pages)}.`,
    wherePartial: (findings, loaded, pages) =>
      `Відкритих знахідок: ${findings}; серед завантажених відкрито ${loaded} — на ${pages} ${ukPagesOn(pages)}.`,
    whereAtLeast: (loaded, pages) =>
      `Відкритих знахідок: щонайменше ${loaded}, на ${pages} ${ukPagesOn(pages)}; завантажено лише частину списку.`,
    whereOpen: (findings) => `Відкритих знахідок: ${findings}.`,
    examples: 'Приклади сторінок:',
    found: 'Що знайдено:',
    advice: 'Що зробити:',
    recommendation: 'Рекомендація:',
  },
  print: {
    documentTitle: (domain) => `Аудит сайту — ${domain}`,
    preparedFor: (domain) => `Аудит публічного сайту ${domain}`,
    generated: (date) => `Створено ${date} у FluxRadar`,
    plan: 'Тариф',
    scanned: 'Перевірено',
    score: 'Оцінка',
    noScore: 'Без оцінки',
    coverage: 'Покриття',
    summaryHeading: 'Підсумок',
    sectionsHeading: 'Розділи',
    section: 'Розділ',
    result: 'Результат',
    problemsHeading: 'Проблеми та виправлення',
    problemsLead:
      'Спершу найтерміновіші. Для кожної проблеми — сторінки, де її знайдено, один доказ і рекомендоване виправлення.',
    affectedPages: (count) => `Сторінок: ${count}`,
    morePages: (count) => `…і ще ${count}`,
    evidence: 'Доказ',
    recommendation: 'Виправлення',
    noFindings: 'FluxRadar не знайшов нічого вартого звіту на сторінках, які зміг прочитати.',
    truncated: (shown, total) =>
      `У документі перші ${shown} з ${total} знахідок. Повний список — у Центрі проблем і в експорті CSV.`,
    footer:
      'FluxRadar читає лише публічні сторінки. Знахідки описують те, що було видно під час перевірки; це не юридичний висновок і не сертифікація.',
  },
};

/**
 * The two languages the printable report and the developer's message exist in.
 *
 * Keyed by `ReportLanguage` on purpose: index it with `reportLanguage(language)`
 * and a Russian interface reads the Ukrainian document, which is the contract
 * `PrintReport.russian.test.tsx` pins for the article.
 */
export const findingsDocumentCopy: Readonly<Record<ReportLanguage, FindingsDocumentCopy>> = {
  en: EN,
  uk: UK,
};

/** The document copy for a reader of `language`, mapped through the report language. */
export function findingsDocumentCopyFor(language: Language): FindingsDocumentCopy {
  return findingsDocumentCopy[reportLanguage(language)];
}
