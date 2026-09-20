import type { Language } from './i18n';

/** The same floor `packages/contracts` enforces on every password. */
export const PASSWORD_MIN_LENGTH = 8;

export type AccountCopy = {
  readonly navLabel: string;
  readonly windowTitle: string;
  readonly heading: string;
  readonly lead: string;
  readonly email: {
    readonly heading: string;
    readonly address: string;
    readonly status: string;
    readonly verified: string;
    readonly unverified: string;
    readonly unverifiedBody: string;
    readonly resend: string;
    readonly resending: string;
    readonly resent: (email: string) => string;
  };
  readonly banner: {
    readonly body: (email: string) => string;
    readonly resend: string;
    readonly dismiss: string;
  };
  readonly password: {
    readonly heading: string;
    readonly lead: string;
    readonly current: string;
    readonly next: string;
    readonly confirm: string;
    readonly hint: string;
    readonly submit: string;
    readonly saving: string;
    readonly tooShort: string;
    readonly mismatch: string;
    readonly wrongCurrent: string;
    readonly changed: string;
  };
  readonly purchases: {
    readonly heading: string;
    readonly lead: string;
    readonly empty: string;
    readonly date: string;
    readonly site: string;
    readonly plan: string;
    readonly amount: string;
    readonly status: string;
    readonly report: string;
    readonly open: string;
    readonly accessUntil: (date: string) => string;
    readonly statuses: Readonly<Record<string, string>>;
    readonly loadFailed: string;
  };
  readonly emails: {
    readonly heading: string;
    readonly lead: (email: string) => string;
    readonly items: readonly string[];
  };
  readonly deletion: {
    readonly heading: string;
    readonly body: string;
    readonly provider: string;
    readonly confirmLabel: (email: string) => string;
    readonly submit: string;
    readonly deleting: string;
    readonly deleted: string;
  };
};

