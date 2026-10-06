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
  | 'checkInBrowser'
  | 'opensInBrowser'
  | 'allowCrawler'
  | 'allowInRobots'
  | 'runAgain'
  | 'runAgainAfterChange';

/**
 * The classes of HTTP answer this block has a plain sentence for.
 *
 * Grouped by what the owner would do about it, not by the numeric range: 404
 * and 410 are both "no such page" but 410 is the site saying it on purpose, and
 * a 401 asking for a login is a different job from a 403 refusing outright.
 */
export type StatusClass =
  | 'gone'
  | 'notFound'
  | 'needsLogin'
  | 'refused'
  | 'notAllowed'
  | 'notUnderstood'
  | 'tooManyRequests'
  | 'timedOut'
  | 'legal'
  | 'serverError'
  | 'pointedElsewhere'
  | 'answeredNotAPage'
  | 'startedButStopped'
  | 'noAnswer';

/**
 * Which sentence one answer gets. Every answer gets one.
 *
 * It used to return null for most of them — 400, 405, 408 and every redirect
 * fell through — so a report whose only record of what happened was "HTTP 405"
 * in the technical line said nothing an owner could read. The ranges below are
 * exhaustive, in the order a specific status has to be read before the range
 * it belongs to.
 *
 * `null` means no answer arrived at all: the crawler records a fetch that
 * threw (no such address, refused connection, timeout) as status 0, and "HTTP
 * 0" is not an answer the site gave.
 */
export function statusClassOf(status: number | null): StatusClass {
  if (status === null) return 'noAnswer';
  if (status === 410) return 'gone';
  if (status === 404) return 'notFound';
  if (status === 401 || status === 407) return 'needsLogin';
  if (status === 408) return 'timedOut';
  if (status === 429) return 'tooManyRequests';
  if (status === 451) return 'legal';
  if (status === 403 || status === 406) return 'refused';
  if (status === 405) return 'notAllowed';
  if (status === 400) return 'notUnderstood';
  if (status >= 500) return 'serverError';
  // The rest of 4xx: the site turned the request away without saying which of
  // the specific reasons above applied.
  if (status >= 400) return 'refused';
  if (status >= 300) return 'pointedElsewhere';
  if (status >= 200) return 'answeredNotAPage';
  // 1xx: the site acknowledged the request and never sent the page.
  return 'startedButStopped';
}

/** The first status that is not the site answering with something readable. */
const MIN_FAILING_STATUS = 400;

/**
 * The sentence about the answer that this block should print, or null when the
 * failure's own sentence already said it.
 *
 * `blocked-by-robots` never fetched the start page, and `unreachable` already
 * opens with "Your site did not answer"; a "no answer arrived" sentence under
 * either would read as a second, different reason for the same failure.
 *
 * A robots refusal is silent about any 2xx or 3xx as well. "Your robots.txt
 * tells our crawler not to read the site" is the whole reason; adding "the site
 * answered normally, but what came back was not a web page we could read" under
 * it names a second, contradicting cause for one failure. A 4xx or 5xx still
 * speaks — that the site also refuses or is also broken is a fact about the
 * site the owner has not been told anywhere else.
 */
export function statusMeaningClassOf(failure: SiteReadFailure): StatusClass | null {
  if (failure.startStatus !== null) {
    const silent = failure.kind === 'blocked-by-robots' && failure.startStatus < MIN_FAILING_STATUS;
    return silent ? null : statusClassOf(failure.startStatus);
  }
  return failure.kind === 'unreachable' || failure.kind === 'blocked-by-robots' ? null : 'noAnswer';
}

/** The causes and steps that fit one kind of failure — never a list that contradicts it. */
export interface SiteFailureGuidance {
  readonly causes: readonly string[];
  readonly steps: readonly SiteFailureStep[];
}

