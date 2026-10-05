import type { Language } from './i18n';

export type NextStepKind =
  | 'noProfiles'
  | 'noScans'
  | 'running'
  | 'partial'
  | 'freeDone'
  | 'paidDone'
  | 'failed'
  /** Finished, but no page of the site could be read: nothing to work through. */
  | 'unread';

export type DesktopCopy = {
  readonly addSiteToggle: string;
  /** Names the "⋯" button of a site row, which shows only an icon. */
  readonly rowActions: (name: string) => string;
  readonly contextSummary: string;
  readonly profileSaved: (name: string) => string;
  readonly profileUpdated: (name: string) => string;
  /** Names the site a per-site status block is about: its name and address. */
  readonly siteHeading: (name: string, domain: string) => string;
  readonly nextStep: {
    readonly heading: string;
    readonly titles: Readonly<Record<NextStepKind, string>>;
    readonly bodies: Readonly<Record<NextStepKind, (domain: string) => string>>;
    readonly actions: Readonly<Record<NextStepKind, (domain: string) => string>>;
    readonly freeReport: (domain: string) => string;
    readonly openReport: (domain: string) => string;
  };
};

export const desktopCopy: Record<Language, DesktopCopy> = {
  en: {
    addSiteToggle: '+ Add a site',
    rowActions: (name) => `Actions for ${name}`,
    contextSummary: 'Describe the site for AI visibility checks (optional)',
    profileSaved: (name) => `“${name}” saved. Start a check from its row.`,
    profileUpdated: (name) => `“${name}” updated.`,
    siteHeading: (name, domain) => `${name} · ${domain}`,
    nextStep: {
      heading: 'Next step',
      titles: {
        noProfiles: 'Add your site',
        noScans: 'Run the free homepage check',
        running: 'Your scan is running',
        partial: 'A section could not be read',
        freeDone: 'See the whole site',
        paidDone: 'Work through your report',
        failed: 'The last scan did not finish',
        unread: 'Review what went wrong',
      },
      bodies: {
        noProfiles: () =>
          'Enter its homepage address. Saving a site costs nothing and starts nothing.',
        noScans: (domain) =>
          `Four checks on the homepage of ${domain}: title, description, headings and indexability. Free, about a minute.`,
        running: (domain) =>
          `FluxRadar is reading ${domain}. You can leave this page; the report waits for you.`,
        partial: (domain) =>
          `The report for ${domain} is ready, but at least one section came back incomplete. You can retry the unfinished section once, at no extra charge.`,
        freeDone: () =>
          'The free check read the homepage only. Complete reads every public page and every section — security, accessibility, performance, privacy and AI visibility.',
        paidDone: () => 'Start with the most urgent problems; each one is a single fix.',
        failed: () =>
          'Open it to see why. A scan that failed on our side is run once more by itself; if it failed again and was paid for, a refund is recorded automatically and issued by hand through Creem.',
        unread: (domain) =>
          `We could not read any page of ${domain}: the site refused our crawler, its robots.txt disallowed it, or it did not answer at all. If this check was paid for, it counts as not delivered: a refund is recorded for it automatically, without you asking, and is then issued by hand through Creem, so it is not instant. Open the scan to see what the site returned.`,
      },
      actions: {
        noProfiles: () => 'Add a site',
        noScans: (domain) => `Check ${domain}`,
        running: () => 'Follow progress',
        partial: () => 'Retry the unfinished section',
        freeDone: (domain) => `Run Complete for ${domain}`,
        paidDone: (domain) => `Open the report for ${domain}`,
        failed: (domain) => `Open the scan for ${domain}`,
        unread: (domain) => `Open the scan for ${domain}`,
      },
      freeReport: (domain) => `Open the free report for ${domain}`,
      openReport: (domain) => `Open the report for ${domain}`,
    },
  },
  uk: {
    addSiteToggle: '+ Додати сайт',
    rowActions: (name) => `Дії для ${name}`,
    contextSummary: 'Опишіть сайт для перевірок видимості в AI (необовʼязково)',
    profileSaved: (name) => `«${name}» збережено. Запустіть перевірку з його рядка.`,
    profileUpdated: (name) => `«${name}» оновлено.`,
    siteHeading: (name, domain) => `${name} · ${domain}`,
    nextStep: {
      heading: 'Наступний крок',
      titles: {
        noProfiles: 'Додайте свій сайт',
        noScans: 'Запустіть безкоштовну перевірку головної',
        running: 'Перевірка триває',
        partial: 'Один розділ не вдалося прочитати',
        freeDone: 'Подивіться на весь сайт',
        paidDone: 'Опрацюйте звіт',
        failed: 'Остання перевірка не завершилася',
        unread: 'Перегляньте, що пішло не так',
      },
      bodies: {
        noProfiles: () =>
          'Введіть адресу головної сторінки. Збереження сайту нічого не коштує і нічого не запускає.',
        noScans: (domain) =>
          `Чотири перевірки головної сторінки ${domain}: title, опис, заголовки та індексація. Безкоштовно, близько хвилини.`,
        running: (domain) =>
          `FluxRadar читає ${domain}. Можна піти з цієї сторінки — звіт на вас почекає.`,
        partial: (domain) =>
          `Звіт для ${domain} готовий, але щонайменше один розділ повернувся неповним. Його можна один раз перезапустити без доплати.`,
        freeDone: () =>
          'Безкоштовна перевірка прочитала лише головну. Complete читає всі публічні сторінки й усі розділи — безпеку, доступність, швидкодію, приватність і видимість в AI.',
        paidDone: () => 'Почніть із найтерміновіших проблем — кожна виправляється одним рішенням.',
        failed: () =>
          'Відкрийте її, щоб побачити причину. Перевірку, що зламалася з нашого боку, ми самі запускаємо ще раз; якщо вона знову не вдалася і була платною, повернення коштів фіксується автоматично й оформлюється вручну через Creem.',
        unread: (domain) =>
          `Нам не вдалося прочитати жодної сторінки ${domain}: сайт не пустив наш краулер, його robots.txt заборонив читання, або сайт не відповів зовсім. Якщо перевірка була платною, вона вважається не виконаною: повернення коштів для неї фіксується автоматично, просити не потрібно, а далі його вручну оформлюють через Creem, тож це не миттєво. Відкрийте перевірку, щоб побачити, що саме відповів сайт.`,
      },
      actions: {
        noProfiles: () => 'Додати сайт',
        noScans: (domain) => `Перевірити ${domain}`,
        running: () => 'Стежити за перевіркою',
        partial: () => 'Перезапустити незавершений розділ',
        freeDone: (domain) => `Запустити Complete для ${domain}`,
        paidDone: (domain) => `Відкрити звіт для ${domain}`,
        failed: (domain) => `Відкрити перевірку для ${domain}`,
        unread: (domain) => `Відкрити перевірку для ${domain}`,
      },
      freeReport: (domain) => `Відкрити безкоштовний звіт для ${domain}`,
      openReport: (domain) => `Відкрити звіт для ${domain}`,
    },
  },
};
