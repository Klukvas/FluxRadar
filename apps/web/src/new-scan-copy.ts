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
  /**
   * Added when the values inside came from the site's saved settings rather
   * than from anything chosen on this screen — which is also why the block is
   * open: `expertSettingsChanged` opens it whenever one of them differs from
   * the default, and a box ticked by a saved setting looks like a box the
   * owner ticked.
   */
  readonly expertCarriedOver: string;
  readonly hints: {
    readonly subdomains: string;
    readonly userAgent: string;
    readonly maxPages: string;
    readonly maxDepth: string;
    readonly renderJs: string;
    readonly robots: string;
  };
  readonly blockedByRobots: string;
  /** The same, when the setting was restored from saved settings. */
  readonly blockedByRobotsStale: string;
  /** The warning above the button for a crawl that will ignore robots.txt. */
  readonly robotsWarning: string;
  /** Added when that setting came from saved settings and is not yet re-confirmed. */
  readonly robotsWarningStale: string;
  /** The tick that lets this one scan read the skipped pages. */
  readonly robotsConfirmLabel: string;
  /** The way out of the whole decision: put the rule back and launch. */
  readonly robotsBackOn: string;
  /**
   * The screen's remaining words, which used to be written inline as
   * `language === 'uk' ? … : …` ternaries in the markup. A string spelled in
   * the component is a string no parity test can see, and three of them were
   * the only Ukrainian on the screen nobody had checked.
   */
  readonly closeWindow: string;
  /** The first site: the way on for an account that has none yet. */
  readonly createProfile: string;
  /** Leaving the form with settings that were never saved. */
  readonly discard: {
    readonly title: string;
    readonly body: string;
    readonly keep: string;
    readonly discard: string;
  };
  /**
   * The optional Google context an audit can use. One state per answer, so the
   * panel never says "checking" after it has stopped checking.
   */
  readonly googleContext: {
    readonly title: string;
    readonly loading: string;
    readonly ready: string;
    readonly missing: string;
    readonly unavailable: string;
    readonly open: string;
  };
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
    expertCarriedOver:
      'The values below came from this site’s saved settings, not from anything you chose just now — this block is open because some of them differ from the safe default. Change any of them and the scan uses the new value.',
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
      'The scan cannot start until you tick the box above, or switch robots.txt back on.',
    blockedByRobotsStale:
      'The scan cannot start until you tick the box above, or switch robots.txt back on. A tick from an earlier scan is never reused.',
    robotsWarning:
      'This scan will ignore robots.txt and read pages the site asks crawlers to skip.',
    robotsWarningStale:
      'This setting came from the site’s saved settings, not from anything you chose just now — say again that you want it.',
    robotsConfirmLabel: 'Yes, read the pages robots.txt asks crawlers to skip',
    robotsBackOn: 'Switch robots.txt back on',
    closeWindow: 'Close window',
    createProfile: 'Create profile',
    discard: {
      title: 'Discard unsaved scan setup?',
      body: 'Your changes to this new scan will be lost.',
      keep: 'Keep editing',
      discard: 'Discard changes',
    },
    googleContext: {
      title: 'Google data (optional)',
      loading: 'Checking connected Google properties…',
      ready:
        'Search Console or GA4 is connected for this profile. That context will be included in the audit; PageSpeed is independent of this connection.',
      missing:
        'Connect Search Console or GA4 to add Google context to this audit. PageSpeed does not need a connection.',
      unavailable: 'Google connection status is unavailable. The audit can still continue.',
      open: 'Open integrations',
    },
  },
  uk: {
    checking: (site, plan) => `Перевіряємо: ${site.name}, ${site.domain}, тариф ${plan}`,
    noSiteChosen: 'Сайт ще не вибрано',
    planNames: PLAN_NAMES,
    expertTitle: 'Для досвідчених користувачів',
    expertLead:
      'Налаштування обходу з безпечними значеннями. Здебільшого їх не чіпають; усе, що змінено тут, перевірка використає, навіть коли блок згорнуто.',
    expertCarriedOver:
      'Значення нижче взято зі збережених налаштувань цього сайту, а не з того, що ви вибрали зараз, — блок відкритий тому, що деякі з них відрізняються від безпечних. Змініть будь-яке — і перевірка використає нове значення.',
    hints: {
      subdomains:
        'Також перевірити blog.example.com, shop.example.com та інші адреси вашого сайту.',
      userAgent: 'Читати сайт так, як його бачить браузер комп’ютера або телефона.',
      maxPages: 'Зупинитися після стількох сторінок. Порожнє поле — ліміт тарифу.',
      maxDepth:
        'На скільки кліків від головної сторінки заходить краулер. 0 — лише головна; порожнє поле — без обмеження глибини.',
      renderJs:
        'Чекати на скрипти сторінки, як браузер відвідувача. Залиште увімкненим, якщо немає причини вимикати.',
      robots:
        'robots.txt — це список сторінок, які сайт просить краулери пропускати. Вимикайте лише на власному сайті, коли треба перевірити саме ці сторінки.',
    },
    blockedByRobots:
      'Перевірка не почнеться, поки ви не поставите позначку вище або не увімкнете robots.txt знову.',
    blockedByRobotsStale:
      'Перевірка не почнеться, поки ви не поставите позначку вище або не увімкнете robots.txt знову. Позначка з попередньої перевірки ніколи не переноситься.',
    robotsWarning:
      'Ця перевірка ігноруватиме robots.txt і читатиме сторінки, які сайт просить краулери пропускати.',
    robotsWarningStale:
      'Це налаштування взято зі збережених налаштувань сайту, а не з того, що ви вибрали зараз, — підтвердьте ще раз, що ви цього хочете.',
    robotsConfirmLabel: 'Так, читати сторінки, які robots.txt просить пропускати',
    robotsBackOn: 'Знову увімкнути robots.txt',
    closeWindow: 'Закрити вікно',
    createProfile: 'Створити профіль',
    discard: {
      title: 'Відкинути незбережені налаштування?',
      // «перевірка», not «сканування»: the Ukrainian interface has one word
      // for this, and the string only slipped through because it used to be
      // written inline in the markup where no test could read it.
      body: 'Зміни до цієї нової перевірки буде втрачено.',
      keep: 'Продовжити редагування',
      discard: 'Відкинути зміни',
    },
    googleContext: {
      title: 'Дані Google (необов’язково)',
      loading: 'Перевіряємо підключені властивості Google…',
      ready:
        'Search Console або GA4 підключено для цього профілю. Цей контекст буде додано до аудиту; PageSpeed від підключення не залежить.',
      missing:
        'Підключіть Search Console або GA4, щоб додати контекст Google до цього аудиту. PageSpeed цього не потребує.',
      unavailable: 'Не вдалося перевірити підключення Google. Аудит все одно може продовжитися.',
      open: 'Відкрити інтеграції',
    },
  },
};
