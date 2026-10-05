// What a finished report says when the site itself could not be read.
//
// A scan whose crawl read no page ended with a dash for a score, eight identical
// "Unavailable" cards, the raw reason `SiteReturnedNoReadablePage` on each of
// them, and a "Fix these first" block saying nothing was waiting for a fix. An
// owner read that as a clean bill of health. This file holds the one decision
// ("was anything checked at all?") and the owner-facing words for it.
//
// The reason codes are the producing side's own, from `SITE_REACH_STATUS_REASONS`
// in `packages/contracts/src/crawl-summary.ts`. They are matched as literals for
// the reason `module-status.ts` gives: the web app has no dependency on the
// contracts package.

import type { CrawlSummary, Scan, ScanModule } from './api';
import type { Language } from './i18n';
import { newScanCopy } from './new-scan-copy';

/** Why no page was read, as far as the scan recorded it. */
export type SiteReadFailureKind =
  'access-denied' | 'blocked-by-robots' | 'unreachable' | 'bad-response' | 'unknown';

export interface SiteReadFailure {
  readonly kind: SiteReadFailureKind;
  /** The raw reason, kept for the "technical details" line only. */
  readonly reasonCode: string | null;
  /** What the start page answered; null when no response arrived at all. */
  readonly startStatus: number | null;
  /** Headers naming an access-control layer (`server: cloudflare`, …), as recorded. */
  readonly accessControlSignals: readonly string[];
}

/** Wire status reason → why the site could not be read. */
const SITE_REASON_KINDS: Readonly<Record<string, SiteReadFailureKind>> = {
  SiteDeniedAccess: 'access-denied',
  SiteBlockedByRobots: 'blocked-by-robots',
  SiteUnreachable: 'unreachable',
  SiteReturnedNoReadablePage: 'bad-response',
};

/** The general "this scan produced nothing" reason (`STATUS_REASONS.noUsableOutput`). */
const NO_USABLE_OUTPUT = 'NoUsableOutput';

const KNOWN_REACH_KINDS: ReadonlySet<string> = new Set([
  'access-denied',
  'blocked-by-robots',
  'unreachable',
  'bad-response',
]);

type ModuleSignals = Pick<ScanModule, 'statusReason' | 'usableOutput'>;
type ScanSignals = Pick<Scan, 'statusReason' | 'crawlSummary'> & {
  readonly modules?: readonly ModuleSignals[];
};

function isSiteReason(reason: string | null | undefined): reason is string {
  return reason != null && Object.hasOwn(SITE_REASON_KINDS, reason.trim());
}

function kindOf(summary: CrawlSummary | null, reasonCode: string | null): SiteReadFailureKind {
  if (summary !== null && KNOWN_REACH_KINDS.has(summary.reach)) {
    return summary.reach as SiteReadFailureKind;
  }
  if (isSiteReason(reasonCode)) return SITE_REASON_KINDS[reasonCode.trim()] ?? 'unknown';
  return 'unknown';
}

/** The lowest number that is an HTTP status at all. */
const MIN_HTTP_STATUS = 100;

/**
 * The start page's status, or null when no response arrived. The crawler
 * records a fetch that threw (DNS, refused connection, timeout) as status 0,
 * and "HTTP 0" would read as an answer the site never gave.
 */
function realStatusOf(summary: CrawlSummary | null): number | null {
  const status = summary?.startStatus ?? null;
  return status !== null && status >= MIN_HTTP_STATUS ? status : null;
}

/**
 * Whether no page of the site could be read, and why; null when it was read.
 *
 * Three signals, any one of which is enough: the crawl summary says the site was
 * not reachable, the scan's own reason is a site-reach reason, or every section
 * reports a site-reach reason with nothing usable. A crawl summary saying the
 * site *was* read wins over the rest — a number the run measured beats a word.
 */
