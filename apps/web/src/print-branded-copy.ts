import { createContext, useContext } from 'react';
import { findingsCopy } from './findings-copy';
import { actionPlanCopy } from './action-plan-copy';
import { reportFailureCopy } from './report-failure-copy';
import { copy, type Language } from './i18n';

export const PrintBrandedContext = createContext(false);

function findingsFor(language: Language, branded: boolean) {
  const original = findingsCopy[language];
  const print = !branded
    ? original.print
    : {
        ...original.print,
        generated: (date: string) => (language === 'uk' ? `Створено ${date}` : `Generated ${date}`),
        noFindings:
          language === 'uk'
            ? 'Аудит не знайшов нічого вартого звіту на сторінках, які зміг прочитати.'
            : 'The audit found nothing to report on the pages it could read.',
        footer:
          language === 'uk'
            ? 'Цей аудит читає лише публічні сторінки. Знахідки описують те, що було видно під час перевірки; це не юридичний висновок і не сертифікація.'
            : 'This audit reads public pages only. Findings describe what was observed at scan time; they are not a legal or certification statement.',
      };
  return {
    print,
    severity: original.severity,
    fixFirst: { pages: original.fixFirst.pages },
    issues: { summaryNone: original.issues.summaryNone, summaryLine: original.issues.summaryLine },
  };
}

function failureFor(language: Language, branded: boolean) {
  const original = reportFailureCopy[language];
  const base = {
    heading: original.heading,
    kinds: original.kinds,
    nothingChecked: original.nothingChecked,
    printNoProblems: original.printNoProblems,
    httpStatus: original.httpStatus,
  };
  if (!branded) return base;
  return {
    ...base,
    heading: language === 'uk' ? 'Сайт не вдалося відкрити' : 'The site could not be opened',
    kinds: {
      'blocked-by-robots':
        language === 'uk'
          ? 'Файл robots.txt сайту забороняє краулеру аудиту його читати, і аудит це враховує.'
          : "The site's robots.txt asks the audit crawler not to read it, and the audit follows that.",
      'bad-response':
        language === 'uk'
          ? 'Сайт відповів, але не сторінкою, яку аудит міг прочитати: наприклад, сторінкою помилки або файлом замість сторінки.'
          : 'The site answered, but not with a page the audit could read: for example an error page, or a file instead of a page.',
      unknown:
        language === 'uk'
          ? 'Аудит не зміг прочитати жодної сторінки сайту, а перевірка не записала, чому.'
          : 'The audit could not read any page of the site, and the scan did not record why.',
      'access-denied':
        language === 'uk'
          ? 'Сайт відповів статусом, який зазвичай означає відмову (наприклад, 401, 403, 429 або 503). Найчастіше це файрвол або захист від ботів перед сайтом; іноді це вхід за паролем або перевантажений сервер.'
          : original.kinds['access-denied'].replace('Your site', 'The site'),
      unreachable: original.kinds.unreachable
        .replace('Your site', 'The site')
        .replace('Ваш сайт', 'Сайт'),
    },
    nothingChecked:
      language === 'uk'
        ? 'Нічого не перевірено: ця перевірка не дала результатів, тож не може показати список проблем. Це не означає, що проблем немає.'
        : 'Nothing was checked: this scan produced no results, so it cannot list problems. That does not mean there are none.',
    printNoProblems:
      language === 'uk'
        ? 'Проблем у списку немає, бо нічого не перевірено, а не тому, що їх немає.'
        : 'No problems are listed because nothing was checked, not because there are none.',
  };
}

function actionFor(language: Language, branded: boolean) {
  const original = actionPlanCopy[language];
  return {
    heading: original.heading,
    aiLabel: original.aiLabel,
    caveat: original.caveat,
    overviewHeading: original.overviewHeading,
    actionsHeading: original.actionsHeading,
    effortLabel: original.effortLabel,
    effort: original.effort,
    openIssues: original.openIssues,
    settled: original.settled,
    reach: original.reach,
    generatedAt: branded
      ? (when: string) => (language === 'uk' ? `Написано ${when}.` : `Written ${when}.`)
      : original.generatedAt,
  };
}

export function printCopyFor(language: Language, branded: boolean) {
  return {
    findings: findingsFor(language, branded),
    failure: failureFor(language, branded),
    actionPlan: actionFor(language, branded),
    preparedBy: (name: string) =>
      language === 'uk' ? `Підготовлено: ${name}` : `Prepared by ${name}`,
  };
}

const printCopies = {
  en: { branded: printCopyFor('en', true), plain: printCopyFor('en', false) },
  uk: { branded: printCopyFor('uk', true), plain: printCopyFor('uk', false) },
};
export function usePrintCopy(language: Language) {
  return printCopies[language][useContext(PrintBrandedContext) ? 'branded' : 'plain'];
}

/** Explicit inventory for the sweep: only keys the print/score/comparison paths read. */
export function printSharedCopy(language: Language) {
  const report = copy[language].report;
  return {
    report: Object.fromEntries(
      Object.entries(report).filter(
        ([key]) =>
          key.startsWith('geo') ||
          ['comparison', 'noScore', 'unscoredLabel', 'informationalLabel'].includes(key),
      ),
    ),
    scanProgress: copy[language].scanProgress,
  };
}
