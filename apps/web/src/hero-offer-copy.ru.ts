// The Russian half of the home page slider's copy.
//
// Its own file for the reason `i18n.ru.ts` is one: a locale is one document.
// Written from the Ukrainian meaning, with the Russian copy's habits: «ИИ» for
// the technology, no dash carrying a sentence, and the report itself named as
// Ukrainian where it matters (the window's foot already says so).

import type { HeroOfferCopy } from './hero-offer-copy';
import { ruCountForm } from './i18n.ru.grammar';

export const russianHeroOfferCopy: HeroOfferCopy = {
  windowTitle: 'Что вы получите',
  tablistLabel: 'Что есть в отчёте',
  roleDescription: 'карусель',
  tabs: {
    report: 'Отчёт',
    ai: 'ИИ-помощники',
    security: 'Безопасность',
    plan: 'План действий',
    developer: 'Разработчику',
  },
  previous: 'Предыдущий слайд',
  next: 'Следующий слайд',
  position: (current, total) => `${current} из ${total}`,
  stop: 'Остановить',
  resume: 'Листать автоматически',
  joinNames: (first, last) => `${first} и ${last}`,
  inPlans: (plans) => `В ${plans}.`,
  report: {
    includes: (checks, plans, planCount) =>
      `${plans} ${planCount === 1 ? 'включает' : 'включают'} ${checks} ${ruCountForm(checks, 'проверку', 'проверки', 'проверок')} для поиска Google на всём сайте.`,
  },
  ai: {
    title: 'Знают ли о вас ИИ-помощники?',
    lead: 'Задаём им вопрос, который задал бы клиент, и показываем, назвали ли они вас в ответе и сослались ли на ваш сайт.',
    questionLabel: 'Вопрос:',
    mentioned: 'НАЗВАЛ ВАС',
    cited: (page) => `Сослался на страницу ${page}`,
    optInChip: 'ПО ВАШЕМУ ВЫБОРУ',
    optInDetail: 'Спрашиваем их, только если вы сами отметите их перед оплатой.',
    includes: (asked, optional) =>
      `${asked} ${ruCountForm(asked, 'ИИ-помощник', 'ИИ-помощника', 'ИИ-помощников')} и ещё ${optional} по вашему выбору.`,
  },
  security: {
    title: 'Безопасно ли клиенту на вашем сайте?',
    lead: 'Что отчёт проверил на сайте салона. Смотрим только то, что видно снаружи: ничего не взламываем и паролей не просим.',
    passed: 'В ПОРЯДКЕ',
    rows: {
      'SEC-PASSIVE-001':
        'Сертификат защищённого соединения действителен, поэтому браузер не пугает посетителей предупреждением.',
      'SEC-PASSIVE-003': 'Браузерам указано всегда открывать сайт по защищённому адресу (https).',
      'SEC-PASSIVE-007':
        'Почта салона защищена от подделки, поэтому чужой человек не сможет просто так отправить письмо от его имени.',
    },
    includes: (checks) =>
      `${checks} ${ruCountForm(checks, 'проверка', 'проверки', 'проверок')} безопасности того, что видно снаружи.`,
  },
  plan: {
    title: 'С чего начать? План действий от ИИ',
    lead: 'По вашей просьбе ИИ (Claude) собирает находки отчёта в короткий список: что исправить первым, шаг за шагом.',
    includes: 'План действий от ИИ.',
  },
  developer: {
    title: 'Не разбираетесь в сайтах? И не нужно',
    lead: 'Каждую проблему объясняем простыми словами и даём готовое сообщение, которое можно переслать разработчику.',
    includes: 'Почему это важно и что сделать, написано рядом с каждой проблемой.',
    copyFailed:
      'Не удалось скопировать задачу автоматически. Выделите сообщение выше и скопируйте его сами.',
  },
};
