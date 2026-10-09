import type { Language } from './i18n';

type CookieCopy = {
  readonly title: string;
  readonly description: string;
  readonly duration: string;
  readonly optionalLegend: string;
  /** The master switch over both optional categories. */
  readonly allOptional: string;
  readonly allOptionalHint: string;
  readonly preferences: string;
  readonly preferencesHint: string;
  readonly analytics: string;
  readonly analyticsHint: string;
  readonly save: string;
  readonly details: string;
  readonly settings: string;
  readonly saveError: string;
  readonly languageError: string;
};

export const cookieCopy: Record<Language, CookieCopy> = {
  en: {
    title: 'Cookies & storage',
    description:
      'Necessary storage keeps sign-in, checkout and this choice working. The two options below are suggested, not applied: nothing optional is stored or measured until you choose Save.',
    duration: 'We remember your choice for 180 days. You can change it anytime in Cookie settings.',
    optionalLegend: 'Optional storage',
    allOptional: 'All optional storage',
    allOptionalHint:
      'One switch for both options below. Turn it off to keep only what is necessary.',
    preferences: 'Preferences',
    preferencesHint: 'Remember your interface language on this device.',
    analytics: 'Analytics',
    analyticsHint:
      'Count visits with Google Analytics 4 so we can see which pages help. No advertising and no Google Signals.',
    save: 'Save choice',
    details: 'Cookie details',
    settings: 'Cookie settings',
    saveError:
      'Your choice could not be saved. Optional storage is off in this tab. Check your browser storage settings and try again.',
    languageError:
      'Your language could not be saved. Optional preferences are off in this tab. Check your browser storage settings and try again.',
  },
  uk: {
    title: 'Cookies і сховище',
    description:
      'Необхідне сховище забезпечує вхід, оплату та збереження цього вибору. Два параметри нижче — лише пропозиція: нічого необов’язкового не зберігається й не вимірюється, доки ви не натиснете «Зберегти вибір».',
    duration:
      'Ми зберігаємо ваш вибір 180 днів. Його можна змінити будь-коли в налаштуваннях cookies.',
    optionalLegend: 'Необов’язкове сховище',
    allOptional: 'Усе необов’язкове сховище',
    allOptionalHint:
      'Один перемикач для двох параметрів нижче. Вимкніть його, щоб залишити тільки необхідне.',
    preferences: 'Налаштування',
    preferencesHint: 'Запам’ятовувати мову інтерфейсу на цьому пристрої.',
    analytics: 'Аналітика',
    analyticsHint:
      'Рахувати відвідування через Google Analytics 4, щоб ми бачили, які сторінки корисні. Без реклами та Google Signals.',
    save: 'Зберегти вибір',
    details: 'Докладніше про cookies',
    settings: 'Налаштування cookies',
    saveError:
      'Не вдалося зберегти ваш вибір. Необов’язкове сховище вимкнено в цій вкладці. Перевірте налаштування сховища браузера та спробуйте ще раз.',
    languageError:
      'Не вдалося зберегти мову. Додаткові налаштування вимкнено в цій вкладці. Перевірте налаштування сховища браузера та спробуйте ще раз.',
  },
};