export function siteReadFailureOf(
  scan: ScanSignals,
  modules: readonly ModuleSignals[] = scan.modules ?? [],
): SiteReadFailure | null {
  const summary = scan.crawlSummary ?? null;
  if (summary !== null && summary.reach === 'reachable') return null;

  const moduleReason = modules.find((module) => isSiteReason(module.statusReason))?.statusReason;
  const everySectionUnread =
    modules.length > 0 &&
    modules.every((module) => !module.usableOutput && isSiteReason(module.statusReason));
  const unread = summary !== null || isSiteReason(scan.statusReason) || everySectionUnread;
  if (!unread) return null;

  const reasonCode = scan.statusReason?.trim() || moduleReason?.trim() || null;
  return {
    kind: kindOf(summary, reasonCode),
    reasonCode,
    startStatus: realStatusOf(summary),
    accessControlSignals: summary?.accessControlSignals ?? [],
  };
}

/**
 * Whether this report checked nothing at all.
 *
 * Wider than "the site could not be read": a scan whose sections all ran on a
 * readable site and still returned nothing usable (`NoUsableOutput`) has no
 * findings for the same reason, and must not be called clean either.
 */
export function nothingWasChecked(
  scan: ScanSignals,
  modules: readonly ModuleSignals[] = scan.modules ?? [],
): boolean {
  if (siteReadFailureOf(scan, modules) !== null) return true;
  if (scan.statusReason?.trim() === NO_USABLE_OUTPUT) return true;
  return modules.length > 0 && modules.every((module) => !module.usableOutput);
}

/**
 * One "what to do" step. `allowCrawler` carries the link to the crawler page,
 * so it is drawn by the component rather than stored as one sentence.
 */
export type SiteFailureStep =
  'checkInBrowser' | 'allowCrawler' | 'allowInRobots' | 'runAgain' | 'runAgainAfterChange';

/** The causes and steps that fit one kind of failure — never a list that contradicts it. */
export interface SiteFailureGuidance {
  readonly causes: readonly string[];
  readonly steps: readonly SiteFailureStep[];
}

export interface ReportFailureCopy {
  readonly heading: string;
  readonly lead: (domain: string) => string;
  readonly whatWeSaw: string;
  readonly kinds: Readonly<Record<SiteReadFailureKind, string>>;
  readonly causesHeading: string;
  readonly guidance: Readonly<Record<SiteReadFailureKind, SiteFailureGuidance>>;
  readonly whatToDoHeading: string;
  readonly checkInBrowser: (domain: string) => string;
  readonly allowCrawlerBefore: string;
  readonly crawlerLink: string;
  readonly allowCrawlerAfter: string;
  readonly allowInRobotsBefore: string;
  readonly allowInRobotsAfter: string;
  /**
   * The paid plans' alternative; the Free check has no robots.txt override. It
   * names the new-scan screen's folded block by that block's own title, so the
   * two cannot drift apart.
   */
  readonly robotsOverride: string;
  readonly runAgain: string;
  readonly runAgainAfterChange: string;
  readonly sectionsNotChecked: (names: string) => string;
  readonly technicalDetails: (details: string) => string;
  readonly httpStatus: (status: number) => string;
  readonly nothingChecked: string;
  readonly nothingToPlan: string;
  readonly printNoProblems: string;
}

/** The crawler page: the user agent, the addresses and the allowlist rule. */
export const CRAWLER_PAGE_HREF = '/bot';

/** Steps for a failure whose cause the scan could not pin down. */
const GENERAL_STEPS: readonly SiteFailureStep[] = ['checkInBrowser', 'allowCrawler', 'runAgain'];

const EN_GENERAL_CAUSES: readonly string[] = [
  'The site answers with an error (for example 404 or 500).',
  'The site blocks automated checks — a firewall, bot protection or a hosting security setting.',
  'The site did not answer in time, or was down while we checked.',
  'The site asks for a login or a password before it shows a page.',
  'The page comes back empty.',
];

const UK_GENERAL_CAUSES: readonly string[] = [
  'Сайт відповідає помилкою (наприклад, 404 або 500).',
  'Сайт блокує автоматичні перевірки — файрвол, захист від ботів або налаштування безпеки хостингу.',
  'Сайт не відповів вчасно або не працював під час перевірки.',
  'Сайт вимагає вхід або пароль, перш ніж показати сторінку.',
  'Сторінка повертається порожньою.',
];

