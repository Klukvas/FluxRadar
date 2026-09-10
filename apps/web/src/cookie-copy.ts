import type { Language } from './i18n';

type CookieCopy = {
  readonly title: string;
  readonly description: string;
  readonly duration: string;
  readonly necessary: string;
  readonly allow: string;
  readonly details: string;
  readonly settings: string;
  readonly saveError: string;
  readonly languageError: string;
};

export const cookieCopy: Record<Language, CookieCopy> = {
  en: {
    title: 'Cookies & storage',
    description:
      'Necessary storage keeps sign-in, checkout and this choice working. Allow preferences to remember your language on this device.',
    duration: 'We remember your choice for 180 days. You can change it anytime in Cookie settings.',
    necessary: 'Only necessary',
    allow: 'Allow preferences',
    details: 'Cookie details',
    settings: 'Cookie settings',
    saveError:
      'Your choice could not be saved. Optional preferences are off in this tab. Check your browser storage settings and try again.',
    languageError:
      'Your language could not be saved. Optional preferences are off in this tab. Check your browser storage settings and try again.',
  },
  uk: {
    title: 'Cookies і сховище',
    description:
      'Необхідне сховище забезпечує вхід, оплату та збереження цього вибору. Дозвольте налаштування, щоб запам’ятати вашу мову на цьому пристрої.',
    duration:
      'Ми зберігаємо ваш вибір 180 днів. Його можна змінити будь-коли в налаштуваннях cookies.',
    necessary: 'Лише необхідні',
    allow: 'Дозволити налаштування',
    details: 'Докладніше про cookies',
    settings: 'Налаштування cookies',
    saveError:
      'Не вдалося зберегти ваш вибір. Додаткові налаштування вимкнено в цій вкладці. Перевірте налаштування сховища браузера та спробуйте ще раз.',
    languageError:
      'Не вдалося зберегти мову. Додаткові налаштування вимкнено в цій вкладці. Перевірте налаштування сховища браузера та спробуйте ще раз.',
  },
};
