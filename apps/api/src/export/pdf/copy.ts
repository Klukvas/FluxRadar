// The downloadable report's own words, in the two report languages.
//
// Kept apart from the renderer so a translation is a data change rather than a
// layout change, and so a missing string is a type error rather than an English
// sentence appearing in a Ukrainian document — which is exactly what happened to
// the Google panel in the browser report before its copy was moved out of the
// component.
//
// EVERY STRING THE LAYOUT ITSELF PUTS ON A PAGE IS HERE: headings, table column
// labels, device names, the totals sentences and the notices. Five catalogues
// live next door instead, all of them because they are keyed by a producer's own
// vocabulary rather than by a place in the layout: the Bing findings, whose
// sentences are rebuilt per finding code from their evidence numbers
// (`bing-findings.ts`); the Performance findings, rebuilt the same way per PERF
// rule id (`performance-findings.ts`); the scan/module statuses with their
// `status_reason` clauses (`status-text.ts`); why a search provider produced no
// figures, keyed by its connection state (`provider-state.ts`); and what a
// section and a problem are called, keyed by module name and rule id
// (`names.ts`). Between this file and those five, nothing a reader meets is
// written in English by accident.
// What stays untranslated is deliberately narrow —
// product names (Search Console, Analytics 4, Chrome UX Report, Bing Webmaster
// Tools) and metric acronyms (LCP, TTFB, TBT, INP, CLS, CTR, URL), which are the
// same tokens in both languages and are what a reader would search the
// provider's own console for.

import type { LegacyPlan } from '@fluxradar/contracts';
import type { FindingLanguage } from '@fluxradar/rules';

import type { IncomparableCode } from '../../integrations/performance/index.ts';
import { ukAfterCount, ukPlural, ukStillOpen } from './plural.ts';