export const reportFailureCopy: Readonly<Record<Language, ReportFailureCopy>> = {
  en: {
    heading: 'We could not open your site',
    lead: (domain) =>
      `We tried to read ${domain}, but could not open a single page of it. Nothing in this report describes your site yet — this is not a clean result, it is no result.`,
    whatWeSaw: 'What we saw',
    kinds: {
      'access-denied':
        'Your site answered with a status that usually means a refusal (for example 401, 403, 429 or 503). That is most often a firewall or bot protection in front of the site, sometimes a login or a server under load.',
      'blocked-by-robots':
        'Your robots.txt tells our crawler not to read the site, and we respect that.',
      unreachable:
        'Your site did not answer: the address did not resolve, the connection failed, or it did not respond in time.',
      'bad-response':
        'Your site answered, but not with a page we could read — for example an error page, or a file instead of a page.',
      unknown: 'We could not read any page of your site, and the scan did not record why.',
    },
    causesHeading: 'Common reasons',
    guidance: {
      'access-denied': {
        causes: [
          'A firewall or bot protection (for example Cloudflare) turns away automated visitors.',
          'A hosting security setting or a rate limit blocks repeated requests.',
          'The site asks for a login or a password before it shows a page (a 401).',
          'The server was overloaded while we checked.',
        ],
        steps: GENERAL_STEPS,
      },
      'blocked-by-robots': {
        // "What we saw" already names the one cause; a list repeating it is noise.
        causes: [],
        steps: ['allowInRobots', 'runAgainAfterChange'],
      },
      unreachable: {
        causes: [
          'The address is mistyped, or its domain or DNS record has lapsed.',
          'The server was down or refused the connection.',
          'The site took too long to answer, or a firewall silently dropped our requests.',
        ],
        steps: GENERAL_STEPS,
      },
      // The site did answer, with a status that is no refusal: a timeout, a
      // block or a login wall are already ruled out by the time this is reached.
      'bad-response': {
        causes: [
          'The site answers with an error page (for example 404 or 500).',
          'The address returns a file rather than a web page — for example a PDF, an image or plain data.',
          'The home page redirects to an address that answers with an error.',
        ],
        steps: GENERAL_STEPS,
      },
      unknown: { causes: EN_GENERAL_CAUSES, steps: GENERAL_STEPS },
    },
    whatToDoHeading: 'What to do',
    checkInBrowser: (domain) =>
      `Open ${domain} in a browser and check that the home page loads without a login.`,
    allowCrawlerBefore:
      'If the site sits behind protection or a firewall (for example Cloudflare), allow our crawler — our',
    crawlerLink: 'crawler page',
    allowCrawlerAfter: 'lists what to allow.',
    allowInRobotsBefore: 'Allow FluxRadarBot in robots.txt — our',
    allowInRobotsAfter: 'has the two lines to paste.',
    robotsOverride: `Or turn off “Respect robots.txt” under “${newScanCopy.en.expertTitle}” and confirm the override when you start the next scan.`,
    runAgain: 'Run the scan again once the site opens in a browser.',
    runAgainAfterChange: 'Run the scan again after the change.',
    sectionsNotChecked: (names) =>
      `These sections were not checked, because there was no page to check them on: ${names}.`,
    technicalDetails: (details) => `Technical details: ${details}`,
    httpStatus: (status) => `HTTP ${status}`,
    nothingChecked:
      'Nothing was checked — this scan produced no results, so it cannot list problems. That does not mean there are none.',
    nothingToPlan:
      'Nothing on this report was checked, so there is nothing to plan yet. Run the scan again once your site can be read.',
    printNoProblems:
      'No problems are listed because nothing was checked — not because there are none.',
  },
  uk: {
    heading: 'Нам не вдалося відкрити ваш сайт',
    lead: (domain) =>
      `Ми намагалися прочитати ${domain}, але не змогли відкрити жодної сторінки. Нічого в цьому звіті поки не описує ваш сайт — це не «чистий» результат, а відсутність результату.`,
    whatWeSaw: 'Що ми побачили',
    kinds: {
      'access-denied':
        'Ваш сайт відповів статусом, який зазвичай означає відмову (наприклад, 401, 403, 429 або 503). Найчастіше це файрвол або захист від ботів перед сайтом, іноді — вхід за паролем або перевантажений сервер.',
      'blocked-by-robots':
        'Файл robots.txt вашого сайту забороняє нашому краулеру його читати, і ми це поважаємо.',
      unreachable:
        'Ваш сайт не відповів: адресу не знайдено, з’єднання не вдалося або відповідь не надійшла вчасно.',
      'bad-response':
        'Ваш сайт відповів, але не сторінкою, яку ми могли прочитати, — наприклад, сторінкою помилки або файлом замість сторінки.',
      unknown:
        'Ми не змогли прочитати жодної сторінки вашого сайту, а перевірка не записала, чому.',
    },
    causesHeading: 'Найчастіші причини',
    guidance: {
      'access-denied': {
        causes: [
          'Файрвол або захист від ботів (наприклад, Cloudflare) не пускає автоматичних відвідувачів.',
          'Налаштування безпеки хостингу або ліміт запитів блокує повторні звернення.',
          'Сайт вимагає вхід або пароль, перш ніж показати сторінку (статус 401).',
          'Сервер був перевантажений під час перевірки.',
        ],
        steps: GENERAL_STEPS,
      },
      'blocked-by-robots': {
        // "What we saw" already names the one cause; a list repeating it is noise.
        causes: [],
        steps: ['allowInRobots', 'runAgainAfterChange'],
      },
      unreachable: {
        causes: [
          'Адресу введено з помилкою, або термін дії домену чи DNS-запису минув.',
          'Сервер не працював або відхилив з’єднання.',
          'Сайт відповідав надто довго, або файрвол мовчки відкидав наші запити.',
        ],
        steps: GENERAL_STEPS,
      },
      'bad-response': {
        causes: [
          'Сайт відповідає сторінкою помилки (наприклад, 404 або 500).',
          'За адресою віддається файл, а не вебсторінка — наприклад, PDF, зображення або просто дані.',
          'Головна сторінка перенаправляє на адресу, яка відповідає помилкою.',
        ],
        steps: GENERAL_STEPS,
      },
      unknown: { causes: UK_GENERAL_CAUSES, steps: GENERAL_STEPS },
    },
    whatToDoHeading: 'Що робити',
    checkInBrowser: (domain) =>
      `Відкрийте ${domain} у браузері й переконайтеся, що головна сторінка завантажується без входу.`,
    allowCrawlerBefore:
      'Якщо сайт стоїть за захистом або файрволом (наприклад, Cloudflare), дозвольте наш краулер. На сторінці',
    crawlerLink: 'Наш краулер',
    allowCrawlerAfter: 'є все, що потрібно дозволити.',
    allowInRobotsBefore: 'Дозвольте FluxRadarBot у robots.txt — на сторінці',
    allowInRobotsAfter: 'є два рядки, які треба вставити.',
    robotsOverride: `Або вимкніть «Дотримуватись robots.txt» у блоці «${newScanCopy.uk.expertTitle}» й підтвердьте відхилення, коли запускатимете наступну перевірку.`,
    runAgain: 'Запустіть перевірку ще раз, коли сайт відкриватиметься в браузері.',
    runAgainAfterChange: 'Запустіть перевірку ще раз після змін.',
    sectionsNotChecked: (names) =>
      `Ці розділи не перевірено, бо не було сторінки для перевірки: ${names}.`,
    technicalDetails: (details) => `Технічні деталі: ${details}`,
    httpStatus: (status) => `HTTP ${status}`,
    nothingChecked:
      'Нічого не перевірено — ця перевірка не дала результатів, тож не може показати список проблем. Це не означає, що проблем немає.',
    nothingToPlan:
      'У цьому звіті нічого не перевірено, тож планувати поки нічого. Запустіть перевірку ще раз, коли сайт можна буде прочитати.',
    printNoProblems: 'Проблем у списку немає, бо нічого не перевірено, а не тому, що їх немає.',
  },
};

/**
 * The small "technical details" line: the raw reason, the start page's status
 * and the protection-layer headers — the last being what makes "allow our
 * crawler" concrete for whoever maintains the site.
 */
export function technicalDetailsOf(failure: SiteReadFailure, language: Language): string | null {
  const t = reportFailureCopy[language];
  const parts = [
    failure.reasonCode,
    failure.startStatus === null ? null : t.httpStatus(failure.startStatus),
    failure.accessControlSignals.length === 0 ? null : failure.accessControlSignals.join(', '),
  ].filter((part): part is string => part !== null && part !== '');
  return parts.length === 0 ? null : t.technicalDetails(parts.join(' · '));
}