export interface ReportFailureCopy {
  readonly heading: string;
  readonly lead: (domain: string) => string;
  /**
   * What happens to the money, for a paid plan only: it is recorded on its own,
   * then issued by hand. It ends on the same clause as the desktop's own
   * unread-site line (desktop-copy.ts), so the two can never promise different
   * things — Report.unread.test.tsx holds the clause and pins both sentences
   * against it.
   *
   * The report does not say "you paid" instead of "if this check was paid
   * for": nothing it can read proves money changed hands. A paid plan on an
   * ordinary account is bought through the provider, and while the provider is
   * in test mode the checkout itself says nothing is taken from the card.
   */
  readonly paidNotDelivered: string;
  readonly whatWeSaw: string;
  readonly kinds: Readonly<Record<SiteReadFailureKind, string>>;
  /**
   * What the status the start page answered with means, in words. The number
   * itself stays in the technical-details line: "HTTP 410" is not a sentence an
   * owner can act on, and it was the only thing on the block that named the
   * actual answer.
   */
  readonly statusMeanings: Readonly<Record<StatusClass, string>>;
  readonly causesHeading: string;
  readonly guidance: Readonly<Record<SiteReadFailureKind, SiteFailureGuidance>>;
  readonly whatToDoHeading: string;
  readonly checkInBrowser: (domain: string) => string;
  /**
   * The case the previous step leaves open and the owner hits most: the site
   * opens perfectly in their own browser, so they conclude the report is wrong.
   * It is not — something in front of the site turns away automated visitors
   * while letting people through — and the crawler page is what to hand to
   * whoever can allow us.
   */
  readonly opensInBrowserBefore: string;
  /**
   * Its own link text, not the `crawlerLink` the step below uses: two links to
   * the same page with the same name in one list read as a repeat rather than
   * as two things to do.
   */
  readonly opensInBrowserLink: string;
  readonly opensInBrowserAfter: string;
  readonly allowCrawlerBefore: string;
  readonly crawlerLink: string;
  readonly allowCrawlerAfter: string;
  readonly allowInRobotsBefore: string;
  readonly allowInRobotsAfter: string;
  /**
   * The paid plans' alternative; the Free check cannot skip robots.txt at all.
   * It names the new-scan screen's folded block by that block's own title, so
   * the two cannot drift apart.
   */
  readonly robotsOverride: string;
  readonly runAgain: string;
  readonly runAgainAfterChange: string;
  readonly sectionsNotChecked: (names: string) => string;
  readonly technicalDetails: (details: string) => string;
  readonly httpStatus: (status: number) => string;
  readonly nothingChecked: string;
  /**
   * Why the report offers no Issue Center, no download and no export.
   *
   * It used to offer all of them: "Open Issue Center", "Download full
   * report (PDF)", "Printable report", JSON and CSV sat under a block
   * saying nothing was checked, so five of the six controls on a failed
   * report led to an empty list or an empty file.
   */
  readonly noExports: string;
  readonly nothingToPlan: string;
  readonly printNoProblems: string;
}

/** The crawler page: the user agent, the addresses and the allowlist rule. */
export const CRAWLER_PAGE_HREF = '/bot';

