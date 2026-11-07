// The Russian half of the findings chrome: the Issue Center's problem view,
// the report's own blocks, and the buttons that export the report.
//
// Interface only. A finding's own words — its title, its evidence, the
// recommendation, the printable document and the message the copy button
// writes — belong to the report and stay Ukrainian for a Russian reader
// (`report-language.ts`, `findings-document-copy.ts`).
//
// Written from the Ukrainian meaning rather than word for word, with the
// locale's habits: no dash carrying a sentence, no accent on what the Free
// check costs, and a counted noun put before its numeral wherever the count
// can end in 1 («Находок: 21»).

import type { FindingsCopy } from './findings-copy';
import { ruCountForm, ruPagesAccusative, ruPagesOf, takesRuSingular } from './i18n.ru.grammar';
import { FREE_CHECK_COUNT } from './free-score-copy';
import { COMPLETE_PRICE } from './tariff-prices';

/** Locative, after «на»: «на 1 странице», «на 21 странице», «на 5 страницах». */
const ruPagesOn = (count: number): string => (takesRuSingular(count) ? 'странице' : 'страницах');

/** Accusative of «проблема», as the object of «нашла»: «1 проблему», «2 проблемы», «5 проблем». */
const ruProblems = (count: number): string => ruCountForm(count, 'проблему', 'проблемы', 'проблем');