export interface ReportCopy {
  readonly aiGenerated: string;
  readonly documentTitle: (domain: string) => string;
  readonly preparedFor: (domain: string) => string;
  /** The fact-row label above the moment the document was written. */
  readonly generatedLabel: string;
  readonly plan: string;
  /** A retired plan's name on an old report (stored-plan.ts). */
  readonly legacyPlans: Readonly<Record<LegacyPlan, string>>;
  readonly scanned: string;
  readonly score: string;
  readonly noScore: string;
  readonly coverage: string;
  readonly summaryHeading: string;
  /** Under the open count: what that number counts, agreed with it. */
  readonly openCaption: (open: number, groups: number) => string;
  readonly summaryNone: string;
  readonly openLabel: string;
  readonly bySeverityLabel: string;
  /** "64 of 100": never a spaced slash, which the footer counter is read by. */
  readonly scoreOutOf: (score: number) => string;
  /** The caps label over the overall score: the tile says which score it is. */
  readonly overallScoreLabel: string;
  /** Under a provisional overall score: too few checks ran to call it settled. */
  readonly overallProvisional: string;
  /** Instead of the overall score when too few checks ran to compute one. */
  readonly overallInsufficient: string;
  /** "First step: <action> (plan, p. 2)", under the verdict when a plan prints. */
  readonly firstStep: (title: string, page: number) => string;
  /** The index's page reference for the first card of a problem. */
  readonly pageRef: (page: number) => string;
  /**
   * One sentence under the summary that says what to do first, chosen by the
   * worst severity present, then the weakest scored section.
   */
  readonly verdict: {
    readonly critical: (count: number) => string;
    readonly high: (count: number) => string;
    readonly minor: string;
    readonly clear: string;
    readonly weakest: (label: string, score: number) => string;
  };
  /** What each severity asks of the reader, in the browser report's words. */
  readonly severityMeaning: string;
  /** The orientation box on page one, for a reader who is not technical. */
  readonly howToRead: string;
  /** The same note for a report that has no action plan to point to. */
  readonly howToReadNoPlan: string;
  readonly sectionsHeading: string;
  readonly sectionsLead: (sections: number) => string;
  readonly scoreLegend: string;
  /** Appended to the score legend when it fits: what the ticks on the bars mark. */
  readonly scoreTicks: string;
  readonly coverageLegend: string;
  readonly findingsIndexHeading: string;
  /** Plain one-line meanings of the terms the findings use, for the last page. */
  readonly glossary: {
    readonly heading: string;
    readonly entries: readonly { readonly term: string; readonly meaning: string }[];
  };
  readonly section: string;
  readonly result: string;
  readonly problemsHeading: string;
  readonly problemsLead: string;
  readonly noFindings: string;
  readonly completeNote: (total: number) => string;
  readonly affectedPages: (affected: number, applicable: number) => string;
  /** Instead of the page count, for a finding about the site as a whole (TLS, DNS). */
  readonly wholeSite: string;
  readonly evidence: string;
  readonly recommendation: string;
  readonly status: string;
  /**
   * `Info` is a Performance finding's own level, not a scored one: the rules
   * engine never writes it, and a finding that carries it is a statement about
   * the measurement rather than a defect the score was cut for.
   */
  readonly severity: Readonly<Record<'Critical' | 'High' | 'Medium' | 'Low' | 'Info', string>>;
  readonly performanceHeading: string;
  /** Stated when the audit measured each page and device more than once. */
  readonly performanceLead: string;
  /**
   * Stated instead when it measured them once. A deployment with no PageSpeed
   * API key runs exactly one run per page and device, and the section must not
   * open by describing medians of repeated runs it never took.
   */
  readonly performanceLeadSingleRun: string;
  readonly performanceNoField: string;
  readonly performanceRegressions: string;
  readonly searchDataHeading: string;
  readonly googleHeading: string;
  readonly bingHeading: string;
  readonly bingFindingsHeading: string;
  /** Why these are notes: Bing is informational and never scored. */
  readonly bingFindingsNote: string;
  readonly bingSeverity: Readonly<Record<'info' | 'attention', string>>;
  /**
   * Stated when Bing answered with a site but without its daily traffic. The
   * totals are left blank rather than shown as zero, and this says which read is
   * missing — the same sentence the browser panel shows.
   */
  readonly bingTrafficUnavailable: string;
  readonly noData: string;
  readonly actionPlanHeading: string;
  readonly actionPlanReach: (addressed: number, total: number) => string;
  readonly actionPlanProgress: (open: number, total: number) => string;
  /** Which rule ids an action closes: the link from the plan to the findings. */
  readonly actionPlanCovers: (ruleIds: string) => string;
  readonly actionPlanSettled: string;
  readonly actionPlanEffort: Readonly<Record<'small' | 'medium' | 'large', string>>;
  readonly performanceComparisonNone: (reason: string) => string;
  /**
   * Why the two scans may not be compared, per the code the audit stored. The
   * stored English sentence beside it is the fallback for a report written before
   * the code existed, and for a code a later release adds.
   */
  readonly incomparable: Readonly<
    Record<IncomparableCode, (previous: string | null, current: string | null) => string>
  >;
  readonly performanceUrls: string;
  readonly performanceInstability: string;
  readonly footer: string;
  // ── Table column labels ───────────────────────────────────────────────────
  readonly url: string;
  readonly device: string;
  readonly runs: string;
  readonly query: string;
  readonly clicks: string;
  readonly impressions: string;
  /** The emulated device a lab measurement was taken on. */
  readonly deviceName: Readonly<Record<'mobile' | 'desktop', string>>;
  /**
   * A duration and a transfer size in the reader's own units — "1.9 s" / "1.9 с",
   * "320 kB" / "320 кБ". One source for both the metric tables and the finding
   * sentences, so the same figure is not written two ways in one document.
   */
  readonly duration: (milliseconds: number) => string;
  readonly size: (bytes: number) => string;
  // ── Sentences that state provider figures ─────────────────────────────────
  readonly fieldDataLabel: string;
  readonly searchConsoleLabel: string;
  readonly analyticsLabel: string;
  readonly searchConsoleTotals: (clicks: number, impressions: number, ctr: string) => string;
  readonly analyticsTotals: (users: number, sessions: number, pageViews: number) => string;
  readonly bingTotals: (clicks: number, impressions: number, days: number) => string;
  readonly performanceRegression: (
    metric: string,
    device: string,
    url: string,
    previous: string,
    current: string,
  ) => string;
  /**
   * Stated when the Bing property feeding the report is not the profile's own
   * domain. A subdomain property is a legitimate choice, so this explains rather
   * than refuses.
   */
  readonly bingSiteMismatch: (site: string, domain: string) => string;
  // ── The notice for characters no packaged font can draw ───────────────────
  readonly unsupportedGlyphsHeading: string;
  readonly unsupportedGlyphs: (count: number) => string;
}

