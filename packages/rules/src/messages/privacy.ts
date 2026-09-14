// Privacy finding messages (PRIVACY-*).

import type { FindingMessageCatalog } from './catalog.js';

export const PRIVACY_MESSAGES = {
  'privacy-001.evidence': {
    en: 'The page sets cookies ({count}): {cookies}',
    uk: 'Сторінка встановлює cookie ({count}): {cookies}',
  },
  'privacy-001.recommendation': {
    en: 'Make sure every cookie is necessary, is documented in your privacy policy and, unless it is strictly technical, is set only after the visitor consents.',
    uk: 'Переконайтеся, що кожен cookie потрібен, описаний у privacy policy і, якщо він не суто технічний, встановлюється лише після згоди відвідувача.',
  },
  'privacy-002.evidence': {
    en: 'Possible tracker signals were found ({trackers}), but no consent marker was found in the initial HTML.',
    uk: 'Виявлено можливі сигнали трекерів ({trackers}), але маркер згоди в початковому HTML не знайдено.',
  },
  'privacy-002.recommendation': {
    en: 'Make sure optional trackers load only after explicit consent, and check in a browser how the banner and the site behave before and after consent in the jurisdictions you serve.',
    uk: 'Переконайтеся, що необовʼязкові трекери завантажуються лише після явної згоди, і перевірте в браузері, як банер і сайт поводяться до та після згоди в потрібних вам юрисдикціях.',
  },
  'privacy-003.evidence': {
    en: 'Third-party scripts load from these domains ({count}): {domains}',
    uk: 'Сторонні скрипти завантажуються з цих доменів ({count}): {domains}',
  },
  'privacy-003.recommendation': {
    en: 'Review every third-party script: is it needed, is it mentioned in your privacy policy, and does it need the visitor’s consent (trackers do)?',
    uk: 'Перевірте кожен сторонній скрипт: чи він потрібен, чи згаданий у privacy policy і чи потребує згоди відвідувача (трекери потребують).',
  },
  'privacy-004.evidence': {
    en: 'No link to a privacy or cookie policy was found on the homepage.',
    uk: 'На головній сторінці не знайдено посилання на privacy policy чи cookie policy.',
  },
  'privacy-004.recommendation': {
    en: 'Add an accessible same-site link to your privacy policy and cookie information, and check that the documents match the data you actually collect and the regions you serve.',
    uk: 'Додайте доступне посилання на privacy policy та інформацію про cookie на вашому ж сайті й перевірте, що документи відповідають даним, які ви справді збираєте, і регіонам, у яких працюєте.',
  },
} as const satisfies FindingMessageCatalog;
