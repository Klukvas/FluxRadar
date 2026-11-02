// The two connected-data panels of the Russian report screen.
//
// Chrome only: a metric's name, a panel's state and the sentence that explains
// the state. The numbers themselves come from Search Console, Analytics 4 and
// Bing Webmaster Tools, and the Bing observations beside them are report
// content, so they stay Ukrainian (`bing-findings-copy.ts`).

/** The Google panel: Search Console and Analytics 4, read-only. */
export const russianGoogleDataCopy = {
  panelTitle: 'Данные Google',
  sourceNote: 'Источник: Google Search Console и Google Analytics 4 · только чтение · период',
  lastFetched: 'последнее получение',
  searchConsoleHeading: 'Search Console',
  analyticsHeading: 'Analytics 4',
  metricsLabel: 'Показатели Google',
  clicks: 'Клики',
  impressions: 'Показы',
  ctr: 'CTR',
  averagePosition: 'Средняя позиция',
  position: 'Позиция',
  topQueries: 'Главные запросы',
  topPages: 'Главные страницы',
  query: 'Запрос',
  page: 'Страница',
  users: 'Пользователи',
  sessions: 'Сеансы',
  pageViews: 'Просмотры страниц',
  events: 'События',
  keyEvents: 'Ключевые события',
  property: 'Ресурс {id}',
  stateConnected: 'Данные получены',
  stateNotConnected: 'Google не подключён',
  stateNoPropertySelected: 'Ресурс не связан',
  stateNeedsReconnect: 'Нужно подключить заново',
  stateNoAccess: 'Нет доступа к этому ресурсу',
  stateNoData: 'Нет данных за этот период',
  stateRequestFailed: 'Данные Google недоступны',
  detailConnected: 'Google вернул данные за этот период.',
  detailNotConnected: 'Google не подключён для этого рабочего пространства.',
  detailNoPropertySelected: 'С этим профилем ещё не связан ни один ресурс Google.',
  detailNeedsReconnect:
    'Доступ к Google истёк или его отозвали. Подключите Google заново, чтобы продолжить.',
  detailNoAccess: 'Этот аккаунт Google не может читать выбранный ресурс.',
  detailNoData: 'У Google нет данных об этом сайте за выбранный период.',
  detailRequestFailed: 'Google не ответил вовремя. На остальной отчёт это не влияет.',
} as const;

/** The Bing panel: Webmaster Tools, read-only, informational in this release. */
export const russianBingDataCopy = {
  panelTitle: 'Данные Bing',
  sourceNote: 'Источник: Bing Webmaster Tools · только чтение · период',
  lastFetched: 'последнее получение',
  metricsLabel: 'Показатели Bing',
  clicks: 'Клики',
  impressions: 'Показов',
  ctr: 'CTR',
  daysReported: 'Дней в данных',
  previousPeriod: 'Предыдущий период: кликов {clicks} · показов {impressions}',
  topQueries: 'Главные запросы Bing',
  query: 'Запрос',
  bingPosition: 'Средняя позиция Bing',
  positionNote:
    'Bing подаёт собственную среднюю позицию по своему индексу. Она не сравнима с позицией Search Console, поэтому разницу между ними не вычисляют.',
  trafficUnavailable:
    'Bing не вернул ежедневные клики и показы за этот период, поэтому итогов нет. Их оставили пустыми, а не нулевыми.',
  queriesUnavailable: 'Bing не вернул список запросов за этот период. Итоги выше это не меняет.',
  findingsHeading: 'Что показывают данные Bing',
  findingsNote:
    'Это заметки, а не оценённые находки: покрытие Bing в этом выпуске информационное и не влияет ни на одну оценку.',
  severityAttention: 'Стоит проверить',
  severityInfo: 'Заметка',
  stateConnected: 'Данные получены',
  stateNotConnected: 'Bing не подключён',
  stateNoSiteSelected: 'Сайт Bing не привязан',
  stateNeedsReconnect: 'Нужно подключить заново',
  stateNoAccess: 'Нет доступа к этому сайту',
  stateNoData: 'Нет данных за этот период',
  stateNotVerified: 'Сайт не подтверждён в Bing',
  stateRequestFailed: 'Данные Bing недоступны',
  detailConnected: 'Bing вернул данные за этот период.',
  detailNotConnected: 'Bing Webmaster Tools не подключён для этого рабочего пространства.',
  detailNoSiteSelected:
    'К этому профилю ещё не привязан сайт Bing. Выберите его в «Интеграциях», чтобы добавить данные Bing.',
  detailNeedsReconnect:
    'Доступ к Bing закончился или его отозвали. Подключите Bing Webmaster Tools заново.',
  detailNoAccess: 'Этот аккаунт Bing не может читать выбранный сайт.',
  detailNoData: 'У Bing нет данных для этого сайта за выбранный период.',
  detailNotVerified: 'Bing ещё не подтвердил право собственности на этот сайт.',
  detailRequestFailed:
    'Bing не ответил или ответил данными, которые FluxRadar не смог прочитать. Остальной отчёт это не меняет.',
} as const;