/** Steps for a failure whose cause the scan could not pin down. */
const GENERAL_STEPS: readonly SiteFailureStep[] = [
  'checkInBrowser',
  'opensInBrowser',
  'allowCrawler',
  'runAgain',
];

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
    paidNotDelivered:
      'If this check was paid for, it counts as not delivered: a refund is recorded for it automatically, without you asking, and is then issued by hand through Creem, so it is not instant.',
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
    statusMeanings: {
      gone: 'The site answered that this page no longer exists and is not coming back.',
      notFound: 'The site answered that there is no such page at that address.',
      needsLogin: 'The site asked for a login or a password before it would show the page.',
      refused: 'The site refused to show the page to us.',
      notAllowed: 'The site answered that it does not accept this kind of request at that address.',
      notUnderstood: 'The site answered that it could not make sense of our request.',
      tooManyRequests: 'The site answered that we were asking for pages too often.',
      timedOut: 'The site stopped waiting for our request before it finished.',
      legal: 'The site answered that the page is blocked for legal reasons.',
      serverError: 'Something went wrong on the site’s own side instead of the page being sent.',
      pointedElsewhere:
        'The site pointed us to another address, and following it did not lead to a page we could read.',
      answeredNotAPage:
        'The site answered normally, but what came back was not a web page we could read.',
      startedButStopped: 'The site began to answer and then stopped, so no page ever arrived.',
      noAnswer: 'No answer came back from the site at all — not even an error page.',
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
    opensInBrowserBefore:
      'If it opens perfectly for you, that does not mean this report is wrong: something in front of your site — the hosting, a firewall or a bot-protection service — can let people through and turn automated visitors away. The page',
    opensInBrowserLink: 'Our crawler',
    opensInBrowserAfter:
      'names us and the addresses we come from, so whoever looks after your site can let us in.',
    allowCrawlerBefore:
      'If the site sits behind protection or a firewall (for example Cloudflare), allow our crawler — our',
    crawlerLink: 'crawler page',
    allowCrawlerAfter: 'lists what to allow.',
    allowInRobotsBefore: 'Allow FluxRadarBot in robots.txt — our',
    allowInRobotsAfter: 'has the two lines to paste.',
    robotsOverride: `Or turn off “Respect robots.txt” under “${newScanCopy.en.expertTitle}” and, beside the Run button, tick that you want the skipped pages read.`,
    runAgain: 'Run the scan again once the site opens in a browser.',
    runAgainAfterChange: 'Run the scan again after the change.',
    sectionsNotChecked: (names) =>
      `These sections were not checked, because there was no page to check them on: ${names}.`,
    technicalDetails: (details) => `Technical details: ${details}`,
    httpStatus: (status) => `HTTP ${status}`,
    nothingChecked:
      'Nothing was checked — this scan produced no results, so it cannot list problems. That does not mean there are none.',
    noExports:
      'There is no list of problems to open and nothing to download, because nothing was checked. Follow the steps above and run the check again.',
    nothingToPlan:
      'Nothing on this report was checked, so there is nothing to plan yet. Run the scan again once your site can be read.',
    printNoProblems:
      'No problems are listed because nothing was checked — not because there are none.',
  },
  uk: {
    heading: 'Нам не вдалося відкрити ваш сайт',
    lead: (domain) =>
      `Ми намагалися прочитати ${domain}, але не змогли відкрити жодної сторінки. Нічого в цьому звіті поки не описує ваш сайт — це не «чистий» результат, а відсутність результату.`,
    paidNotDelivered:
      'Якщо перевірка була платною, вона вважається не виконаною: повернення коштів для неї фіксується автоматично, просити не потрібно, а далі його вручну оформлюють через Creem, тож це не миттєво.',
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
    statusMeanings: {
      gone: 'Сайт відповів, що цієї сторінки більше немає й вона не повернеться.',
      notFound: 'Сайт відповів, що за цією адресою немає такої сторінки.',
      needsLogin: 'Сайт попросив вхід або пароль, перш ніж показати сторінку.',
      refused: 'Сайт відмовився показати нам сторінку.',
      notAllowed: 'Сайт відповів, що не приймає таких запитів за цією адресою.',
      notUnderstood: 'Сайт відповів, що не зрозумів нашого запиту.',
      tooManyRequests: 'Сайт відповів, що ми запитуємо сторінки надто часто.',
      timedOut: 'Сайт перестав чекати на наш запит, перш ніж той завершився.',
      legal: 'Сайт відповів, що сторінку заблоковано з юридичних причин.',
      serverError: 'Щось спрацювало не так на боці сайту замість того, щоб сторінка надійшла.',
      pointedElsewhere:
        'Сайт направив нас на іншу адресу, і за нею не виявилося сторінки, яку ми могли прочитати.',
      answeredNotAPage:
        'Сайт відповів нормально, але те, що надійшло, не було вебсторінкою, яку ми могли прочитати.',
      startedButStopped: 'Сайт почав відповідати й зупинився, тож сторінка так і не надійшла.',
      noAnswer: 'Від сайту взагалі не надійшло жодної відповіді — навіть сторінки помилки.',
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
    opensInBrowserBefore:
      'Якщо у вас сайт відкривається без проблем, це не означає, що звіт помиляється: те, що стоїть перед сайтом — хостинг, файрвол або сервіс захисту від ботів — може пускати людей і не пускати автоматичних відвідувачів. На сторінці',
    opensInBrowserLink: 'Про наш краулер',
    opensInBrowserAfter:
      'названо нас і адреси, з яких ми приходимо, щоб той, хто доглядає за сайтом, міг нас пустити.',
    allowCrawlerBefore:
      'Якщо сайт стоїть за захистом або файрволом (наприклад, Cloudflare), дозвольте наш краулер. На сторінці',
    crawlerLink: 'Наш краулер',
    allowCrawlerAfter: 'є все, що потрібно дозволити.',
    allowInRobotsBefore: 'Дозвольте FluxRadarBot у robots.txt — на сторінці',
    allowInRobotsAfter: 'є два рядки, які треба вставити.',
    robotsOverride: `Або вимкніть «Дотримуватись robots.txt» у блоці «${newScanCopy.uk.expertTitle}» і біля кнопки запуску поставте позначку, що хочете прочитати пропущені сторінки.`,
    runAgain: 'Запустіть перевірку ще раз, коли сайт відкриватиметься в браузері.',
    runAgainAfterChange: 'Запустіть перевірку ще раз після змін.',
    sectionsNotChecked: (names) =>
      `Ці розділи не перевірено, бо не було сторінки для перевірки: ${names}.`,
    technicalDetails: (details) => `Технічні деталі: ${details}`,
    httpStatus: (status) => `HTTP ${status}`,
    nothingChecked:
      'Нічого не перевірено — ця перевірка не дала результатів, тож не може показати список проблем. Це не означає, що проблем немає.',
    noExports:
      'Списку проблем немає, і завантажувати нічого, бо нічого не перевірено. Виконайте кроки вище й запустіть перевірку ще раз.',
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
