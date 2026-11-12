import type { AuthFieldProblem } from './auth-validation';
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
    readonly verifyFailed: string;
  };
  readonly email: string;
  readonly emailPlaceholder: string;
  readonly password: string;
  readonly newPassword: string;
  readonly passwordPlaceholder: string;
  readonly showPassword: string;
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
  /** A field the form checked itself before sending, in the reader's words. */
  readonly problems: Readonly<Record<AuthFieldProblem, string>>;
  /** The server refused the fields; its own wording is for developers, not shown. */
  readonly checkFields: string;
  readonly googleContinue: string;
  readonly googleOrEmail: string;
  readonly googleUnavailable: string;
  readonly googleChecking: string;
  readonly googleFailed: string;
  readonly googleCancelled: string;
  readonly googleEmailExists: string;
  readonly googleUseEmail: string;
  readonly googleEmailChanged: string;
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
      verifyFailed:
        'This link did not work: it may have expired or already been used. Sign in and send yourself a new one from your account page.',
    },
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    newPassword: 'New password',
    passwordPlaceholder: '8+ characters',
    showPassword: 'Show password',
    cookieNote: 'Sign-in uses a necessary cookie that lasts for this browser session. Learn more: ',
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
    problems: {
      emailMissing: 'Enter your email address.',
      emailInvalid: 'This email address does not look right. Check it for typos.',
      passwordMissing: 'Enter your password.',
      passwordTooShort: 'Choose a password of at least 8 characters.',
      passwordTooLong: 'This password is too long. Use a shorter one.',
    },
    checkFields: 'Check the email and password and try again.',
    googleEmailChanged:
      'Your Google email has changed. For account security, use your FluxRadar password or contact support to recover access.',
    googleUseEmail:
      'For this Google account, please register or sign in by email. Google cannot confirm current ownership of this address.',
    googleContinue: 'Continue with Google',
    googleOrEmail: 'Or continue with email',
    googleUnavailable: 'Google sign-in is currently unavailable. You can use email.',
    googleChecking: 'Checking Google sign-in…',
    googleFailed:
      'Google sign-in could not finish. Try again or use email. For a non-Gmail address, use your Google Workspace account or register by email.',
    googleCancelled: 'Google sign-in was cancelled. You can try again or use email.',
    googleEmailExists:
      'Google sign-in could not finish because this email already has a FluxRadar account. Sign in with your password, or reset it by email. Accounts are never linked automatically.',
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
      verifyFailed:
        'Це посилання не спрацювало: можливо, воно застаріло або вже використане. Увійдіть і надішліть собі нове на сторінці акаунта.',
    },
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Пароль',
    newPassword: 'Новий пароль',
    passwordPlaceholder: 'від 8 символів',
    showPassword: 'Показати пароль',
    cookieNote:
      'Вхід використовує необхідний cookie, який діє протягом цієї сесії браузера. Докладніше: ',
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
    problems: {
      emailMissing: 'Введіть адресу email.',
      emailInvalid: 'Ця адреса email виглядає неправильно. Перевірте, чи немає помилки.',
      passwordMissing: 'Введіть пароль.',
      passwordTooShort: 'Пароль має містити щонайменше 8 символів.',
      passwordTooLong: 'Пароль задовгий. Оберіть коротший.',
    },
    checkFields: 'Перевірте email і пароль та спробуйте ще раз.',
    googleEmailChanged:
      'Email вашого Google-акаунта змінився. Для безпеки увійдіть із паролем FluxRadar або зверніться до підтримки для відновлення доступу.',
    googleUseEmail:
      'Для цього Google-акаунта зареєструйтеся або увійдіть через email. Google не може підтвердити поточного власника цієї адреси.',
    googleContinue: 'Продовжити з Google',
    googleOrEmail: 'Або продовжте через email',
    googleUnavailable: 'Вхід через Google наразі недоступний. Скористайтеся email.',
    googleChecking: 'Перевіряємо вхід через Google…',
    googleFailed:
      'Не вдалося завершити вхід через Google. Спробуйте ще раз або скористайтеся email. Для адреси поза Gmail потрібен акаунт Google Workspace; інакше зареєструйтеся через email.',
    googleCancelled: 'Вхід через Google скасовано. Спробуйте ще раз або скористайтеся email.',
    googleEmailExists:
      'Не вдалося увійти через Google: для цього email уже є акаунт FluxRadar. Увійдіть із паролем або скиньте його через email. Акаунти ніколи не об’єднуються автоматично.',
  },
  ru: {
    titles: {
      login: 'FluxRadar / Вход',
      register: 'FluxRadar / Создание аккаунта',
      forgot: 'FluxRadar / Сброс пароля',
      reset: 'FluxRadar / Новый пароль',
      verify: 'FluxRadar / Подтверждение email',
    },
    headings: {
      login: 'С возвращением',
      register: 'Создайте аккаунт FluxRadar',
      forgot: 'Сброс пароля',
      reset: 'Установите новый пароль',
      resetDone: 'Пароль обновлён',
      verify: 'Подтвердите email',
      verified: 'Email подтверждён',
    },
    leads: {
      login: 'Войдите к своим сайтам, отчётам и истории проблем.',
      register:
        'Один аккаунт держит вместе ваши сайты, отчёты и историю проблем. Первая проверка главной страницы доступна сразу.',
      registerForSite: (domain) =>
        `Создайте аккаунт, и FluxRadar сразу проверит главную страницу ${domain}.`,
      forgot: 'Введите email аккаунта. Мы никогда не сообщаем, зарегистрирован ли адрес.',
      forgotSent: 'Если аккаунт существует, ссылка для сброса отправлена. Проверьте почту.',
      reset: 'Выберите новый пароль для аккаунта FluxRadar.',
      resetDone: 'Пароль изменён. Войдите снова с новым паролем.',
      verifying: 'Проверяем одноразовую ссылку…',
      verified: 'Ваш email подтверждён. Можно возвращаться в FluxRadar.',
      verifyPending: 'Ссылка подтверждения проверяется.',
      verifyFailed:
        'Эта ссылка не сработала: возможно, она устарела или уже использована. Войдите и отправьте себе новую на странице аккаунта.',
    },
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Пароль',
    newPassword: 'Новый пароль',
    passwordPlaceholder: 'от 8 символов',
    showPassword: 'Показать пароль',
    cookieNote:
      'Вход использует необходимый cookie, который действует в течение этой сессии браузера. Подробнее: ',
    consentNote:
      'Создавая аккаунт, вы соглашаетесь с условиями и подтверждаете ознакомление с политиками: ',
    working: 'Подождите…',
    submit: {
      login: 'Войти',
      register: 'Создать аккаунт',
      forgot: 'Отправить ссылку',
      reset: 'Обновить пароль',
    },
    toRegister: 'Создать аккаунт',
    toLogin: 'У меня уже есть аккаунт',
    toHome: 'На главную',
    toWorkspace: 'Открыть FluxRadar',
    forgotLink: 'Забыли пароль?',
    failed: 'Не удалось войти',
    verificationFailed: 'Не удалось подтвердить email',
    problems: {
      emailMissing: 'Введите адрес email.',
      emailInvalid: 'Этот адрес email выглядит неправильно. Проверьте, нет ли опечатки.',
      passwordMissing: 'Введите пароль.',
      passwordTooShort: 'Пароль должен быть не короче 8 символов.',
      passwordTooLong: 'Пароль слишком длинный. Выберите покороче.',
    },
    checkFields: 'Проверьте email и пароль и попробуйте ещё раз.',
    googleEmailChanged:
      'Email вашего Google-аккаунта изменился. Для безопасности войдите с паролем FluxRadar или обратитесь в поддержку для восстановления доступа.',
    googleUseEmail:
      'Для этого Google-аккаунта зарегистрируйтесь или войдите через email. Google не может подтвердить текущего владельца этого адреса.',
    googleContinue: 'Продолжить с Google',
    googleOrEmail: 'Или продолжите через email',
    googleUnavailable: 'Вход через Google сейчас недоступен. Воспользуйтесь email.',
    googleChecking: 'Проверяем вход через Google…',
    googleFailed:
      'Не удалось завершить вход через Google. Попробуйте ещё раз или воспользуйтесь email. Для адреса вне Gmail нужен аккаунт Google Workspace; иначе зарегистрируйтесь через email.',
    googleCancelled: 'Вход через Google отменён. Попробуйте ещё раз или воспользуйтесь email.',
    googleEmailExists:
      'Не удалось войти через Google: для этого email уже есть аккаунт FluxRadar. Войдите с паролем или сбросьте его через email. Аккаунты никогда не объединяются автоматически.',
  },
};
