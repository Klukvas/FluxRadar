// The /checks methodology block, in each interface language.
//
// Separated from the component when Russian arrived: the block was eleven
// `language === 'uk' ? … : …` ternaries interleaved with markup, which is
// unreadable at two languages and impossible at three. The links stay in the
// component, because what they point at is the same in every language.
//
// The knowledge base and the blog are Ukrainian only, so the labels that lead
// there say which language the reader will land in.

import type { Language } from './i18n';

export type AuditMethodologyCopy = {
  readonly heading: string;
  readonly whatItIs: string;
  readonly scope: string;
  readonly limits: string;
  readonly plans: string;
  readonly exampleLink: string;
  readonly coverageLink: string;
  readonly aiAccessLink: string;
  readonly caseLink: string;
  readonly questions: string;
  readonly operatorLink: string;
};

export const auditMethodologyCopy: Readonly<Record<Language, AuditMethodologyCopy>> = {
  en: {
    heading: 'How FluxRadar audits a site and who operates the service',
    whatItIs:
      'FluxRadar is an online public website audit service operated by FluxLab. It reads accessible pages without CMS, SSH or database credentials. Complete also observes public TLS certificates and DNS TXT policies. These are passive checks, not penetration testing.',
    scope:
      'The crawl is limited by the selected plan, settings, site availability and robots.txt. Reports distinguish findings from unverified and inapplicable signals. Each finding identifies a rule, evidence and a suggested fix; no findings is not a compliance certificate.',
    limits:
      'An SEO audit describes technical signals and does not guarantee indexing or rankings. AI crawler access and brand mentions are separate measurements: model answers depend on the exact questions, provider and time of the run.',
    plans:
      'Basic includes SEO, AI/GEO and an Action Plan, up to 5,000 URLs. Complete supports up to 50,000 URLs, additional modules, history and export. Each purchase is one audit, not automatic monitoring.',
    exampleLink: 'Example deliverable for a fictional site',
    coverageLink: 'Read coverage and scores (Ukrainian)',
    aiAccessLink: 'Check AI access without citation promises (Ukrainian)',
    caseLink: 'Our case: what full FluxRadar HTML changes (Ukrainian)',
    questions: 'Questions about the method or a questionable finding: ',
    operatorLink: 'Operator and data processing',
  },
  uk: {
    heading: 'Як FluxRadar проводить аудит і хто відповідає за сервіс',
    whatItIs:
      'FluxRadar — онлайн-сервіс FluxLab для перевірки публічних сайтів. Він читає доступні сторінки без паролів до CMS, SSH чи бази даних. Complete також спостерігає публічні TLS-сертифікати та DNS TXT-політики. Це пасивні перевірки, а не тест на проникнення.',
    scope:
      'Обхід обмежений обраним пакетом, налаштуваннями, доступністю сайту та robots.txt. Звіт відокремлює знайдені проблеми від неперевірених і незастосовних сигналів. Для кожної знахідки він показує правило, доказ і рекомендоване виправлення; відсутність знахідок не є сертифікатом відповідності.',
    limits:
      'SEO-аудит описує технічні сигнали, а не гарантує індексацію чи позиції. Доступ AI-краулера та згадка бренду — різні вимірювання: відповіді моделей залежать від конкретних запитань, провайдера й часу запуску.',
    plans:
      'Basic: SEO, AI/GEO та план дій, до 5 000 URL. Complete: до 50 000 URL, додаткові модулі, історія й експорт. Це разова перевірка, а не автоматичний моніторинг.',
    exampleLink: 'Приклад результату для вигаданого сайту',
    coverageLink: 'Як читати покриття й оцінку',
    aiAccessLink: 'Як перевірити видимість для AI без обіцянок цитування',
    caseLink: 'Власний кейс: що змінив повний HTML FluxRadar',
    questions: 'Питання про методику або помилковий висновок: ',
    operatorLink: 'Оператор і обробка даних',
  },
  ru: {
    heading: 'Как FluxRadar проводит аудит и кто отвечает за сервис',
    whatItIs:
      'FluxRadar это онлайн-сервис FluxLab для проверки публичных сайтов. Он читает доступные страницы без паролей к CMS, SSH или базе данных. Complete также наблюдает публичные TLS-сертификаты и DNS TXT-политики. Это пассивные проверки, а не тест на проникновение.',
    scope:
      'Обход ограничен выбранным пакетом, настройками, доступностью сайта и robots.txt. Отчёт отделяет найденные проблемы от непроверенных и неприменимых сигналов. Для каждой находки он показывает правило, доказательство и рекомендуемое исправление; отсутствие находок не является сертификатом соответствия.',
    limits:
      'SEO-аудит описывает технические сигналы, а не гарантирует индексацию или позиции. Доступ ИИ-краулера и упоминание бренда это разные измерения: ответы моделей зависят от конкретных вопросов, провайдера и времени запуска.',
    plans:
      'Basic: SEO, AI/GEO и план действий, до 5 000 URL. Complete: до 50 000 URL, дополнительные модули, история и экспорт. Это разовая проверка, а не автоматический мониторинг.',
    exampleLink: 'Пример результата для выдуманного сайта',
    coverageLink: 'Как читать покрытие и оценку (на украинском)',
    aiAccessLink: 'Как проверить видимость для ИИ без обещаний цитирования (на украинском)',
    caseLink: 'Собственный кейс: что изменил полный HTML FluxRadar (на украинском)',
    questions: 'Вопросы о методике или об ошибочном выводе: ',
    operatorLink: 'Оператор и обработка данных',
  },
};
