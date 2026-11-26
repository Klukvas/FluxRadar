import { formatCount } from './format-count';
import { ukPagesAccusative, type Language } from './i18n';
import { ruPagesAccusative } from './i18n.ru.grammar';

export const freeReportCopy = {
  en: {
    pointUnit: 'points',
    freeCoverage: 'Free checks done',
    points: (value: string) => `Homepage score: ${value} points`,
    rounding:
      'Rounded homepage points from a limited check. A maximum score can still include issues.',
    checks: (count: number) => `Checks in this report: ${count}`,
    completion: (done: number, total: number) => `Free checks completed: ${done} of ${total}`,
    issueResultsUnknown: 'Individual check results unavailable',
    basicAction: (price: string) => `Basic · ${price} one-time`,
    issues: 'Issues found',
    issueChecks: (count: number) => `Checks with issues: ${count}`,
    recordedHeading: 'Recorded check names',
    recordedNote: 'This older report saved check names, but no individual check results.',
    passed: 'Passed',
    noted: 'Notes',
    notApplicable: 'Not applicable',
    lockedHeading: 'Additional SEO checks · paid audit',
    notRun: 'Not run in this report.',
    catalogNote:
      'Current check catalog. A paid audit runs applicable checks across the site; these are not hidden results from this scan.',
    allChecks: (count: number) => `All additional checks (${count})`,
    locked: 'Paid audit',
    upgrade: 'Run the complete audit',
    aiExcluded: 'The AI answer does not contribute to the homepage score.',
    homepageRead: 'The free check read one page of your site: the homepage.',
    // "Listed in your sitemap", never "pages of your site": the sitemap is the
    // site's own list, and the check did not verify it. `capped` means the
    // list was cut at the crawler's ceiling, so the count is a floor.
    sitemapUnread: (count: number, capped: boolean) =>
      `Your sitemap lists ${capped ? 'at least ' : ''}${formatCount(count, 'en')} more ${count === 1 ? 'page' : 'pages'} that this check did not read.`,
  },
  uk: {
    pointUnit: 'балів',
    freeCoverage: 'Виконано перевірок Free',
    points: (value: string) => `Оцінка головної сторінки: ${value} балів`,
    rounding:
      'Округлені бали обмеженої перевірки головної сторінки. Максимальна оцінка можлива й за наявності проблем.',
    checks: (count: number) => `Перевірок у цьому звіті: ${count}`,
    completion: (done: number, total: number) => `Виконано перевірок Free: ${done} з ${total}`,
    issueResultsUnknown: 'Результати окремих перевірок недоступні',
    basicAction: (price: string) => `Basic · ${price} разово`,
    issues: 'Знайдені проблеми',
    issueChecks: (count: number) => `Перевірок із проблемами: ${count}`,
    recordedHeading: 'Збережені назви перевірок',
    recordedNote: 'Цей старіший звіт зберіг назви перевірок, але не результати кожної з них.',
    passed: 'Пройдено',
    noted: 'Спостереження',
    notApplicable: 'Не застосовується',
    lockedHeading: 'Додаткові SEO-перевірки · платний аудит',
    notRun: 'Не виконувалися в цьому звіті.',
    catalogNote:
      'Поточний каталог перевірок. Платний аудит виконує застосовні перевірки всього сайту; це не приховані результати цього сканування.',
    allChecks: (count: number) => `Усі додаткові перевірки (${count})`,
    locked: 'Платний аудит',
    upgrade: 'Запустити повний аудит',
    aiExcluded: 'AI-відповідь не впливає на оцінку головної сторінки.',
    homepageRead: 'Безкоштовна перевірка прочитала одну сторінку вашого сайту — головну.',
    sitemapUnread: (count: number, capped: boolean) =>
      `Ще ${capped ? 'щонайменше ' : ''}${formatCount(count, 'uk')} ${ukPagesAccusative(count)} з вашого sitemap ця перевірка не прочитала.`,
  },
  ru: {
    pointUnit: 'баллов',
    freeCoverage: 'Выполнено проверок Free',
    points: (value: string) => `Оценка главной страницы: ${value} баллов`,
    rounding:
      'Округлённые баллы ограниченной проверки главной страницы. Максимальная оценка возможна и при наличии проблем.',
    checks: (count: number) => `Проверок в этом отчёте: ${count}`,
    completion: (done: number, total: number) => `Выполнено проверок Free: ${done} из ${total}`,
    issueResultsUnknown: 'Результаты отдельных проверок недоступны',
    basicAction: (price: string) => `Basic · ${price} разово`,
    issues: 'Найденные проблемы',
    issueChecks: (count: number) => `Проверок с проблемами: ${count}`,
    recordedHeading: 'Сохранённые названия проверок',
    recordedNote: 'Этот старый отчёт сохранил названия проверок, но не результаты каждой из них.',
    passed: 'Пройдено',
    noted: 'Наблюдения',
    notApplicable: 'Не применяется',
    lockedHeading: 'Дополнительные SEO-проверки · платный аудит',
    notRun: 'Не выполнялись в этом отчёте.',
    catalogNote:
      'Текущий каталог проверок. Платный аудит выполняет применимые проверки всего сайта; это не скрытые результаты этого сканирования.',
    allChecks: (count: number) => `Все дополнительные проверки (${count})`,
    locked: 'Платный аудит',
    upgrade: 'Запустить полный аудит',
    aiExcluded: 'ИИ-ответ не влияет на оценку главной страницы.',
    homepageRead: 'Бесплатная проверка прочитала одну страницу вашего сайта: главную.',
    sitemapUnread: (count: number, capped: boolean) =>
      `Ещё ${capped ? 'как минимум ' : ''}${formatCount(count, 'ru')} ${ruPagesAccusative(count)} из вашего sitemap эта проверка не прочитала.`,
  },
} satisfies Record<Language, unknown>;