const EN: ReportCopy = {
  aiGenerated: 'Prepared by our AI agent',
  documentTitle: (domain) => `FluxRadar report — ${domain}`,
  preparedFor: (domain) => `Website report for ${domain}`,
  generatedLabel: 'Generated',
  plan: 'Plan',
  legacyPlans: { WebsiteAudit: 'Website Audit (archived)', Legacy: 'Archived plan' },
  scanned: 'Scanned',
  score: 'Score',
  noScore: 'Not scored',
  coverage: 'Checks done',
  summaryHeading: 'Summary',
  openCaption: (open, groups) =>
    groups < open
      ? `findings in ${groups} different ${groups === 1 ? 'problem' : 'problems'}`
      : open === 1
        ? 'finding'
        : 'findings',
  summaryNone: 'No open findings.',
  openLabel: 'Open',
  bySeverityLabel: 'By severity',
  scoreOutOf: (score) => `${score} of 100`,
  overallScoreLabel: 'Overall score',
  overallProvisional: 'provisional',
  overallInsufficient: 'Not enough data for an overall score',
  firstStep: (title, page) => `First step: ${title} (plan, p. ${page})`,
  pageRef: (page) => `p. ${page}`,
  verdict: {
    critical: (count) =>
      count === 1
        ? 'There is 1 critical finding. Fix it first; the rest can wait.'
        : `There are ${count} critical findings. Fix those first; the rest can wait.`,
    high: (count) =>
      count === 1
        ? 'Nothing critical, but 1 important finding is worth fixing soon.'
        : `Nothing critical, but ${count} important findings are worth fixing soon.`,
    minor: 'No serious findings. What remains can be fixed at a normal pace.',
    clear: 'No open findings: on these checks the site is in order.',
    weakest: (label, score) => `Weakest section: ${label} (${score} of 100).`,
  },
  severityMeaning:
    'Critical: fix it before anything else. High: fix it soon. Medium: worth fixing. Low: can wait.',
  howToRead:
    'How to read this report. Page 1: how the site is doing. After that: the action plan and ' +
    'every problem with its page, evidence and fix, for whoever maintains the site. A code such ' +
    'as SEO-TECH-015 is for the developer only.',
  howToReadNoPlan:
    'How to read this report. Page 1: how the site is doing. After that: every problem with its ' +
    'page, evidence and fix, for whoever maintains the site. A code such as SEO-TECH-015 is for ' +
    'the developer only.',
  sectionsHeading: 'Sections',
  sectionsLead: (sections) =>
    sections === 1
      ? '1 area checked.'
      : `${sections} areas checked. Look at the lowest scores first.`,
  scoreLegend:
    'Score 0–100, higher is better. 0–49: needs attention. 50–74: room to fix. 75–100: good.',
  scoreTicks: 'Ticks on the bars: 50 and 75.',
  coverageLegend:
    "Checks done: the share of this section's checks that could run. Not the share of pages checked.",
  findingsIndexHeading: 'Findings index',
  glossary: {
    heading: 'Terms used in this report',
    entries: [
      {
        term: 'TLS certificate',
        meaning:
          'The digital document that lets the browser show a padlock and encrypt the connection to the site.',
      },
      {
        term: 'robots.txt',
        meaning: 'A file with rules for search engine crawlers: which pages they may read.',
      },
      { term: 'title', meaning: 'The page name shown in the browser tab and in search results.' },
      {
        term: 'meta description',
        meaning: 'A short summary of the page that search engines may show under its title.',
      },
      { term: 'viewport', meaning: 'A setting that fits the page to the width of a phone screen.' },
      {
        term: 'SPF/DMARC',
        meaning: 'Domain records that confirm email sent in your name is genuine.',
      },
      { term: 'H1', meaning: 'The main heading on the page itself; usually one per page.' },
      {
        term: 'Open Graph',
        meaning: 'Tags that messengers and social networks read to build a link preview.',
      },
      {
        term: 'cookies',
        meaning:
          "Small files a site stores in the visitor's browser; some need the visitor's consent.",
      },
      {
        term: 'contrast',
        meaning: 'The difference between text and background colour; too little is hard to read.',
      },
      {
        term: 'LocalBusiness',
        meaning:
          "Markup that tells search engines and AI assistants a business's name, address and opening hours.",
      },
    ],
  },
  section: 'Section',
  result: 'Result',
  problemsHeading: 'Findings',
  problemsLead:
    'Each problem: where it was found, what the check saw, and what to do. Hand these pages to whoever maintains the site.',
  noFindings: 'The check found no problems on the pages it read.',
  completeNote: (total) =>
    `All ${total} findings are included below; nothing was left out of this document.`,
  affectedPages: (affected, applicable) =>
    `on ${affected} of ${applicable} ${applicable === 1 ? 'page' : 'pages'}`,
  wholeSite: 'whole site',
  evidence: 'What the check saw',
  recommendation: 'What to do',
  status: 'Status',
  severity: { Critical: 'Critical', High: 'High', Medium: 'Medium', Low: 'Low', Info: 'Note' },
  performanceHeading: 'Performance',
  performanceLead:
    'Lab measurements are medians of repeated Lighthouse runs on the pages listed. Field figures come from real Chrome visitors.',
  performanceLeadSingleRun:
    'Lab measurements are single Lighthouse runs — one per page and device, so there is no median and no spread to state. Field figures come from real Chrome visitors.',
  performanceNoField:
    'Interaction to Next Paint needs real visitor data and could not be measured for this site. A lab run never produces it.',
  performanceRegressions: 'Changes since the previous scan',
  searchDataHeading: 'Search data',
  googleHeading: 'Google (Search Console and Analytics)',
  bingHeading: 'Bing Webmaster Tools',
  bingFindingsHeading: 'What the Bing data shows',
  bingFindingsNote:
    'Notes, not scored findings: Bing coverage is informational in this release and takes no part in any score.',
  bingSeverity: { info: 'Note', attention: 'Worth checking' },
  bingTrafficUnavailable:
    'Bing did not return daily clicks and impressions for this period, so no totals are shown. ' +
    'They are left blank rather than shown as zero.',
  noData: 'No data',
  actionPlanHeading: 'Action plan',
  actionPlanReach: (addressed, total) =>
    addressed >= total
      ? `The plan covers all ${total} open ${total === 1 ? 'finding' : 'findings'}.`
      : `The plan covers ${addressed} of ${total} findings; the rest are listed under Findings.`,
  actionPlanProgress: (open, total) => `${open} of ${total} findings still open`,
  actionPlanCovers: (ruleIds) => `Covers: ${ruleIds}`,
  actionPlanSettled: 'every finding this addresses is closed',
  actionPlanEffort: {
    small: 'small amount of work',
    medium: 'medium amount of work',
    large: 'large amount of work',
  },
  performanceComparisonNone: (reason) => `Not compared with the previous scan: ${reason}.`,
  incomparable: {
    AuditVersionChanged: (previous, current) =>
      `the previous scan was measured by ${previous ?? '—'}, this one by ${current ?? '—'}`,
    LighthouseVersionUnrecorded: () =>
      'one of the two scans did not record a single Lighthouse version',
    LighthouseMajorChanged: (previous, current) =>
      `Lighthouse ${previous ?? '—'} measured the previous scan and Lighthouse ${current ?? '—'} this one`,
  },
  performanceUrls: 'Pages measured',
  performanceInstability: 'unstable measurement',
  footer:
    'FluxRadar — automated website audit. Manual review is still required for legal compliance.',
  url: 'URL',
  device: 'Device',
  runs: 'Runs',
  query: 'Query',
  clicks: 'Clicks',
  impressions: 'Impressions',
  deviceName: { mobile: 'Mobile', desktop: 'Desktop' },
  duration: (milliseconds) =>
    milliseconds >= 1000
      ? `${(milliseconds / 1000).toFixed(1)} s`
      : `${Math.round(milliseconds)} ms`,
  size: (bytes) =>
    bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`,
  fieldDataLabel: 'Chrome UX Report (p75)',
  searchConsoleLabel: 'Search Console',
  analyticsLabel: 'Analytics 4',
  searchConsoleTotals: (clicks, impressions, ctr) =>
    `${clicks} clicks · ${impressions} impressions · CTR ${ctr}`,
  analyticsTotals: (users, sessions, pageViews) =>
    `${users} users · ${sessions} sessions · ${pageViews} page views`,
  bingTotals: (clicks, impressions, days) =>
    `${clicks} clicks · ${impressions} impressions · ${days} days reported`,
  performanceRegression: (metric, device, url, previous, current) =>
    `${metric} on ${device} · ${url}: ${previous} → ${current}`,
  bingSiteMismatch: (site, domain) =>
    `These Bing figures come from the property ${site}, which is not ${domain}. That is a valid ` +
    'choice — a subdomain or a different host can be the property Bing verified — but the numbers ' +
    'below describe that property, not this domain.',
  unsupportedGlyphsHeading: 'Characters this document could not draw',
  unsupportedGlyphs: (count) =>
    `${count} character(s) in this report — Chinese, Japanese, Korean or emoji, for example — have ` +
    'no shape in the fonts embedded here. They are written out as Unicode escapes such as ' +
    '\\u{9801} so that nothing is lost: each escape names exactly one character, a literal ' +
    'backslash appears as \\\\ in those lines, and the JSON export carries the original text.',
};

const UK: ReportCopy = {
  aiGenerated: 'Підготовлено ШІ-агентом',
  documentTitle: (domain) => `Звіт FluxRadar — ${domain}`,
  preparedFor: (domain) => `Звіт про сайт ${domain}`,
  generatedLabel: 'Сформовано',
  plan: 'Тариф',
  legacyPlans: { WebsiteAudit: 'Website Audit (архів)', Legacy: 'Архівний тариф' },
  scanned: 'Проскановано',
  score: 'Оцінка',
  noScore: 'Без оцінки',
  coverage: 'Виконано перевірок',
  summaryHeading: 'Підсумок',
  openCaption: (open, groups) => {
    const noun = ukPlural(open, { one: 'знахідка', few: 'знахідки', many: 'знахідок' });
    return groups < open
      ? `${noun} у ${groups} ${ukAfterCount(groups, 'різній проблемі', 'різних проблемах')}`
      : noun;
  },
  summaryNone: 'Відкритих знахідок немає.',
  openLabel: 'Відкрито',
  bySeverityLabel: 'За важливістю',
  scoreOutOf: (score) => `${score} зі 100`,
  overallScoreLabel: 'Загальна оцінка',
  overallProvisional: 'попередня',
  overallInsufficient: 'Недостатньо даних для загальної оцінки',
  firstStep: (title, page) => `Перший крок: ${title} (план, с. ${page})`,
  pageRef: (page) => `с. ${page}`,
  verdict: {
    critical: (count) =>
      `Є ${count} ${ukPlural(count, {
        one: 'критична знахідка',
        few: 'критичні знахідки',
        many: 'критичних знахідок',
      })}. ${ukAfterCount(count, 'Виправте її першою', 'Виправте їх першими')}, решта може почекати.`,
    high: (count) =>
      `Критичних знахідок немає, але ${count} ${ukPlural(count, {
        one: 'важливу знахідку',
        few: 'важливі знахідки',
        many: 'важливих знахідок',
      })} варто виправити найближчим часом.`,
    minor:
      'Серйозних знахідок немає. Залишилися дрібниці, їх можна виправити у звичайному порядку.',
    clear: 'Відкритих знахідок немає: за цими перевірками сайт у порядку.',
    weakest: (label, score) => `Найслабший розділ: ${label} (${score} зі 100).`,
  },
  severityMeaning:
    'Критична: виправляйте насамперед. Висока: виправте найближчим часом. Середня: варто виправити. Низька: може почекати.',
  howToRead:
    'Як читати цей звіт. Сторінка 1: стан сайту. Далі: план дій і кожна знайдена проблема зі ' +
    'сторінкою, доказом і виправленням, для того, хто веде сайт. Код на кшталт SEO-TECH-015 ' +
    'потрібен лише розробнику.',
  howToReadNoPlan:
    'Як читати цей звіт. Сторінка 1: стан сайту. Далі: кожна знайдена проблема зі сторінкою, ' +
    'доказом і виправленням, для того, хто веде сайт. Код на кшталт SEO-TECH-015 потрібен лише ' +
    'розробнику.',
  sectionsHeading: 'Розділи',
  sectionsLead: (sections) => {
    const lead = `Перевірено ${sections} ${ukPlural(sections, {
      one: 'напрям',
      few: 'напрями',
      many: 'напрямів',
    })}.`;
    return sections === 1 ? lead : `${lead} Дивіться спочатку на найнижчі оцінки.`;
  },
  scoreLegend:
    'Оцінка від 0 до 100: що вище, то краще. 0–49: потребує уваги. 50–74: є що виправити. 75–100: добре.',
  scoreTicks: 'Позначки на смугах: 50 і 75.',
  coverageLegend:
    'Виконано перевірок: яку частку перевірок розділу вдалося виконати. Не плутати з часткою перевірених сторінок.',
  findingsIndexHeading: 'Зміст знахідок',
  glossary: {
    heading: 'Терміни цього звіту',
    entries: [
      {
        term: 'TLS-сертифікат',
        meaning:
          'Цифровий документ, завдяки якому браузер показує замок і шифрує з’єднання з сайтом.',
      },
      {
        term: 'robots.txt',
        meaning: 'Файл із правилами для пошукових роботів: які сторінки їм можна читати.',
      },
      {
        term: 'title',
        meaning: 'Заголовок сторінки, який видно у вкладці браузера та в результатах пошуку.',
      },
      {
        term: 'meta description',
        meaning: 'Короткий опис сторінки, який пошуковик може показати під заголовком.',
      },
      {
        term: 'viewport',
        meaning: 'Налаштування, яке підганяє сторінку під ширину екрана телефона.',
      },
      {
        term: 'SPF/DMARC',
        meaning: 'Записи домену, які підтверджують, що листи від вашого імені справжні.',
      },
      { term: 'H1', meaning: 'Головний заголовок на самій сторінці; зазвичай один на сторінку.' },
      {
        term: 'Open Graph',
        meaning:
          'Теги, з яких месенджери та соцмережі беруть картинку й текст для прев’ю посилання.',
      },
      {
        term: 'cookies',
        meaning:
          'Невеликі файли, які сайт зберігає в браузері відвідувача; для деяких потрібна його згода.',
      },
      {
        term: 'контраст',
        meaning: 'Різниця між кольором тексту й тла; за замалого контрасту текст важко читати.',
      },
      {
        term: 'LocalBusiness',
        meaning:
          'Розмітка, яка повідомляє пошуковикам і ШІ-асистентам назву, адресу й години роботи закладу.',
      },
    ],
  },
  section: 'Розділ',
  result: 'Результат',
  problemsHeading: 'Знахідки',
  problemsLead:
    'Кожна проблема: де знайдено, що побачила перевірка і що зробити. Передайте ці сторінки тому, хто веде сайт.',
  noFindings: 'Перевірка не знайшла проблем на прочитаних сторінках.',
  completeNote: (total) => `Нижче наведено всі знахідки (${total}); нічого не пропущено.`,
  affectedPages: (affected, applicable) =>
    `на ${affected} з ${applicable} ${ukAfterCount(applicable, 'сторінки', 'сторінок')}`,
  wholeSite: 'весь сайт',
  evidence: 'Що побачила перевірка',
  recommendation: 'Що зробити',
  status: 'Статус',
  severity: {
    Critical: 'Критична',
    High: 'Висока',
    Medium: 'Середня',
    Low: 'Низька',
    Info: 'Примітка',
  },
  performanceHeading: 'Швидкодія',
  performanceLead:
    'Лабораторні значення — медіани повторних запусків Lighthouse для наведених сторінок. Польові дані отримані від реальних відвідувачів Chrome.',
  performanceLeadSingleRun:
    'Лабораторні значення — це одиничні запуски Lighthouse: по одному на сторінку та пристрій, тому медіани й розкиду тут немає. Польові дані отримані від реальних відвідувачів Chrome.',
  performanceNoField:
    'Interaction to Next Paint потребує даних реальних відвідувачів і для цього сайту недоступний. Лабораторний запуск його не вимірює.',
  performanceRegressions: 'Зміни з попереднього сканування',
  searchDataHeading: 'Пошукові дані',
  googleHeading: 'Google (Search Console та Analytics)',
  bingHeading: 'Bing Webmaster Tools',
  bingFindingsHeading: 'Що показують дані Bing',
  bingFindingsNote:
    'Це примітки, а не оцінені знахідки: дані Bing у цьому випуску мають довідковий характер і не впливають на жодну оцінку.',
  bingSeverity: { info: 'Примітка', attention: 'Варто перевірити' },
  bingTrafficUnavailable:
    'Bing не повернув щоденні кліки та покази за цей період, тому підсумків немає. Їх залишено ' +
    'порожніми, а не нульовими.',
  noData: 'Немає даних',
  actionPlanHeading: 'План дій',
  actionPlanReach: (addressed, total) =>
    addressed >= total
      ? `План охоплює всі відкриті знахідки (${total}).`
      : `План охоплює ${addressed} з ${total} ${ukAfterCount(total, 'знахідки', 'знахідок')}; решта наведена в розділі «Знахідки».`,
  actionPlanProgress: ukStillOpen,
  actionPlanCovers: (ruleIds) => `Закриває: ${ruleIds}`,
  actionPlanSettled: 'усі знахідки, яких це стосується, закриті',
  actionPlanEffort: {
    small: 'невеликий обсяг робіт',
    medium: 'середній обсяг робіт',
    large: 'великий обсяг робіт',
  },
  performanceComparisonNone: (reason) => `Порівняння з попереднім скануванням немає: ${reason}.`,
  incomparable: {
    AuditVersionChanged: (previous, current) =>
      `попереднє сканування виміряно версією ${previous ?? '—'}, а це — версією ${current ?? '—'}`,
    LighthouseVersionUnrecorded: () =>
      'в одному з двох сканувань не записано єдиної версії Lighthouse',
    LighthouseMajorChanged: (previous, current) =>
      `попереднє сканування виміряв Lighthouse ${previous ?? '—'}, а це — Lighthouse ${current ?? '—'}`,
  },
  performanceUrls: 'Виміряні сторінки',
  performanceInstability: 'нестабільне вимірювання',
  footer:
    'FluxRadar — автоматичний аудит сайту. Для юридичної відповідності потрібна ручна перевірка.',
  url: 'URL',
  device: 'Пристрій',
  runs: 'Запусків',
  query: 'Запит',
  clicks: 'Кліки',
  impressions: 'Покази',
  deviceName: { mobile: 'Мобільний', desktop: 'Комп’ютер' },
  duration: (milliseconds) =>
    milliseconds >= 1000
      ? `${(milliseconds / 1000).toFixed(1)} с`
      : `${Math.round(milliseconds)} мс`,
  size: (bytes) =>
    bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} МБ` : `${Math.round(bytes / 1000)} кБ`,
  fieldDataLabel: 'Chrome UX Report (p75)',
  searchConsoleLabel: 'Search Console',
  analyticsLabel: 'Analytics 4',
  searchConsoleTotals: (clicks, impressions, ctr) =>
    `${clicks} кліків · ${impressions} показів · CTR ${ctr}`,
  analyticsTotals: (users, sessions, pageViews) =>
    `${users} користувачів · ${sessions} сеансів · ${pageViews} переглядів сторінок`,
  bingTotals: (clicks, impressions, days) =>
    `${clicks} кліків · ${impressions} показів · ${days} днів у звіті`,
  performanceRegression: (metric, device, url, previous, current) =>
    `${metric}, ${device} · ${url}: ${previous} → ${current}`,
  bingSiteMismatch: (site, domain) =>
    `Ці дані Bing отримані для ресурсу ${site}, а не для ${domain}. Це припустимий вибір — ` +
    'підтвердженим у Bing ресурсом може бути піддомен або інший хост, — але наведені нижче числа ' +
    'описують саме той ресурс, а не цей домен.',
  unsupportedGlyphsHeading: 'Символи, які цей документ не зміг намалювати',
  unsupportedGlyphs: (count) =>
    `${count} символ(ів) цього звіту — наприклад, китайські, японські, корейські або емодзі — не ` +
    'мають накреслення у вбудованих сюди шрифтах. Їх записано як Unicode-послідовності на кшталт ' +
    '\\u{9801}, щоб нічого не втратити: кожна послідовність позначає рівно один символ, зворотна ' +
    'скісна риска в таких рядках подвоюється як \\\\, а повний текст є в експорті JSON.',
};

export const REPORT_COPY: Readonly<Record<FindingLanguage, ReportCopy>> = { en: EN, uk: UK };
