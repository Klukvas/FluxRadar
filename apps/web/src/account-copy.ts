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
    readonly deliveryUnavailable: string;
    readonly deliveryFailed: string;
    readonly resend: string;
    readonly resending: string;
    readonly resent: (email: string) => string;
  };
  readonly banner: {
    readonly body: (email: string) => string;
    readonly pending: (email: string) => string;
    readonly resend: string;
    readonly dismiss: string;
    /** The banner's own Hide, which says how long hiding lasts. */
    readonly dismissSession: string;
    /**
     * The compact version a phone shows; the full sentence stays in the DOM for
     * screen readers.
     *
     * It carries the reason, not only the ask. Clamped to one line it read
     * "Confirm your email." and nothing else, so the one fact that makes the
     * banner worth acting on — the password-reset link goes only there — was
     * invisible on exactly the screen where the banner is most in the way. Two
     * lines at 360px is the budget (narrow-screens.css clamps it), in English
     * and in Ukrainian, so these stay short.
     */
    readonly short: {
      readonly confirm: string;
      readonly deliveryUnavailable: string;
      readonly deliveryFailed: string;
    };
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
      unverifiedBody: 'Confirm your address so payment and password emails reach you.',
      deliveryUnavailable:
        'Email is not configured in this workspace yet, so no confirmation link was sent.',
      deliveryFailed: 'The confirmation email could not be delivered. Try again later.',
      resend: 'Send the confirmation email again',
      resending: 'Sending…',
      resent: (email) =>
        `A confirmation request for ${email} was accepted. The link is valid for 24 hours if delivery is available.`,
    },
    banner: {
      // The reason, not just the ask: letters about payments and the link that
      // resets a forgotten password go to this address and nowhere else, so an
      // address with a typo in it is one nothing can reach.
      body: (email) =>
        `Confirm your email: we sent a link to ${email}. Letters about your payments, and the link that resets a forgotten password, go only there — confirming is how we know the address works.`,
      pending: (email) =>
        `Confirm your email at ${email}. Letters about your payments, and the link that resets a forgotten password, go only there. Check your inbox or ask for a new link.`,
      resend: 'Send again',
      dismiss: 'Hide',
      // Says what it does: sessionStorage, so it comes back on the next visit.
      dismissSession: 'Hide until my next visit',
      short: {
        confirm: 'Confirm your email — the link that resets a forgotten password goes only there.',
        deliveryUnavailable: 'No confirmation email was sent: email is not set up here yet.',
        deliveryFailed: 'The confirmation email did not arrive. Try sending it again.',
      },
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
      lead: (email) =>
        `FluxRadar writes to ${email} about your account and payments only — a scan's own progress stays in the app:`,
      items: [
        'when a payment is confirmed and your scan can run',
        'when a refund is issued',
        'the confirmation and password-reset links you ask for',
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
      unverifiedBody: 'Підтвердьте адресу, щоб до вас доходили листи про оплати та пароль.',
      deliveryUnavailable:
        'Email у цьому робочому середовищі ще не налаштований, тому посилання для підтвердження не надіслано.',
      deliveryFailed: 'Не вдалося доставити лист для підтвердження. Спробуйте пізніше.',
      resend: 'Надіслати лист підтвердження ще раз',
      resending: 'Надсилаємо…',
      resent: (email) =>
        `Запит на підтвердження для ${email} прийнято. Посилання дійсне 24 години, якщо доставка доступна.`,
    },
    banner: {
      body: (email) =>
        `Підтвердьте email: ми надіслали посилання на ${email}. Листи про ваші оплати й посилання для відновлення забутого пароля приходять лише туди — підтвердження показує нам, що адреса працює.`,
      pending: (email) =>
        `Підтвердьте email ${email}. Листи про ваші оплати й посилання для відновлення забутого пароля приходять лише туди. Перевірте пошту або попросіть нове посилання.`,
      resend: 'Надіслати ще раз',
      dismiss: 'Сховати',
      dismissSession: 'Сховати до наступного візиту',
      short: {
        confirm: 'Підтвердьте email — лист для відновлення пароля приходить лише туди.',
        deliveryUnavailable: 'Лист не надіслано: email тут ще не налаштований.',
        deliveryFailed: 'Лист не дійшов. Спробуйте надіслати ще раз.',
      },
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
      lead: (email) =>
        `FluxRadar пише на ${email} лише про акаунт і оплати — хід самої перевірки видно в застосунку:`,
      items: [
        'коли оплату підтверджено і перевірку можна запускати',
        'коли оформлено повернення коштів',
        'посилання для підтвердження email і зміни пароля, коли ви їх запросили',
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
