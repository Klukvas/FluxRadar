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

import type { FindingLanguage } from '@fluxradar/rules';

import type { IncomparableCode } from '../../integrations/performance/index.ts';

export interface ReportCopy {
  readonly documentTitle: (domain: string) => string;
  readonly preparedFor: (domain: string) => string;
  readonly generated: (timestamp: string) => string;
  readonly plan: string;
  readonly scanned: string;
  readonly score: string;
  readonly noScore: string;
  readonly coverage: string;
  readonly summaryHeading: string;
  readonly summaryLine: (open: number, groups: number) => string;
  readonly summaryNone: string;
  readonly sectionsHeading: string;
  readonly section: string;
  readonly result: string;
  readonly problemsHeading: string;
  readonly problemsLead: string;
  readonly noFindings: string;
  readonly completeNote: (total: number) => string;
  readonly affectedPages: (count: number) => string;
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
  documentTitle: (domain) => `FluxRadar report — ${domain}`,
  preparedFor: (domain) => `Website report for ${domain}`,
  generated: (timestamp) => `Generated ${timestamp}`,
  plan: 'Plan',
  scanned: 'Scanned',
  score: 'Score',
  noScore: 'Not scored',
  coverage: 'Coverage',
  summaryHeading: 'Summary',
  summaryLine: (open, groups) => `${open} open findings across ${groups} distinct problems.`,
  summaryNone: 'No open findings.',
  sectionsHeading: 'Sections',
  section: 'Section',
  result: 'Result',
  problemsHeading: 'Findings',
  problemsLead:
    'Every finding of this scan, worst first, with the page it was found on, the evidence and the fix.',
  noFindings: 'This scan produced no findings.',
  completeNote: (total) =>
    `All ${total} findings are included below; nothing was left out of this document.`,
  affectedPages: (count) => `${count} affected`,
  evidence: 'Evidence',
  recommendation: 'Fix',
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
    `This plan addresses ${addressed} of the ${total} open findings in this report.`,
  actionPlanProgress: (open, total) => `${open} of ${total} findings still open`,
  actionPlanSettled: 'every finding this addresses is closed',
  actionPlanEffort: { small: 'small effort', medium: 'medium effort', large: 'large effort' },
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
  documentTitle: (domain) => `Звіт FluxRadar — ${domain}`,
  preparedFor: (domain) => `Звіт про сайт ${domain}`,
  generated: (timestamp) => `Сформовано ${timestamp}`,
  plan: 'Тариф',
  scanned: 'Проскановано',
  score: 'Оцінка',
  noScore: 'Без оцінки',
  coverage: 'Покриття',
  summaryHeading: 'Підсумок',
  summaryLine: (open, groups) => `${open} відкритих знахідок у ${groups} різних проблемах.`,
  summaryNone: 'Відкритих знахідок немає.',
  sectionsHeading: 'Розділи',
  section: 'Розділ',
  result: 'Результат',
  problemsHeading: 'Знахідки',
  problemsLead:
    'Усі знахідки цього сканування, починаючи з найважливіших: сторінка, доказ і спосіб виправлення.',
  noFindings: 'Це сканування не виявило знахідок.',
  completeNote: (total) => `Нижче наведено всі ${total} знахідок — нічого не пропущено.`,
  affectedPages: (count) => `${count} уражено`,
  evidence: 'Доказ',
  recommendation: 'Виправлення',
  status: 'Статус',
  severity: {
    Critical: 'Критично',
    High: 'Високо',
    Medium: 'Середньо',
    Low: 'Низько',
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
    `Цей план охоплює ${addressed} з ${total} відкритих знахідок цього звіту.`,
  actionPlanProgress: (open, total) => `${open} з ${total} знахідок ще відкриті`,
  actionPlanSettled: 'усі знахідки, яких це стосується, закриті',
  actionPlanEffort: { small: 'невеликий обсяг', medium: 'середній обсяг', large: 'великий обсяг' },
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
