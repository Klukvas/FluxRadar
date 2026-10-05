// Copy for reading findings: the Issue Center's problem view and filters, the
// report's "fix these first" and "since your last scan" blocks, the Free
// report's next step, and the printable client report.
//
// Kept beside `i18n.ts` rather than inside it, as `support-copy.ts` is: the
// shared file is already far past the size anyone can review, and these screens
// are read together.

import type { Language } from './i18n';

export type FindingsCopy = {
  readonly severity: Readonly<Record<string, string>>;
  readonly status: Readonly<Record<string, string>>;
  readonly issues: {
    readonly lead: string;
    readonly viewLabel: string;
    readonly viewProblems: string;
    readonly viewAll: string;
    readonly searchLabel: string;
    readonly searchPlaceholder: string;
    readonly severityFilter: string;
    readonly moduleFilter: string;
    readonly statusFilter: string;
    readonly any: string;
    readonly openOnly: string;
    readonly problemFilter: (title: string) => string;
    readonly clearProblem: string;
    readonly showing: (shown: number, total: number) => string;
    readonly loadMore: (count: number) => string;
    readonly loadingMore: string;
    readonly columnProblem: string;
    readonly columnPages: string;
    /**
     * How far one problem reaches. `countsPages` is true when one finding of the
     * rule is one page (`finding-explainers.ts`), and only then is the count
     * said in pages — a cookie or a broken link is not a page.
     */
    readonly groupCount: (open: number, total: number, countsPages: boolean) => string;
    readonly groupSettled: (total: number, countsPages: boolean) => string;
    readonly showFindings: string;
    readonly showFindingsFor: (title: string) => string;
    readonly learnMore: string;
    /** The plain-language disclosure over a finding (`finding-explainers.ts`). */
    readonly explainerTitle: string;
    readonly explainerWhat: string;
    readonly explainerWhy: string;
    readonly explainerFix: string;
    readonly explainerCount: string;
    /** What the scanner read, and what it never claims to have done. */
    readonly explainerScope: string;
    /** The fold over the raw evidence, recommendation, confidence and rule id. */
    readonly technicalTitle: string;
    /** One problem's loaded findings: the pages they are on, and how they differ. */
    readonly breakdownPages: (pages: number) => string;
    readonly breakdownPagesSoFar: (pages: number) => string;
    readonly breakdownVariants: string;
    readonly breakdownSame: string;
    readonly variantFindings: (count: number) => string;
    readonly variantsMore: (count: number) => string;
    readonly summaryLine: (open: number, groups: number) => string;
    readonly summaryNone: string;
    readonly statusUpdated: string;
  };
  /** The "copy task for developer" button over one open problem (`developer-task.ts`). */
  readonly task: {
    readonly copy: string;
    readonly copyFor: (title: string) => string;
    readonly copied: string;
    readonly failed: string;
    readonly textLabel: string;
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
    /** No summary, part loaded, and nothing loaded is open: there is nothing to copy yet. */
    readonly notLoaded: string;
    /** Every finding of the problem is settled: there is no task to copy. */
    readonly nothingOpen: string;
    readonly examples: string;
    readonly found: string;
    /** The plain-language advice, sent along when no localized recommendation exists. */
    readonly advice: string;
    readonly recommendation: string;
  };
  readonly fixFirst: {
    readonly heading: string;
    readonly lead: string;
    readonly none: string;
    readonly pages: (count: number) => string;
    readonly open: string;
    readonly all: (count: number) => string;
  };
  readonly changes: {
    readonly heading: string;
    readonly since: (date: string) => string;
    readonly fixed: string;
    readonly introduced: string;
    readonly persisting: string;
    readonly fixedList: string;
    readonly introducedList: string;
    readonly firstReport: string;
    /** The two crawls left from different countries: a difference, not a trend. */
    readonly egressDifferent: (current: string, previous: string) => string;
    readonly egressUnrecorded: string;
    readonly onlyPrevious: string;
    readonly onlyCurrent: string;
    readonly inBoth: string;
    readonly onlyPreviousList: string;
    readonly onlyCurrentList: string;
  };
  readonly retry: {
    readonly heading: string;
    readonly body: string;
    readonly action: string;
    readonly working: string;
  };
  readonly upsell: {
    readonly heading: string;
    readonly lead: (domain: string) => string;
    readonly points: readonly string[];
    readonly action: (plan: string) => string;
    readonly compare: string;
  };
  /**
   * The server-rendered PDF, which is a different document from the printable
   * page: it carries every finding, however many there are, while the page below
   * stops at a thousand. Both stay available — the page needs no server work and
   * is the fallback when the download is refused.
   */
  readonly download: {
    readonly pdf: string;
    readonly pdfHint: string;
    readonly preparing: string;
    readonly failed: string;
    readonly tooLarge: string;
  };
  readonly print: {
    readonly open: string;
    readonly openHint: string;
    readonly windowTitle: string;
    readonly print: string;
    readonly back: string;
    readonly loading: string;
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

/** Ukrainian numerals end in 1 (but not 11) take the singular: «на 21 сторінці». */
const takesUkSingular = (count: number): boolean => count % 10 === 1 && count % 100 !== 11;
/** Locative, after «на»: «на 1 сторінці», «на 61 сторінці», «на 5 сторінках». */
const ukPagesOn = (count: number): string => (takesUkSingular(count) ? 'сторінці' : 'сторінках');
/** Genitive, after «з»: «з 21 сторінки», «з 59 сторінок». */
const ukPagesOf = (count: number): string => (takesUkSingular(count) ? 'сторінки' : 'сторінок');

export const findingsCopy: Record<Language, FindingsCopy> = {
  en: {
    severity: { Critical: 'Critical', High: 'High', Medium: 'Medium', Low: 'Low' },
    status: {
      New: 'New',
      Acknowledged: 'Acknowledged',
      Ignored: 'Ignored',
      'False Positive': 'False positive',
      Resolved: 'Resolved',
      Reopened: 'Reopened',
    },
    issues: {
      lead: 'Findings are grouped by the problem behind them, most urgent first. Open a problem to see every page it affects, the evidence and the fix. The status you set is remembered on your next full scan.',
      viewLabel: 'Show',
      viewProblems: 'Problems',
      viewAll: 'Every finding',
      searchLabel: 'Search',
      searchPlaceholder: 'page URL, rule or evidence',
      severityFilter: 'Severity',
      moduleFilter: 'Section',
      statusFilter: 'Status',
      any: 'Any',
      openOnly: 'Open',
      problemFilter: (title) => `Problem: ${title}`,
      clearProblem: 'Show every problem',
      showing: (shown, total) => `Showing ${shown} of ${total}`,
      loadMore: (count) => `Show ${count} more`,
      loadingMore: 'Loading…',
      columnProblem: 'Problem',
      columnPages: 'Where',
      groupCount: (open, total, countsPages) =>
        countsPages
          ? open === total
            ? `On ${total} ${enPages(total)}`
            : `Open on ${open} of ${total} ${enPages(total)}`
          : open === total
            ? `${total} open ${enFindings(total)}`
            : `${open} of ${total} ${enFindings(total)} open`,
      groupSettled: (total, countsPages) =>
        countsPages
          ? `Settled on ${total} ${enPages(total)}`
          : `All ${total} ${enFindings(total)} settled`,
      showFindings: 'Show findings',
      showFindingsFor: (title) => `Show findings: ${title}`,
      learnMore: 'How this is checked',
      explainerTitle: 'What this means in plain language',
      explainerWhat: 'What the check found',
      explainerWhy: 'Why it matters',
      explainerFix: 'What to do',
      explainerCount: 'What one finding is',
      explainerScope:
        'FluxRadar reads the public responses of the pages this scan crawled. These findings describe what those responses carried at the time; nothing was attacked, logged into or tested for whether it can be exploited, and pages outside this scan’s scope were not read.',
      technicalTitle: 'Technical details for your developer',
      breakdownPages: (pages) =>
        `These findings are on ${pages} ${pages === 1 ? 'page' : 'pages'}.`,
      breakdownPagesSoFar: (pages) =>
        `${pages} ${pages === 1 ? 'page' : 'pages'} in the findings loaded so far — load the rest to count every page.`,
      breakdownVariants: 'What differs between pages',
      breakdownSame: 'Every finding loaded here recorded the same evidence.',
      variantFindings: (count) => `${count} ${count === 1 ? 'finding' : 'findings'}`,
      variantsMore: (count) => `…and ${count} more`,
      summaryLine: (open, groups) =>
        `${open} open ${open === 1 ? 'finding' : 'findings'} across ${groups} ${groups === 1 ? 'problem' : 'problems'}.`,
      summaryNone: 'Nothing is left open in this report.',
      statusUpdated: 'Status saved.',
    },
    task: {
      copy: 'Copy task for developer',
      copyFor: (title) => `Copy task for developer: ${title}`,
      copied: 'Task copied. Paste it into a message to your developer.',
      failed:
        'The task could not be copied automatically. Select the text below and copy it yourself.',
      textLabel: 'Task for your developer',
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
      notLoaded: 'No open finding is loaded yet. Show more findings to copy a task.',
      nothingOpen: 'Nothing is open for this problem, so there is no task to copy.',
      examples: 'Example pages:',
      found: 'What was found:',
      advice: 'What to do:',
      recommendation: 'Recommendation:',
    },
    fixFirst: {
      heading: 'Fix these first',
      lead: 'The most urgent problems in this report. Each one is a single fix that clears every page it lists.',
      none: 'No open problems — nothing in this report is waiting for a fix.',
      pages: (count) => `${count} ${count === 1 ? 'finding' : 'findings'}`,
      open: 'Open',
      all: (count) => `All ${count} problems`,
    },
    changes: {
      heading: 'Since your last scan',
      since: (date) => `Compared with the report of ${date}.`,
      fixed: 'Fixed',
      introduced: 'New',
      persisting: 'Still open',
      fixedList: 'Fixed since then',
      introducedList: 'New since then',
      firstReport:
        'This is the first report of this plan for the site. Run the next one after your fixes and this block will show what changed.',
      egressDifferent: (current, previous) =>
        `This check ran from ${current}, the previous one from ${previous}. A site can answer visitors from different countries differently — language, redirects, consent banners, blocks — so the findings below differ between two places, not over time. Do not read them as fixed or new.`,
      egressUnrecorded:
        'The country one of these checks ran from was not recorded, so part of the difference may come from the network it ran from rather than from changes to the site.',
      onlyPrevious: 'Only in the previous report',
      onlyCurrent: 'Only in this report',
      inBoth: 'In both',
      onlyPreviousList: 'Only in the previous report',
      onlyCurrentList: 'Only in this report',
    },
    retry: {
      heading: 'A section could not be read',
      body: 'At least one section of this report came back incomplete — the cards below say which and why. You can run the unfinished section once more, at no extra charge.',
      action: 'Retry the unfinished section',
      working: 'Starting the retry…',
    },
    upsell: {
      heading: 'What the free check did not look at',
      lead: (domain) =>
        `The free check read four things on the homepage of ${domain}. The rest of the site — and security, accessibility, performance, privacy and AI visibility — has not been checked yet.`,
      points: [
        'Every public page, not just the homepage — up to 50,000 pages',
        'Security headers, accessibility (WCAG 2.2 AA), performance, privacy and content',
        'A score, a prioritised list of problems and a client-ready report',
        'On Complete, an AI Action Plan: the findings as an ordered list of changes, with an overview for your client',
      ],
      action: (plan) => `Run ${plan} for this site`,
      compare: 'Compare plans',
    },
    download: {
      pdf: 'Download full report (PDF)',
      pdfHint:
        'Rendered on the server with every finding of this scan, including anything past the printable page’s limit of 1 000.',
      preparing: 'Preparing the PDF…',
      failed: 'The PDF could not be prepared. Use the printable report below, or try again.',
      tooLarge:
        'This scan has more findings than one PDF can hold. The JSON and CSV exports contain all of them.',
    },
    print: {
      open: 'Printable report',
      openHint:
        'A printable version of this report, limited to the first 1 000 findings. Use your browser’s print dialog to save it as a PDF.',
      windowTitle: 'Client report',
      print: 'Print or save as PDF',
      back: 'Back to the report',
      loading: 'Preparing the report…',
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
      affectedPages: (count) => `${count} ${count === 1 ? 'page' : 'pages'}`,
      morePages: (count) => `…and ${count} more`,
      evidence: 'Evidence',
      recommendation: 'Fix',
      noFindings: 'FluxRadar found nothing to report on the pages it could read.',
      truncated: (shown, total) =>
        `This document lists the first ${shown} of ${total} findings. The full list is in the Issue Center and the CSV export.`,
      footer:
        'FluxRadar reads public pages only. Findings describe what was observed at scan time; they are not a legal or certification statement.',
    },
  },
  uk: {
    severity: { Critical: 'Критична', High: 'Висока', Medium: 'Середня', Low: 'Низька' },
    status: {
      New: 'Нова',
      Acknowledged: 'Прийнята',
      Ignored: 'Ігнорується',
      'False Positive': 'Хибна',
      Resolved: 'Виправлена',
      Reopened: 'Повернулася',
    },
    issues: {
      lead: 'Знахідки згруповано за проблемою, що їх спричинила, — спершу найтерміновіші. Відкрийте проблему, щоб побачити всі сторінки, докази та виправлення. Встановлений вами статус збережеться під час наступної повної перевірки.',
      viewLabel: 'Показати',
      viewProblems: 'Проблеми',
      viewAll: 'Усі знахідки',
      searchLabel: 'Пошук',
      searchPlaceholder: 'URL сторінки, правило чи доказ',
      severityFilter: 'Критичність',
      moduleFilter: 'Розділ',
      statusFilter: 'Статус',
      any: 'Будь-яка',
      openOnly: 'Відкриті',
      problemFilter: (title) => `Проблема: ${title}`,
      clearProblem: 'Показати всі проблеми',
      showing: (shown, total) => `Показано ${shown} з ${total}`,
      loadMore: (count) => `Показати ще ${count}`,
      loadingMore: 'Завантаження…',
      columnProblem: 'Проблема',
      columnPages: 'Де знайдено',
      groupCount: (open, total, countsPages) =>
        countsPages
          ? open === total
            ? `На ${total} ${ukPagesOn(total)}`
            : `Відкрито на ${open} з ${total} ${ukPagesOf(total)}`
          : open === total
            ? `Відкритих знахідок: ${total}`
            : `Відкрито знахідок: ${open} з ${total}`,
      groupSettled: (total, countsPages) =>
        countsPages ? `Закрито на ${total} ${ukPagesOn(total)}` : `Усі знахідки закрито (${total})`,
      showFindings: 'Показати знахідки',
      showFindingsFor: (title) => `Показати знахідки: ${title}`,
      learnMore: 'Як це перевіряється',
      explainerTitle: 'Що це означає простою мовою',
      explainerWhat: 'Що знайшла перевірка',
      explainerWhy: 'Чому це важливо',
      explainerFix: 'Що зробити',
      explainerCount: 'Що означає одна знахідка',
      explainerScope:
        'FluxRadar читає публічні відповіді тих сторінок, які обійшла ця перевірка. Знахідки описують те, що було в цих відповідях на той момент; жодної атаки, входу в акаунт чи перевірки на можливість зламу не виконувалося, а сторінки поза областю цієї перевірки не читалися.',
      technicalTitle: 'Технічні деталі для вашого розробника',
      breakdownPages: (pages) => `Сторінок із цими знахідками: ${pages}.`,
      breakdownPagesSoFar: (pages) =>
        `Сторінок серед завантажених знахідок: ${pages} — завантажте решту, щоб порахувати всі.`,
      breakdownVariants: 'Чим відрізняються сторінки',
      breakdownSame: 'Усі завантажені тут знахідки мають однаковий записаний доказ.',
      variantFindings: (count) => `знахідок: ${count}`,
      variantsMore: (count) => `…і ще ${count}`,
      summaryLine: (open, groups) => `Відкритих знахідок: ${open}, проблем: ${groups}.`,
      summaryNone: 'У цьому звіті нічого не лишилося відкритим.',
      statusUpdated: 'Статус збережено.',
    },
    task: {
      copy: 'Скопіювати завдання для розробника',
      copyFor: (title) => `Скопіювати завдання для розробника: ${title}`,
      copied: 'Завдання скопійовано. Вставте його в повідомлення розробнику.',
      failed:
        'Не вдалося скопіювати завдання автоматично. Виділіть текст нижче й скопіюйте його самостійно.',
      textLabel: 'Завдання для вашого розробника',
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
      notLoaded:
        'Відкритих знахідок ще не завантажено. Покажіть більше знахідок, щоб скопіювати завдання.',
      nothingOpen: 'Для цієї проблеми нічого не відкрито, тож і завдання копіювати нічого.',
      examples: 'Приклади сторінок:',
      found: 'Що знайдено:',
      advice: 'Що зробити:',
      recommendation: 'Рекомендація:',
    },
    fixFirst: {
      heading: 'Виправте це першим',
      lead: 'Найтерміновіші проблеми цього звіту. Кожна — одне виправлення, яке закриває всі перелічені сторінки.',
      none: 'Відкритих проблем немає — у цьому звіті ніщо не чекає на виправлення.',
      pages: (count) => `Знахідок: ${count}`,
      open: 'Відкрити',
      all: (count) => `Усі проблеми (${count})`,
    },
    changes: {
      heading: 'Після попередньої перевірки',
      since: (date) => `Порівняно зі звітом від ${date}.`,
      fixed: 'Виправлено',
      introduced: 'Нові',
      persisting: 'Досі відкриті',
      fixedList: 'Виправлено відтоді',
      introducedList: 'Нове відтоді',
      firstReport:
        'Це перший звіт цього тарифу для сайту. Запустіть наступний після виправлень — і тут буде видно, що змінилося.',
      egressDifferent: (current, previous) =>
        `Ця перевірка йшла з точки «${current}», попередня — з точки «${previous}». Сайт може по-різному відповідати відвідувачам з різних країн — мова, редиректи, банери згоди, блокування, — тож нижче різниця між двома місцями, а не зміни в часі. Не читайте її як «виправлено» чи «нове».`,
      egressUnrecorded:
        'Країну, з якої йшла одна з цих перевірок, не зафіксовано, тож частина різниці може бути пов’язана з мережею перевірки, а не зі змінами на сайті.',
      onlyPrevious: 'Лише в попередньому звіті',
      onlyCurrent: 'Лише в цьому звіті',
      inBoth: 'В обох',
      onlyPreviousList: 'Лише в попередньому звіті',
      onlyCurrentList: 'Лише в цьому звіті',
    },
    retry: {
      heading: 'Один розділ не вдалося прочитати',
      body: 'Щонайменше один розділ цього звіту повернувся неповним — картки нижче показують, який саме і чому. Незавершений розділ можна один раз перезапустити без доплати.',
      action: 'Перезапустити незавершений розділ',
      working: 'Запускаємо повтор…',
    },
    upsell: {
      heading: 'Чого безкоштовна перевірка не торкалася',
      lead: (domain) =>
        `Безкоштовна перевірка прочитала чотири речі на головній сторінці ${domain}. Решту сайту — а також безпеку, доступність, швидкодію, приватність і видимість в AI — ще не перевірено.`,
      points: [
        'Усі публічні сторінки, а не лише головна — до 50 000 сторінок',
        'Заголовки безпеки, доступність (WCAG 2.2 AA), швидкодія, приватність і контент',
        'Оцінка, пріоритезований список проблем і звіт, який можна віддати клієнту',
        'У Complete — план дій від ШІ: знахідки як упорядкований список змін з оглядом для вашого клієнта',
      ],
      action: (plan) => `Запустити ${plan} для цього сайту`,
      compare: 'Порівняти тарифи',
    },
    download: {
      pdf: 'Завантажити повний звіт (PDF)',
      pdfHint:
        'Формується на сервері й містить усі знахідки цього сканування, у тому числі понад ліміт сторінки для друку — 1 000.',
      preparing: 'Готуємо PDF…',
      failed:
        'Не вдалося підготувати PDF. Скористайтеся версією для друку нижче або спробуйте ще раз.',
      tooLarge:
        'У цьому скануванні більше знахідок, ніж може вмістити один PDF. Експорти JSON і CSV містять усі.',
    },
    print: {
      open: 'Версія для друку',
      openHint:
        'Версія цього звіту для друку, обмежена першою 1 000 знахідок. Щоб зберегти PDF, скористайтеся діалогом друку браузера.',
      windowTitle: 'Звіт для клієнта',
      print: 'Друк або збереження в PDF',
      back: 'Назад до звіту',
      loading: 'Готуємо звіт…',
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
  },
};
