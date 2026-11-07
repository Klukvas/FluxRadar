import type { Language } from './i18n';
import type { AiLanguage } from './site-language';

const OPTIONS: Readonly<Record<AiLanguage, string>> = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
};
const hints = {
  en: 'Questions, answers and evaluated claims use this language. It defaults to your interface language; your selection takes priority. Report and Action Plan language are separate.',
  uk: 'Запитання, відповіді та оцінені твердження будуть цією мовою. Початково вибрано мову інтерфейсу; ваш вибір має пріоритет. Мова звіту й плану дій налаштовується окремо.',
  ru: 'Вопросы, ответы и оценённые утверждения будут на этом языке. По умолчанию выбран язык интерфейса; ваш выбор имеет приоритет. Язык отчёта и плана действий задаётся отдельно.',
} as const;
export const freeAiInterfaceHint: Readonly<Record<Language, string>> = {
  en: 'The Free AI question and answer follow your interface language.',
  uk: 'Запитання та відповідь ШІ у Free будуть мовою інтерфейсу.',
  ru: 'Вопрос и ответ ИИ в Free будут на языке интерфейса.',
};
export const freeAiLanguageCopy = {
  en: {
    label: 'AI SEO / GEO language',
    options: OPTIONS,
    hint: { site: hints.en, interface: hints.en, fallback: hints.en },
    chosen: hints.en,
  },
  uk: {
    label: 'Мова AI SEO / GEO',
    options: OPTIONS,
    hint: { site: hints.uk, interface: hints.uk, fallback: hints.uk },
    chosen: hints.uk,
  },
  ru: {
    label: 'Язык AI SEO / GEO',
    options: OPTIONS,
    hint: { site: hints.ru, interface: hints.ru, fallback: hints.ru },
    chosen: hints.ru,
  },
} as const;
