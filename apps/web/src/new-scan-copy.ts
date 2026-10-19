import type { Language } from './i18n';
import type { Plan } from './plan-modules';

/**
 * The new-scan screen's plain-language layer: the three numbered steps, the
 * plan cards, the order summary beside them, the folded section for settings
 * most owners never touch, and the warning a carried-over robots.txt override
 * earns. The screen says "site" where the rest of the app says "profile": it is
 * what a buyer is choosing, and the word the persona reviews tripped on.
 *
 * Kept apart from `i18n.ts` so the screen's own wording can change without
 * touching the shared catalogue.
 */
export type NewScanClarityCopy = {
  /** The three numbered steps the left column is read as. */
  readonly steps: {
    readonly site: string;
    readonly plan: string;
    readonly reach: string;
  };
  /** Step 1: the saved site the scan runs against. */
  readonly site: {
    readonly label: string;
    readonly hint: string;
    /** Said instead of the picker while the account has no saved site. */
    readonly noneLead: string;
  };
  /** Step 2: one card per plan, priced from `tariff-prices.ts`. */
  readonly planCards: Readonly<Record<Plan, { readonly name: string; readonly line: string }>>;
  readonly planRecommended: string;
  /** The same badge as a screen reader hears it, at the end of the card's name. */
  readonly planRecommendedSpoken: string;
  /** The price on a card when an internal account pays nothing. */
  readonly planInternalPrice: string;
  /** Step 3: why the question is asked, and what replaces it where nothing is bought. */
  readonly reach: {
    readonly hint: string;
    readonly freeNote: string;
    readonly internalNote: string;
  };
  /** The order summary beside the steps. */
  readonly summary: {
    readonly title: string;
    readonly site: string;
    readonly plan: string;
    readonly pages: string;
    readonly checks: string;
    readonly pagesHomepage: string;
    readonly pagesAll: (limit: string) => string;
    readonly pagesOwner: (limit: string) => string;
    readonly checksByPlan: Readonly<Record<Plan, string>>;
    readonly total: string;
    readonly totalFree: string;
    readonly totalInternal: string;
    readonly noSubscription: string;
  };
  readonly noSiteChosen: string;
  /** "For advanced users": the folded section holding everything technical. */
  readonly expertTitle: string;
  /** The rows that used to be the "What will run" table, inside that section. */
  readonly technicalTitle: string;
  /** The crawl settings block inside that section. */
  readonly crawlSettingsTitle: string;
  readonly saveSettings: string;
  readonly savingSettings: string;
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

export const newScanCopy: Record<Language, NewScanClarityCopy> = {
  en: {
    steps: {
      site: 'Which site are we checking?',
      plan: 'What should we check?',
      reach: 'Can we read your site?',
    },
    site: {
      label: 'Site',
      hint: 'We read only what any visitor sees. No passwords or site access needed.',
      noneLead: 'No saved sites yet — add your site first, then choose it here.',
    },
    planCards: {
      Free: {
        name: 'Free',
        line: 'Homepage only: its title, description and whether Google can show it.',
      },
      Basic: {
        name: 'Basic',
        line: 'Why you are not found in Google and AI assistants: broken links, pages with no description, duplicates, what ChatGPT sees.',
      },
      Complete: {
        name: 'Complete',
        line: 'Everything together: search, AI and site health in one report.',
      },
    },
    planRecommended: 'GOOD PLACE TO START',
    planRecommendedSpoken: 'recommended',
    planInternalPrice: 'internal',
    reach: {
      hint: 'We check this before payment so you never pay for a site we cannot read.',
      freeNote: 'The free check does not need this step: nothing is paid for.',
      internalNote: 'Internal scans skip this step: nothing is paid for.',
    },
    summary: {
      title: 'Your report',
      site: 'Site',
      plan: 'Plan',
      pages: 'Pages',
      checks: 'We check',
      pagesHomepage: 'homepage only',
      pagesAll: (limit) => `all, up to ${limit}`,
      pagesOwner: (limit) => `up to ${limit}`,
      checksByPlan: {
        Free: 'your homepage',
        Basic: 'Google and AI assistants',
        Complete: 'everything together',
      },
      total: 'Total, one-time',
      totalFree: 'Free',
      totalInternal: 'Internal, no charge',
      noSubscription: 'no subscription',
    },
    noSiteChosen: 'No site chosen yet',
    expertTitle: 'For advanced users',
    technicalTitle: 'What the crawler will do',
    crawlSettingsTitle: 'Crawl settings',
    saveSettings: 'Save these settings for the site',
    savingSettings: 'Saving settings…',
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
    createProfile: 'Add a site',
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
        'Search Console or GA4 is connected for this site. That context will be included in the audit; PageSpeed is independent of this connection.',
      missing:
        'Connect Search Console or GA4 to add Google context to this audit. PageSpeed does not need a connection.',
      unavailable: 'Google connection status is unavailable. The audit can still continue.',
      open: 'Open integrations',
    },
  },
  uk: {
    steps: {
      site: 'Який сайт перевіряємо?',
      plan: 'Що перевірити?',
      reach: 'Чи можемо ми прочитати ваш сайт?',
    },
    site: {
      label: 'Сайт',
      hint: 'Ми читаємо лише те, що бачить будь-який відвідувач. Паролі й доступ до сайту не потрібні.',
      noneLead: 'Збережених сайтів ще немає — спершу додайте свій сайт, а потім виберіть його тут.',
    },
    planCards: {
      Free: {
        name: 'Безкоштовно',
        line: 'Лише головна сторінка: заголовок, опис і чи може Google її показати.',
      },
      Basic: {
        name: 'Basic',
        line: 'Чому вас не знаходять у Google і ШІ-помічниках: биті посилання, сторінки без опису, дублікати, що бачить ChatGPT.',
      },
      Complete: {
        name: 'Complete',
        line: 'Усе разом: пошук, ШІ і стан сайту в одному звіті.',
      },
    },
    planRecommended: 'РАДИМО ПОЧАТИ',
    planRecommendedSpoken: 'радимо',
    planInternalPrice: 'внутрішній',
    reach: {
      hint: 'Перевіряємо це до оплати, щоб ви не заплатили за сайт, який неможливо прочитати.',
      freeNote: 'Безкоштовній перевірці цей крок не потрібен: ви нічого не оплачуєте.',
      internalNote: 'Внутрішня перевірка пропускає цей крок: ви нічого не оплачуєте.',
    },
    summary: {
      title: 'Ваш звіт',
      site: 'Сайт',
      plan: 'Тариф',
      pages: 'Сторінок',
      checks: 'Перевіримо',
      pagesHomepage: 'лише головна',
      pagesAll: (limit) => `усі, до ${limit}`,
      pagesOwner: (limit) => `до ${limit}`,
      checksByPlan: {
        Free: 'головну сторінку',
        Basic: 'Google і ШІ-помічники',
        Complete: 'усе разом',
      },
      total: 'Разом, один раз',
      totalFree: 'Безкоштовно',
      totalInternal: 'Внутрішня, без оплати',
      noSubscription: 'без підписки',
    },
    noSiteChosen: 'Сайт ще не вибрано',
    expertTitle: 'Для досвідчених користувачів',
    technicalTitle: 'Що саме зробить краулер',
    crawlSettingsTitle: 'Налаштування обходу',
    saveSettings: 'Зберегти ці налаштування для сайту',
    savingSettings: 'Зберігаємо налаштування…',
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
    createProfile: 'Додати сайт',
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
        'Search Console або GA4 підключено для цього сайту. Цей контекст буде додано до аудиту; PageSpeed від підключення не залежить.',
      missing:
        'Підключіть Search Console або GA4, щоб додати контекст Google до цього аудиту. PageSpeed цього не потребує.',
      unavailable: 'Не вдалося перевірити підключення Google. Аудит все одно може продовжитися.',
      open: 'Відкрити інтеграції',
    },
  },
};
