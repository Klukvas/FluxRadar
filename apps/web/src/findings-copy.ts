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
    readonly groupCount: (open: number, total: number) => string;
    readonly groupSettled: (total: number) => string;
    readonly showFindings: string;
    readonly showFindingsFor: (title: string) => string;
    readonly learnMore: string;
    readonly summaryLine: (open: number, groups: number) => string;
    readonly summaryNone: string;
    readonly statusUpdated: string;
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
      columnPages: 'Findings',
      groupCount: (open, total) => (open === total ? `${total} open` : `${open} open of ${total}`),
      groupSettled: (total) => `${total} settled`,
      showFindings: 'Show findings',
      showFindingsFor: (title) => `Show findings: ${title}`,
      learnMore: 'How this is checked',
      summaryLine: (open, groups) =>
        `${open} open ${open === 1 ? 'finding' : 'findings'} across ${groups} ${groups === 1 ? 'problem' : 'problems'}.`,
      summaryNone: 'Nothing is left open in this report.',
      statusUpdated: 'Status saved.',
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
      ],
      action: (plan) => `Run ${plan} for this site`,
      compare: 'Compare plans',
    },
    print: {
      open: 'Client report (PDF)',
      openHint:
        'A printable version of this report. Use your browser’s print dialog to save it as a PDF.',
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
      columnPages: 'Знахідки',
      groupCount: (open, total) =>
        open === total ? `${total} відкрито` : `${open} відкрито з ${total}`,
      groupSettled: (total) => `${total} закрито`,
      showFindings: 'Показати знахідки',
      showFindingsFor: (title) => `Показати знахідки: ${title}`,
      learnMore: 'Як це перевіряється',
      summaryLine: (open, groups) => `Відкритих знахідок: ${open}, проблем: ${groups}.`,
      summaryNone: 'У цьому звіті нічого не лишилося відкритим.',
      statusUpdated: 'Статус збережено.',
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
      ],
      action: (plan) => `Запустити ${plan} для цього сайту`,
      compare: 'Порівняти тарифи',
    },
    print: {
      open: 'Звіт для клієнта (PDF)',
      openHint:
        'Версія цього звіту для друку. Щоб зберегти PDF, скористайтеся діалогом друку браузера.',
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