export const russianFindingsCopy: FindingsCopy = {
  severity: { Critical: 'Критическая', High: 'Высокая', Medium: 'Средняя', Low: 'Низкая' },
  severityMeaning: {
    Critical: 'исправьте первой',
    High: 'исправьте в ближайшее время',
    Medium: 'стоит исправить',
    Low: 'может подождать',
  },
  status: {
    New: 'Новая',
    Acknowledged: 'Принята',
    Ignored: 'Игнорируется',
    'False Positive': 'Ложная',
    Resolved: 'Исправлена',
    Reopened: 'Вернулась',
  },
  issues: {
    lead: 'Начните с самых срочных проблем в начале списка. Отметьте статусом те, за которые взялись или которые вас не касаются: статус сохранится до следующей полной проверки.',
    viewLabel: 'Показать',
    viewProblems: 'Проблемы',
    viewAll: 'Все находки',
    searchLabel: 'Поиск',
    searchPlaceholder: 'часть адреса страницы или слово из находки',
    severityFilter: 'Серьёзность',
    moduleFilter: 'Раздел',
    statusFilter: 'Статус',
    // One word for three filters of three genders («Серьёзность», «Раздел»,
    // «Статус»), so the option reads right in all of them.
    any: 'Все',
    openOnly: 'Открытые',
    problemFilter: 'Показана только одна проблема',
    clearProblem: 'Назад ко всем проблемам',
    showing: (shown, total) => `Показано ${shown} из ${total}`,
    loadMore: (count) => `Показать ещё ${count}`,
    loadingMore: 'Загрузка…',
    columnProblem: 'Проблема',
    columnPages: 'Где найдено',
    groupCount: (open, total, countsPages) =>
      countsPages
        ? open === total
          ? `На ${total} ${ruPagesOn(total)}`
          : `Открыто на ${open} из ${total} ${ruPagesOf(total)}`
        : open === total
          ? `Открытых находок: ${total}`
          : `Открыто находок: ${open} из ${total}`,
    groupSettled: (total, countsPages) =>
      countsPages ? `Закрыто на ${total} ${ruPagesOn(total)}` : `Все находки закрыты (${total})`,
    showFindings: 'Где именно и как исправить',
    showFindingsFor: (title) => `Где именно и как исправить: ${title}`,
    learnMore: 'Как это проверяется',
    explainerTitle: 'Что это значит простыми словами',
    explainerWhat: 'Что нашла проверка',
    explainerWhy: 'Почему это важно',
    explainerFix: 'Что сделать',
    explainerCount: 'Что значит одна находка',
    explainerScope:
      'FluxRadar читает публичные ответы тех страниц, которые обошла эта проверка. Находки описывают то, что было в этих ответах на тот момент; никакой атаки, входа в аккаунт или проверки на возможность взлома не выполнялось, а страницы вне области этой проверки не читались.',
    technicalTitle: 'Технические детали для вашего разработчика',
    rowTechnicalTitle: 'Что именно проверяется',
    fixLead: 'Что сделать:',
    breakdownPages: (pages) => `Страниц с этими находками: ${pages}.`,
    breakdownPagesSoFar: (pages) =>
      `Страниц среди загруженных находок: ${pages}. Загрузите остальные, чтобы посчитать все.`,
    breakdownVariants: 'Что мы нашли и на каких страницах',
    breakdownSame: 'У всех загруженных здесь находок одно и то же записанное доказательство.',
    // «этих» is plural, and a numeral ending in 1 takes the singular noun («на
    // 21 странице»), so the demonstrative is dropped wherever the noun goes
    // singular rather than agreeing with nothing.
    variantPages: (count) =>
      count === 1
        ? 'На этой странице:'
        : takesRuSingular(count)
          ? `На ${count} ${ruPagesOn(count)}:`
          : `На этих ${count} ${ruPagesOn(count)}:`,
    showAll: (count) => `Показать все (${count})`,
    showFewer: 'Показать меньше',
    summaryLine: (open, groups) => `Открытых находок: ${open}, проблем: ${groups}.`,
    summaryNone: 'В этом отчёте не осталось ничего открытого.',
    statusUpdated: 'Статус сохранён.',
  },
  task: {
    copy: 'Скопировать задачу для разработчика',
    copyFor: (title) => `Скопировать задачу для разработчика: ${title}`,
    copied: 'Задача скопирована. Вставьте её в сообщение разработчику.',
    explains: (problem, pages) =>
      `Копирует одну эту проблему, «${problem}», и ${pages} ${ruPagesAccusative(pages)}, где её нашли, как сообщение, которое можно вставить. Отправьте его тому, кто делает ваш сайт или присматривает за ним.`,
    explainsAtLeast: (problem, pages) =>
      `Копирует одну эту проблему, «${problem}», и как минимум ${pages} ${ruPagesAccusative(pages)}, где её уже нашли, как сообщение, которое можно вставить. Отправьте его тому, кто делает ваш сайт или присматривает за ним.`,
    explainsCount: (problem, findings) =>
      `Копирует одну эту проблему, «${problem}», и её открытые находки (${findings}) как сообщение, которое можно вставить. Отправьте его тому, кто делает ваш сайт или присматривает за ним.`,
    failed:
      'Не удалось скопировать задачу автоматически. Выделите текст ниже и скопируйте его сами.',
    textLabel: 'Задача для вашего разработчика',
    notLoaded:
      'Открытых находок пока не загружено. Покажите больше находок, чтобы скопировать задачу.',
    nothingOpen: 'Для этой проблемы ничего не открыто, значит и задачу копировать нечего.',
  },
  fixFirst: {
    heading: 'Исправьте это первым',
    lead: 'Самые срочные проблемы этого отчёта. Каждая из них закрывается одним исправлением, которое покрывает все перечисленные страницы.',
    none: 'Открытых проблем нет: в этом отчёте ничто не ждёт исправления.',
    pages: (count) => `Находок: ${count}`,
    open: 'Открыть',
    all: (count) => `Все проблемы (${count})`,
  },
  changes: {
    heading: 'После предыдущей проверки',
    // The date already ends in «г.», so the sentence does not add a second stop.
    since: (date) => `По сравнению с отчётом от ${date}`,
    fixed: 'Исправлено',
    introduced: 'Новые',
    persisting: 'Всё ещё открыты',
    fixedList: 'Исправлено с тех пор',
    introducedList: 'Новое с тех пор',
    firstReport:
      'Это первый отчёт этого тарифа для сайта. Запустите следующий после исправлений, и здесь будет видно, что изменилось.',
    egressDifferent: (current, previous) =>
      `Эта проверка шла из точки «${current}», а предыдущая шла из точки «${previous}». Сайт может по-разному отвечать посетителям из разных стран: язык, редиректы, баннеры согласия, блокировки. Поэтому ниже разница между двумя местами, а не изменения во времени. Не читайте её как «исправлено» или «новое».`,
    egressUnrecorded:
      'Страну, из которой шла одна из этих проверок, не зафиксировали, поэтому часть разницы может быть связана с сетью проверки, а не с изменениями на сайте.',
    onlyPrevious: 'Только в предыдущем отчёте',
    onlyCurrent: 'Только в этом отчёте',
    inBoth: 'В обоих',
    onlyPreviousList: 'Только в предыдущем отчёте',
    onlyCurrentList: 'Только в этом отчёте',
  },
  retry: {
    heading: 'Один раздел не удалось прочитать',
    body: 'Как минимум один раздел этого отчёта вернулся неполным: карточки ниже показывают, какой именно и почему. Незавершённый раздел можно один раз перезапустить без доплаты.',
    action: 'Перезапустить незавершённый раздел',
    working: 'Запускаем повтор…',
  },
  upsell: {
    heading: 'Главную проверили. Остальной сайт ещё нет',
    lead: (domain, problems) => {
      const rest = 'Другие страницы сайта ещё не проверены.';
      if (problems === null)
        return `Проверка посмотрела ${FREE_CHECK_COUNT} ${ruCountForm(FREE_CHECK_COUNT, 'пункт', 'пункта', 'пунктов')} на главной странице ${domain}. ${rest}`;
      if (problems === 0)
        return `На главной странице ${domain} в пунктах, которые смотрит эта проверка (их ${FREE_CHECK_COUNT}), проблем нет. ${rest}`;
      return `Проверка нашла на главной странице ${domain} ${problems} ${ruProblems(problems)} в пунктах, которые смотрит (их ${FREE_CHECK_COUNT}). ${rest}`;
    },
    listIntro: 'Полная проверка охватит на всех страницах:',
    points: [
      'Битые ссылки, страницы без описания, дубликаты и какие страницы Google не может показать',
      'Что говорят о вашем бизнесе ChatGPT и Claude и кого называют вместо вас',
      'Безопасность: сертификаты, заголовки и то, что открыто браузеру посетителя',
      'Скорость и доступность: как быстро грузятся страницы и кто не может ими пользоваться',
    ],
    price: `Complete стоит ${COMPLETE_PRICE}, оплата один раз, без подписки.`,
    action: `Запустить полную проверку за ${COMPLETE_PRICE}`,
    compare: 'Нужны только поиск и видимость в ИИ? Сравнить тарифы',
  },
  download: {
    pdf: 'Скачать полный отчёт (PDF)',
    pdfHint:
      'Формируется на сервере и содержит все находки этой проверки, в том числе сверх лимита версии для печати в 1 000 находок. Сам документ на украинском.',
    preparing: 'Готовим PDF…',
    failed:
      'Не удалось подготовить PDF. Воспользуйтесь версией для печати ниже или попробуйте ещё раз.',
    tooLarge:
      'В этой проверке больше находок, чем может вместить один PDF. Экспорты JSON и CSV содержат все.',
  },
  print: {
    open: 'Версия для печати',
    openHint:
      'Версия этого отчёта для печати, ограниченная первой 1 000 находок. Чтобы сохранить PDF, воспользуйтесь диалогом печати браузера. Сам документ на украинском.',
    // The window around the printed document, not the document: the reader
    // prints a Ukrainian report, and the buttons that do it speak their own
    // language (`report-language.ts`).
    toolbar: {
      windowTitle: 'Отчёт для клиента',
      print: 'Печать или сохранение в PDF',
      back: 'Назад к отчёту',
      loading: 'Готовим отчёт…',
      loadFailed: 'Не удалось подготовить отчёт. Проверьте соединение и попробуйте ещё раз.',
      retry: 'Попробовать ещё раз',
    },
  },
};
