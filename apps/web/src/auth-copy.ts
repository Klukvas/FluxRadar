import type { Language } from './i18n';

export type AuthCopy = {
  readonly titles: {
    readonly login: string;
    readonly register: string;
    readonly forgot: string;
    readonly reset: string;
    readonly verify: string;
  };
  readonly headings: {
    readonly login: string;
    readonly register: string;
    readonly forgot: string;
    readonly reset: string;
    readonly resetDone: string;
    readonly verify: string;
    readonly verified: string;
  };
  readonly leads: {
    readonly login: string;
    readonly register: string;
    readonly registerForSite: (domain: string) => string;
    readonly forgot: string;
    readonly forgotSent: string;
    readonly reset: string;
    readonly resetDone: string;
    readonly verifying: string;
    readonly verified: string;
    readonly verifyPending: string;
  };
  readonly email: string;
  readonly emailPlaceholder: string;
  readonly password: string;
  readonly newPassword: string;
  readonly passwordPlaceholder: string;
  readonly showPassword: string;
  readonly rememberMe: string;
  readonly cookieNote: string;
  readonly consentNote: string;
  readonly working: string;
  readonly submit: {
    readonly login: string;
    readonly register: string;
    readonly forgot: string;
    readonly reset: string;
  };
  readonly toRegister: string;
  readonly toLogin: string;
  readonly toHome: string;
  readonly toWorkspace: string;
  readonly forgotLink: string;
  readonly failed: string;
  readonly verificationFailed: string;
};

export const authCopy: Record<Language, AuthCopy> = {
  en: {
    titles: {
      login: 'FluxRadar — Sign in',
      register: 'FluxRadar — Create account',
      forgot: 'FluxRadar — Reset password',
      reset: 'FluxRadar — Set password',
      verify: 'FluxRadar — Verify email',
    },
    headings: {
      login: 'Welcome back',
      register: 'Create your FluxRadar account',
      forgot: 'Reset your password',
      reset: 'Set a new password',
      resetDone: 'Password updated',
      verify: 'Verify your email',
      verified: 'Email verified',
    },
    leads: {
      login: 'Sign in to your sites, reports and issue history.',
      register:
        'One account keeps your sites, reports and issue history together. The first homepage check is free.',
      registerForSite: (domain) =>
        `Create an account and FluxRadar checks the homepage of ${domain} straight away — free, no card.`,
      forgot: 'Enter your account email. We never reveal whether an address is registered.',
      forgotSent: 'If an account exists, a reset link has been sent. Check your inbox.',
      reset: 'Choose a new password for your FluxRadar account.',
      resetDone: 'Your password was changed. Sign in again with the new password.',
      verifying: 'Checking your one-time link…',
      verified: 'Your email is verified. You can return to FluxRadar.',
      verifyPending: 'The verification link is being checked.',
    },
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    newPassword: 'New password',
    passwordPlaceholder: '8+ characters',
    showPassword: 'Show password',
    rememberMe: 'Remember me for 7 days',
    cookieNote: 'Sign-in uses a necessary cookie. Learn more: ',
    consentNote: 'By creating an account, you agree to the terms and acknowledge the policies: ',
    working: 'Working…',
    submit: {
      login: 'Sign in',
      register: 'Create account',
      forgot: 'Send reset link',
      reset: 'Update password',
    },
    toRegister: 'Create an account',
    toLogin: 'I already have an account',
    toHome: 'Back to home',
    toWorkspace: 'Open FluxRadar',
    forgotLink: 'Forgot password?',
    failed: 'Authentication failed',
    verificationFailed: 'Verification failed',
  },
  uk: {
    titles: {
      login: 'FluxRadar — Вхід',
      register: 'FluxRadar — Створення акаунта',
      forgot: 'FluxRadar — Скидання пароля',
      reset: 'FluxRadar — Новий пароль',
      verify: 'FluxRadar — Підтвердження email',
    },
    headings: {
      login: 'З поверненням',
      register: 'Створіть акаунт FluxRadar',
      forgot: 'Скидання пароля',
      reset: 'Встановіть новий пароль',
      resetDone: 'Пароль оновлено',
      verify: 'Підтвердіть email',
      verified: 'Email підтверджено',
    },
    leads: {
      login: 'Увійдіть до своїх сайтів, звітів та історії проблем.',
      register:
        'Один акаунт тримає разом ваші сайти, звіти та історію проблем. Перша перевірка головної сторінки — безкоштовна.',
      registerForSite: (domain) =>
        `Створіть акаунт — і FluxRadar одразу перевірить головну сторінку ${domain}. Безкоштовно, без картки.`,
      forgot: 'Введіть email акаунта. Ми ніколи не повідомляємо, чи зареєстрована адреса.',
      forgotSent: 'Якщо акаунт існує, посилання для скидання надіслано. Перевірте пошту.',
      reset: 'Оберіть новий пароль для акаунта FluxRadar.',
      resetDone: 'Пароль змінено. Увійдіть знову з новим паролем.',
      verifying: 'Перевіряємо одноразове посилання…',
      verified: 'Ваш email підтверджено. Можна повертатися до FluxRadar.',
      verifyPending: 'Посилання підтвердження перевіряється.',
    },
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Пароль',
    newPassword: 'Новий пароль',
    passwordPlaceholder: 'від 8 символів',
    showPassword: 'Показати пароль',
    rememberMe: 'Запамʼятати вхід на 7 днів',
    cookieNote: 'Вхід використовує необхідний cookie. Докладніше: ',
    consentNote:
      'Створюючи акаунт, ви погоджуєтеся з умовами та підтверджуєте ознайомлення з політиками: ',
    working: 'Зачекайте…',
    submit: {
      login: 'Увійти',
      register: 'Створити акаунт',
      forgot: 'Надіслати посилання',
      reset: 'Оновити пароль',
    },
    toRegister: 'Створити акаунт',
    toLogin: 'У мене вже є акаунт',
    toHome: 'На головну',
    toWorkspace: 'Відкрити FluxRadar',
    forgotLink: 'Забули пароль?',
    failed: 'Не вдалося увійти',
    verificationFailed: 'Не вдалося підтвердити email',
  },
};
