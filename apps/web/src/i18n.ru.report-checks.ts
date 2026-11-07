// The per-section "checks done" fold of the Russian report screen.
//
// Chrome only. Two catalogues that belong to this object are deliberately
// absent here and spliced in from the Ukrainian branch in `i18n.ts`:
// `titles`, the name of every rule, and `notApplicableReasons`, the reason a
// named rule had nothing to look at. Both are the vocabulary the API's finding
// sentences are written against, so they stay in the report's language
// (`report-language.ts`).

export const russianReportChecksCopy = {
  show: 'Показать проверки',
  hide: 'Скрыть проверки',
  heading: '{module} · выполненные проверки',
  ruleLead:
    'Все автоматические проверки этого раздела на страницах, которые прочитал FluxRadar, и что нашла каждая из них. Доказательства к каждой находке есть в Центре проблем.',
  apiLead:
    'API-эндпоинты, настроенные для этой проверки: читаются через GET или HEAD, без учётных данных.',
  apiAnswered: 'Ответ {status} · ожидался {expected} · {timing} мс',
  apiNoResponse: 'Ответ не зафиксирован ({reason}).',
  renderUsed:
    'Страницы прочитаны в браузере после выполнения их скриптов ({engine}) · отрендерено: {rendered} · не отрендерено: {unrendered}.',
  renderUnavailable:
    'Рендеринг JavaScript запрашивали, но он был недоступен ({reason}), поэтому эти проверки читали HTML от сервера. Разметку, которая появляется только после скриптов страницы, не оценивали.',
  renderReasonUnknown: 'причину не зафиксировали',
  renderIncomplete:
    'На {incomplete} из них страница запрашивала ресурсы, которые эта проверка не смогла загрузить ({reasons}), поэтому то, что добавили бы эти скрипты, не оценивали.',
  resultPassed: 'Пройдено',
  resultIssues: 'Есть проблемы',
  resultNoted: 'Зафиксировано',
  resultNotChecked: 'Не проверено',
  resultNotApplicable: 'Не применяется',
  resultPartial: 'Частично',
  resultMissing: 'Отсутствует',
  detailPassedPages: 'Без проблем · проверено страниц: {applicable}',
  detailIssuesPages: 'Страниц с проблемами: {affected} из {applicable}',
  detailNotedPages: 'Страниц с этим наблюдением: {affected} из {applicable}',
  detailPassed: 'Проблем не найдено',
  detailIssues: 'Найдена проблема',
  detailNoted: 'Наблюдение зафиксировано',
  detailNotApplicable: 'На прочитанных страницах нет ничего, что подпадает под эту проверку',
  geoSearchHeading: 'ИИ-поиск и ответы',
  geoTrainingHeading: 'Обучение моделей',
  geoTrainingNote:
    'Блокировка обучения не влияет на появление в ИИ-поиске. Политика robots не доказывает фактический доступ; некоторые запросы пользователей могут игнорировать robots.txt.',
  geoCrawlersHeading: 'Доступ ИИ-роботов · robots.txt',
  geoCrawlersLead:
    'Что robots.txt разрешает читать каждому ИИ-роботу. Это политика самого сайта, а не доказательство того, что провайдер его проиндексировал или цитирует.',
  geoRobotsUnavailable:
    'robots.txt не найден или его не удалось прочитать, поэтому FluxRadar не может сказать, каким ИИ-роботам сайт разрешает доступ.',
  crawlerAllowed: 'Разрешено',
  crawlerBlocked: 'Заблокировано',
  crawlerUnknown: 'Неизвестно',
  geoPagesHeading: 'Готовность страниц к ИИ-ответам',
  geoPagesNone: 'Ни одну страницу прочитать не удалось, поэтому готовность страниц не проверялась.',
  geoPagesContent: 'Читаемый текст с заголовками',
  geoPagesStructured: 'Полные структурированные данные (JSON-LD)',
  geoPagesSocial: 'Метаданные для превью в соцсетях',
  geoPagesCount: 'Страниц: {count} из {checked}',
  geoQuestionsHeading: 'Вопросы к провайдеру ИИ',
  geoQuestionsGenerated:
    'Поисковых вопросов, составленных из контекста профиля: {count}. Их задали вместе с прямыми вопросами о вашем бренде.',
  geoQuestionsNoContext:
    'Контекст профиля не сохранён, поэтому задали только прямые вопросы о вашем бренде. Добавьте в профиль тематику бизнеса, регион и аудиторию, чтобы в следующий раз добавить поисковые вопросы.',
  geoQuestionsGenerationFailed:
    'Для этой проверки не удалось составить поисковые вопросы, поэтому задали только прямые вопросы о вашем бренде.',
  geoQuestionsNone:
    'В этой проверке провайдеру ИИ не задали ни одного вопроса. Причину объяснили на карточке.',
  perfLead:
    'Измерения сервисов производительности Google. Каждый показатель Core Web Vitals оценён по опубликованным порогам Google; для веса страницы такого порога нет, поэтому её показывают как измеренную.',
  perfLabHeading: 'Лабораторный тест · PageSpeed Insights',
  perfStrategyDesktop: 'десктоп',
  perfStrategyMobile: 'мобильный',
  perfFieldHeading: 'Реальные посетители · Chrome UX Report, 75-й процентиль',
  perfLcp: 'Отрисовка самого большого элемента (LCP)',
  perfInp: 'Задержка реакции на действие (INP)',
  perfCls: 'Сдвиг макета (CLS)',
  perfTtfb: 'Время ответа сервера (TTFB)',
  perfTbt: 'Общее время блокировки (TBT, лабораторная замена)',
  perfWeight: 'Общий вес страницы',
  perfHtmlWeight: 'Размер HTML-документа',
  perfRequests: 'Запросов на загрузку страницы',
  perfAuditLeadRepeated:
    'Каждую страницу ниже измерили {devices}, несколько раз. Показана медиана этих запусков; если запуски сильно разошлись, строка об этом сообщает.',
  perfAuditLeadSingle:
    'Каждую страницу ниже измерили {devices}, один раз. Каждое значение относится к тому одному запуску: медианы и разброса здесь нет.',
  perfAuditDevicesBoth: 'на двух эмулированных устройствах',
  perfAuditDevicesOne: 'на одном эмулированном устройстве ({device})',
  perfAuditDevicesUnstated: 'на устройствах, которые записал этот аудит',
  perfAuditOutageLead:
    'PageSpeed Insights не вернул подходящего измерения ни для одной из {count} выбранных страниц этого сканирования; данные поля CrUX показаны там, где они есть.',
  perfProvider: 'Лабораторные измерения: Lighthouse {version} через PageSpeed Insights',
  perfProviderUnknown: 'Лабораторные измерения: PageSpeed Insights (версию не сообщили)',
  perfBudget: 'Использовано {used} из {cap} запросов к провайдеру',
  perfBudgetCapped:
    'лимит запросов достигнут, поэтому часть запусков не выполнили; ниже показано то, что измерено',
  perfPrimaryPage: 'основная страница',
  perfRuns: 'подходящих запусков: {usable} из {requested}',
  perfDeviceUnmeasured:
    'Ни один из {requested} запусков не дал измерения для этого устройства, поэтому для него ничего не показано.',
  perfTemplatesSummary:
    'Найдено шаблонов страниц на этом сайте: {templatesFound} · измерено ниже: {templatesAudited}',
  perfTemplateRepresents: 'сканированных страниц такого типа: {count}',
  perfRegressionsHeading: 'Сравнение с предыдущим сканированием',
  perfNoRegressions: 'Ничто из измеренного не стало существенно хуже с предыдущего сканирования.',
  perfNoRegressionsQualified:
    'Ничто из того, что можно было сравнить, не стало существенно хуже с предыдущего сканирования.',
  perfNotCompared:
    'Сравнения с предыдущим сканированием нет: {reason}. Значение из другой среды измерения выглядело бы как изменение вашего сайта.',
  perfTemplateNotComparableLabel: 'Не сравнивали',
  perfTemplateNotComparable:
    'Не сравнивали: представительную страницу этого шаблона сменили со времени предыдущего сканирования (была {previous}, стала {current}).',
  perfTemplateDroppedLabel: 'Не измеряли в этот раз',
  perfTemplateDropped:
    'Не измеряли в этот раз: этот шаблон страницы проверяли в предыдущем сканировании (как {previous}), но в этом он не получил места.',
  perfUnmeasuredLabel: 'Не измеряли в этот раз',
  perfUnmeasuredReasonNoUsableSamples:
    'Не измеряли в этот раз: ни один из запусков PageSpeed для этой страницы не дал подходящего результата.',
  perfUnmeasuredReasonUnknown: 'Не измеряли в этот раз: подходящего измерения не получили.',
  perfIncomparableAuditVersion:
    'предыдущее сканирование измерили версией {previous}, а это версией {current}',
  perfIncomparableVersionUnrecorded:
    'в одном из двух сканирований не записана единая версия Lighthouse',
  perfIncomparableMajorChanged:
    'предыдущее сканирование измерял Lighthouse {previous}, а это Lighthouse {current}',
  perfRegressed: 'Хуже',
  perfUnstable: 'нестабильно: запуски разошлись на {spread} от медианы',
  perfBudgetNote: 'бюджет FluxRadar, а не опубликованный стандарт',
  perfFieldNotConfigured:
    'Данные реальных посетителей для этого сканирования не запрашивали, поэтому INP не измерили.',
  perfFieldNoData:
    'У Chrome UX Report нет записи для этого сайта: посетителей Chrome слишком мало для отчёта.',
  perfFieldFailed: 'Chrome UX Report не ответил. Лабораторные измерения выше это не меняет.',
  perfInpUnavailable:
    'INP требует реальных посетителей и не был измерен. Лабораторный запуск его не даёт, поэтому ни одно значение выше его не заменяет.',
  perfGood: 'Хорошо',
  perfNeedsImprovement: 'Стоит улучшить',
  perfPoor: 'Плохо',
  perfMeasured: 'Измерено',
  perfNoData: 'Нет данных',
  perfThresholds: '{value} · хорошо ≤ {good}, плохо > {poor}',
  perfNoDataDetail: 'Сервис не сообщил этот показатель для сайта.',
  unitMs: '{value} мс',
  unitSeconds: '{value} с',
  unitKb: '{value} КБ',
  unitMb: '{value} МБ',
  uxSignalsHeading: 'Что показывает HTML страниц',
  uxSignalsLead:
    'Сигналы из статического HTML проанализированных страниц. Это не оценки: страница без формы сама по себе не проблема.',
  uxSignalHeadings: 'Страницы с заголовками',
  uxSignalActions: 'Страницы со ссылками или кнопками',
  uxSignalForms: 'Страницы с формами',
  uxSignalContact: 'Страницы с путём к контакту или записи',
  // A slash, not «из»: the result column is uppercase monospace, where a word
  // between two numbers crowds the cell on a phone.
  uxSignalCount: '{count} / {checked}',
  uxAiHeading: 'ИИ-разбор страниц',
  uxAiRan:
    '{provider} · {model} разобрал страницы с учётом контекста профиля. Находок: {findings}. Они в Центре проблем.',
  uxAiNotRan:
    'ИИ-разбор в этой проверке не выполнялся, поэтому сделаны только статические проверки. Причину объяснили на карточке.',
  uxAiDropped:
    'Отклонено: {dropped}. Утверждения разбора, которые не подтверждаются собранными доказательствами, например о визуальном виде или о путанице у посетителя, выведенной из количества элементов на странице, мы не показываем.',
  analyticsLead:
    'Проверки на данных подключённых Search Console и Google Analytics 4 рядом со страницами, которые прочитал FluxRadar. Из них складывается собственная оценка этого раздела, которая не входит в общую. Доказательства к каждой находке есть в Центре проблем.',
  analyticsNotRan:
    'Проверки, которым нужен сервис Google без данных в этой проверке, не выполнялись. Причину объяснили на карточке.',
  analyticsTrendHeading: 'Органический поиск · последние 28 дней против предыдущих 28',
  analyticsTrendClicks: 'Клики: {previous} → {current} ({change})',
  analyticsTrendImpressions: 'Показы: {previous} → {current} ({change})',
  analyticsTrendNone:
    'За предыдущие 28 дней поискового трафика слишком мало, чтобы говорить о динамике.',
  analyticsNearHeading: 'Запросы, близкие к топу поиска',
  analyticsNearLead:
    'Поисковые запросы, по которым Google показывает сайт на позициях 8–20, то есть внизу первой страницы результатов или на второй. Часто хватает более ясного заголовка, раздела, который отвечает на запрос, или нескольких внутренних ссылок, чтобы подняться выше.',
  analyticsNearNone: 'Ни один запрос с достаточным количеством показов не стоит на позициях 8–20.',
  analyticsTopPagesHeading: 'Страницы с наибольшим количеством показов в поиске',
  analyticsTopPagesLead:
    'Находки остального отчёта на каждой из них и проверки, которые их нашли: найдите проверку в Центре проблем по её id. Исправление именно здесь достанется наибольшему числу посетителей.',
  analyticsFindingsColumn: 'Находки',
  analyticsSeverityColumn: 'Самая серьёзная',
} as const;
