import type { Language } from './i18n';

export type NextStepKind =
  'noProfiles' | 'noScans' | 'running' | 'partial' | 'freeDone' | 'paidDone' | 'failed';

export type DesktopCopy = {
  readonly addSiteToggle: string;
  /** Names the "⋯" button of a site row, which shows only an icon. */
  readonly rowActions: (name: string) => string;
  readonly contextSummary: string;
  readonly profileSaved: (name: string) => string;
  readonly profileUpdated: (name: string) => string;
  readonly nextStep: {
    readonly heading: string;
    readonly titles: Readonly<Record<NextStepKind, string>>;
    readonly bodies: Readonly<Record<NextStepKind, (domain: string) => string>>;
    readonly actions: Readonly<Record<NextStepKind, (domain: string) => string>>;
    readonly freeReport: string;
    readonly openReport: string;
  };
};

export const desktopCopy: Record<Language, DesktopCopy> = {
  en: {
    addSiteToggle: '+ Add a site',
    rowActions: (name) => `Actions for ${name}`,
    contextSummary: 'Describe the site for AI visibility checks (optional)',
    profileSaved: (name) => `“${name}” saved. Start a check from its row.`,
    profileUpdated: (name) => `“${name}” updated.`,
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
          'Open it to see why. A scan that failed on the platform side is retried or refunded.',
      },
      actions: {
        noProfiles: () => 'Add a site',
        noScans: (domain) => `Check ${domain}`,
        running: () => 'Follow progress',
        partial: () => 'Retry the unfinished section',
        freeDone: (domain) => `Run Complete for ${domain}`,
        paidDone: () => 'Open the report',
        failed: () => 'Open the scan',
      },
      freeReport: 'Open the free report',
      openReport: 'Open the report',
    },
  },
  uk: {
    addSiteToggle: '+ Додати сайт',
    rowActions: (name) => `Дії для ${name}`,
    contextSummary: 'Опишіть сайт для перевірок видимості в AI (необовʼязково)',
    profileSaved: (name) => `«${name}» збережено. Запустіть перевірку з його рядка.`,
    profileUpdated: (name) => `«${name}» оновлено.`,
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
          'Відкрийте її, щоб побачити причину. Перевірку, що зламалася з нашого боку, повторюють або повертають кошти.',
      },
      actions: {
        noProfiles: () => 'Додати сайт',
        noScans: (domain) => `Перевірити ${domain}`,
        running: () => 'Стежити за перевіркою',
        partial: () => 'Перезапустити незавершений розділ',
        freeDone: (domain) => `Запустити Complete для ${domain}`,
        paidDone: () => 'Відкрити звіт',
        failed: () => 'Відкрити перевірку',
      },
      freeReport: 'Відкрити безкоштовний звіт',
      openReport: 'Відкрити звіт',
    },
  },
};
