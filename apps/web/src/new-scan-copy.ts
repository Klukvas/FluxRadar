import type { Language } from './i18n';
import type { Plan } from './plan-modules';

/**
 * The new-scan screen's plain-language layer: the line that names the site
 * beside the launch button, the folded block for crawl settings most owners
 * never touch, and the warning a carried-over robots.txt override earns.
 *
 * Kept apart from `i18n.ts` so the screen's own wording can change without
 * touching the shared catalogue.
 */
export type NewScanClarityCopy = {
  /** "Checking: Eva Grace, https://evagrace.example, plan Basic". */
  readonly checking: (site: { name: string; domain: string }, plan: string) => string;
  readonly noSiteChosen: string;
  /** The product names, without prices: the line names the plan, the picker sells it. */
  readonly planNames: Readonly<Record<Plan, string>>;
  readonly expertTitle: string;
  readonly expertLead: string;
  readonly hints: {
    readonly subdomains: string;
    readonly userAgent: string;
    readonly maxPages: string;
    readonly maxDepth: string;
    readonly renderJs: string;
    readonly robots: string;
  };
  readonly blockedByRobots: string;
  /** The same, when the override was restored from saved settings. */
  readonly blockedByRobotsStale: string;
  /** The summary line for a crawl that will ignore robots.txt. */
  readonly robotsWarning: string;
  /** Added when that override came from saved settings and is not yet re-confirmed. */
  readonly robotsWarningStale: string;
};

const PLAN_NAMES: Readonly<Record<Plan, string>> = {
  Free: 'Free',
  Basic: 'Basic',
  WebsiteAudit: 'Website Audit',
  Complete: 'Complete',
};

export const newScanCopy: Record<Language, NewScanClarityCopy> = {
  en: {
    checking: (site, plan) => `Checking: ${site.name}, ${site.domain}, plan ${plan}`,
    noSiteChosen: 'No site chosen yet',
    planNames: PLAN_NAMES,
    expertTitle: 'For experienced users',
    expertLead:
      'Crawl settings with safe defaults. Most checks never need them; anything changed here is used by the scan even while this block is folded.',
    hints: {
      subdomains:
        'Also check blog.example.com, shop.example.com and other addresses under your site.',
      userAgent: 'Read the site as a desktop or a phone browser would.',
      maxPages: 'Stop after this many pages. Empty means the plan’s own limit.',
      maxDepth:
        'How many clicks away from the homepage the crawler goes. 0 = homepage only; blank = no depth limit.',
      renderJs:
        'Wait for the page’s scripts, as a visitor’s browser does. Leave on unless told otherwise.',
      robots:
        'robots.txt is the site’s list of pages crawlers should skip. Keep it respected unless you own the site and need those pages checked.',
    },
    blockedByRobots:
      'To start this scan, confirm the robots.txt override under For experienced users.',
    blockedByRobotsStale:
      'To start this scan, confirm the robots.txt override again under For experienced users, or turn robots.txt back on. A confirmation is not carried over from saved settings.',
    robotsWarning:
      'This scan will ignore robots.txt and read pages the site asks crawlers to skip.',
    robotsWarningStale:
      'This setting came from the site’s saved settings — confirm it again before launching.',
  },
  uk: {
    checking: (site, plan) => `Перевіряємо: ${site.name}, ${site.domain}, тариф ${plan}`,
    noSiteChosen: 'Сайт ще не вибрано',
    planNames: PLAN_NAMES,
    expertTitle: 'Для досвідчених користувачів',
    expertLead:
      'Налаштування обходу з безпечними значеннями. Здебільшого їх не чіпають; усе, що змінено тут, скан використає, навіть коли блок згорнуто.',
    hints: {
      subdomains:
        'Також перевірити blog.example.com, shop.example.com та інші адреси вашого сайту.',
      userAgent: 'Читати сайт так, як його бачить браузер комп’ютера або телефона.',
      maxPages: 'Зупинитися після стількох сторінок. Порожнє поле — ліміт тарифу.',
      maxDepth:
        'На скільки кліків від головної сторінки заходить сканер. 0 — лише головна; порожнє поле — без обмеження глибини.',
      renderJs:
        'Чекати на скрипти сторінки, як браузер відвідувача. Залиште увімкненим, якщо немає причини вимикати.',
      robots:
        'robots.txt — це список сторінок, які сайт просить сканери пропускати. Вимикайте лише на власному сайті, коли треба перевірити саме ці сторінки.',
    },
    blockedByRobots:
      'Щоб запустити скан, підтвердьте відхилення robots.txt у блоці «Для досвідчених користувачів».',
    blockedByRobotsStale:
      'Щоб запустити скан, ще раз підтвердьте відхилення robots.txt у блоці «Для досвідчених користувачів» або знову увімкніть robots.txt. Підтвердження не переноситься зі збережених налаштувань.',
    robotsWarning:
      'Цей скан ігноруватиме robots.txt і читатиме сторінки, які сайт просить сканери пропускати.',
    robotsWarningStale:
      'Це налаштування взято зі збережених налаштувань сайту — підтвердьте його ще раз перед запуском.',
  },
};
