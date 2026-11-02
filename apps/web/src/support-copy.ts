import { SUPPORT_EMAIL } from './brand';
import type { Language } from './i18n';

/**
 * The same bounds `apps/api/src/support/routes.ts` enforces. Checked here only
 * so the form can explain a short subject before a round trip; the API decides.
 */
export const SUPPORT_LIMITS = {
  emailMax: 254,
  subjectMin: 3,
  subjectMax: 200,
  messageMin: 10,
  messageMax: 2000,
} as const;

export type SupportCopy = {
  readonly launcher: string;
  readonly launcherLabel: string;
  readonly windowTitle: string;
  readonly heading: string;
  readonly intro: string;
  readonly signedInAs: (email: string) => string;
  readonly email: string;
  readonly emailPlaceholder: string;
  readonly emailHint: string;
  readonly subject: string;
  readonly subjectPlaceholder: string;
  readonly message: string;
  readonly messagePlaceholder: string;
  readonly send: string;
  readonly sending: string;
  readonly cancel: string;
  readonly close: string;
  readonly sentHeading: string;
  readonly sentBody: (replyTo: string | null) => string;
  readonly errors: {
    readonly email: string;
    readonly subject: string;
    readonly message: string;
    readonly emailRequired: string;
    readonly unavailable: string;
    readonly deliveryFailed: string;
    readonly rateLimited: string;
  };
};

export const supportCopy: Record<Language, SupportCopy> = {
  en: {
    launcher: 'Support',
    launcherLabel: 'Contact support',
    windowTitle: 'FluxRadar — Support',
    heading: 'Contact support',
    intro:
      'Tell us what went wrong or what you need. A person reads every message and replies by email.',
    signedInAs: (email) => `We will reply to ${email}, the address of this account.`,
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    emailHint: 'We reply to this address.',
    subject: 'Subject',
    subjectPlaceholder: 'A short summary',
    message: 'Message',
    messagePlaceholder: 'What happened, on which site or report, and what you expected instead.',
    send: 'Send message',
    sending: 'Sending…',
    cancel: 'Cancel',
    close: 'Close',
    sentHeading: 'Message sent',
    sentBody: (replyTo) =>
      replyTo === null
        ? 'Thank you — we will get back to you soon.'
        : `Thank you — we will reply to ${replyTo}.`,
    errors: {
      email: 'Enter the email address we should reply to.',
      subject: `Write a subject of at least ${SUPPORT_LIMITS.subjectMin} characters.`,
      message: `Describe the issue in at least ${SUPPORT_LIMITS.messageMin} characters.`,
      emailRequired: 'Your session has ended. Add the email address we should reply to.',
      unavailable: `In-app support is unavailable right now. Email ${SUPPORT_EMAIL} instead.`,
      deliveryFailed: 'Your message could not be delivered. Try again in a moment.',
      rateLimited: 'You have sent several messages in a short time. Try again in a few minutes.',
    },
  },
  uk: {
    launcher: 'Підтримка',
    launcherLabel: 'Звернутися до підтримки',
    windowTitle: 'FluxRadar — Підтримка',
    heading: 'Звернутися до підтримки',
    intro:
      'Опишіть, що пішло не так або що вам потрібно. Кожне повідомлення читає людина й відповідає електронною поштою.',
    signedInAs: (email) => `Відповімо на ${email} — адресу цього акаунта.`,
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    emailHint: 'Відповідь надійде на цю адресу.',
    subject: 'Тема',
    subjectPlaceholder: 'Коротко про суть',
    message: 'Повідомлення',
    messagePlaceholder: 'Що сталося, на якому сайті чи в якому звіті, і чого ви очікували.',
    send: 'Надіслати',
    sending: 'Надсилання…',
    cancel: 'Скасувати',
    close: 'Закрити',
    sentHeading: 'Повідомлення надіслано',
    sentBody: (replyTo) =>
      replyTo === null ? 'Дякуємо — невдовзі відповімо.' : `Дякуємо — відповімо на ${replyTo}.`,
    errors: {
      email: 'Вкажіть email, на який надіслати відповідь.',
      subject: `Тема має містити щонайменше ${SUPPORT_LIMITS.subjectMin} символи.`,
      message: `Опишіть проблему щонайменше ${SUPPORT_LIMITS.messageMin} символами.`,
      emailRequired: 'Ваш сеанс завершився. Вкажіть email, на який надіслати відповідь.',
      unavailable: `Підтримка в застосунку зараз недоступна. Напишіть на ${SUPPORT_EMAIL}.`,
      deliveryFailed: 'Не вдалося доставити повідомлення. Спробуйте ще раз за хвилину.',
      rateLimited: 'Ви надіслали кілька повідомлень за короткий час. Спробуйте за кілька хвилин.',
    },
  },
  ru: {
    launcher: 'Поддержка',
    launcherLabel: 'Обратиться в поддержку',
    windowTitle: 'FluxRadar / Поддержка',
    heading: 'Обратиться в поддержку',
    intro:
      'Опишите, что пошло не так или что вам нужно. Каждое сообщение читает человек и отвечает по электронной почте.',
    signedInAs: (email) => `Ответим на ${email}, адрес этого аккаунта.`,
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    emailHint: 'Ответ придёт на этот адрес.',
    subject: 'Тема',
    subjectPlaceholder: 'Коротко о сути',
    message: 'Сообщение',
    messagePlaceholder: 'Что случилось, на каком сайте или в каком отчёте, и чего вы ожидали.',
    send: 'Отправить',
    sending: 'Отправка…',
    cancel: 'Отменить',
    close: 'Закрыть',
    sentHeading: 'Сообщение отправлено',
    sentBody: (replyTo) =>
      replyTo === null ? 'Спасибо, скоро ответим.' : `Спасибо, ответим на ${replyTo}.`,
    errors: {
      email: 'Укажите email, на который отправить ответ.',
      subject: `Тема должна содержать хотя бы ${SUPPORT_LIMITS.subjectMin} символа.`,
      message: `Опишите проблему хотя бы ${SUPPORT_LIMITS.messageMin} символами.`,
      emailRequired: 'Ваш сеанс завершился. Укажите email, на который отправить ответ.',
      unavailable: `Поддержка в приложении сейчас недоступна. Напишите на ${SUPPORT_EMAIL}.`,
      deliveryFailed: 'Не удалось доставить сообщение. Попробуйте ещё раз через минуту.',
      rateLimited:
        'Вы отправили несколько сообщений за короткое время. Попробуйте через несколько минут.',
    },
  },
};