export const accountCopy: Record<Language, AccountCopy> = {
  en: {
    navLabel: 'Account',
    windowTitle: 'FluxRadar — Account',
    heading: 'Your account',
    lead: 'Your email, password, purchases and the emails FluxRadar sends you.',
    email: {
      heading: 'Email',
      address: 'Address',
      status: 'Status',
      verified: 'Confirmed',
      unverified: 'Not confirmed',
      unverifiedBody:
        'Confirm your address so receipts, report notifications and password resets reach you.',
      resend: 'Send the confirmation email again',
      resending: 'Sending…',
      resent: (email) => `Sent to ${email}. The link is valid for 24 hours.`,
    },
    banner: {
      body: (email) =>
        `Confirm your email: we sent a link to ${email}. Receipts and "report ready" emails go there.`,
      resend: 'Send again',
      dismiss: 'Hide',
    },
    password: {
      heading: 'Password',
      lead: 'Changing the password signs you out on every other device.',
      current: 'Current password',
      next: 'New password',
      confirm: 'Repeat the new password',
      hint: `At least ${PASSWORD_MIN_LENGTH} characters.`,
      submit: 'Change password',
      saving: 'Saving…',
      tooShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
      mismatch: 'The two new passwords are different.',
      wrongCurrent: 'The current password is not correct.',
      changed: 'Password changed. Other devices were signed out.',
    },
    purchases: {
      heading: 'Purchases',
      lead: 'Every report you paid for. The free homepage check is not a purchase and is not listed.',
      empty: 'No purchases yet.',
      date: 'Date',
      site: 'Site',
      plan: 'Plan',
      amount: 'Amount',
      status: 'Payment',
      report: 'Report',
      open: 'Open',
      accessUntil: (date) => `New scans until ${date}`,
      statuses: { paid: 'Paid', Refunded: 'Refunded', Disputed: 'Disputed' },
      loadFailed: 'Purchases could not be loaded. Try again in a moment.',
    },
    emails: {
      heading: 'Emails we send',
      lead: (email) => `FluxRadar writes to ${email} only about your own purchases and scans:`,
      items: [
        'a receipt when a payment is confirmed',
        'when a paid scan starts and when its report is ready',
        'if a scan fails, and what happens to the payment',
        'when a refund is issued',
      ],
    },
    deletion: {
      heading: 'Delete account',
      body: 'Deleting the account removes your sites, every report and export, your purchase history in FluxRadar, connected Google and Bing accounts and every session. It cannot be undone.',
      provider:
        'The payment provider keeps its own order records and receipts, as the law requires.',
      confirmLabel: (email) => `Type ${email} to confirm`,
      submit: 'Delete my account',
      deleting: 'Deleting…',
      deleted: 'Your account and its data were deleted.',
    },
  },
  uk: {
    navLabel: 'Акаунт',
    windowTitle: 'FluxRadar — Акаунт',
    heading: 'Ваш акаунт',
    lead: 'Ваш email, пароль, покупки та листи, які надсилає FluxRadar.',
    email: {
      heading: 'Email',
      address: 'Адреса',
      status: 'Статус',
      verified: 'Підтверджено',
      unverified: 'Не підтверджено',
      unverifiedBody:
        'Підтвердьте адресу, щоб до вас доходили чеки, повідомлення про звіти та скидання пароля.',
      resend: 'Надіслати лист підтвердження ще раз',
      resending: 'Надсилаємо…',
      resent: (email) => `Надіслано на ${email}. Посилання дійсне 24 години.`,
    },
    banner: {
      body: (email) =>
        `Підтвердьте email: ми надіслали посилання на ${email}. Туди приходять чеки та листи «звіт готовий».`,
      resend: 'Надіслати ще раз',
      dismiss: 'Сховати',
    },
    password: {
      heading: 'Пароль',
      lead: 'Після зміни пароля ви вийдете з акаунта на всіх інших пристроях.',
      current: 'Поточний пароль',
      next: 'Новий пароль',
      confirm: 'Повторіть новий пароль',
      hint: `Щонайменше ${PASSWORD_MIN_LENGTH} символів.`,
      submit: 'Змінити пароль',
      saving: 'Зберігаємо…',
      tooShort: `Використайте щонайменше ${PASSWORD_MIN_LENGTH} символів.`,
      mismatch: 'Нові паролі не збігаються.',
      wrongCurrent: 'Поточний пароль неправильний.',
      changed: 'Пароль змінено. Інші пристрої вийшли з акаунта.',
    },
    purchases: {
      heading: 'Покупки',
      lead: 'Усі звіти, за які ви заплатили. Безкоштовна перевірка головної — не покупка, тому її тут немає.',
      empty: 'Покупок ще немає.',
      date: 'Дата',
      site: 'Сайт',
      plan: 'Тариф',
      amount: 'Сума',
      status: 'Оплата',
      report: 'Звіт',
      open: 'Відкрити',
      accessUntil: (date) => `Нові перевірки до ${date}`,
      statuses: { paid: 'Оплачено', Refunded: 'Повернено', Disputed: 'Оскаржено' },
      loadFailed: 'Не вдалося завантажити покупки. Спробуйте за мить.',
    },
    emails: {
      heading: 'Які листи ми надсилаємо',
      lead: (email) => `FluxRadar пише на ${email} лише про ваші покупки й перевірки:`,
      items: [
        'чек, коли оплату підтверджено',
        'коли платна перевірка почалася і коли звіт готовий',
        'якщо перевірка не вдалася — і що буде з оплатою',
        'коли оформлено повернення коштів',
      ],
    },
    deletion: {
      heading: 'Видалити акаунт',
      body: 'Видалення акаунта прибирає ваші сайти, усі звіти й експорти, історію покупок у FluxRadar, підключені акаунти Google і Bing та всі сесії. Цю дію не можна скасувати.',
      provider:
        'Платіжний провайдер зберігає власні записи замовлень і чеки, як того вимагає закон.',
      confirmLabel: (email) => `Введіть ${email}, щоб підтвердити`,
      submit: 'Видалити мій акаунт',
      deleting: 'Видаляємо…',
      deleted: 'Ваш акаунт і його дані видалено.',
    },
  },
};
