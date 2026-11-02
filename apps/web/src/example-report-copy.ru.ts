// The Russian words of the public example report's own findings.
//
// A real report is Ukrainian: a finding's title, what was found and what to do
// are written by the API in the report's two languages, and a Russian reader is
// handed the Ukrainian one (`report-language.ts`). The example is the one place
// that cannot work that way. It exists for a stranger deciding whether to buy,
// and a Russian page whose six problems were in Ukrainian asked them to judge
// the product through a language they came here to avoid.
//
// So this file translates the example fixture, and only the example fixture:
// the six problems of a made-up nail salon, and the ready message for the first
// of them. The report screen, the printable document, the PDF and the emails
// are untouched and stay Ukrainian. Because that makes this page the one place
// where the words differ from the ones a customer will receive, the page says
// so in `russianExampleNote`, above the report and not under it.
//
// Written from the Ukrainian meaning rather than word for word, under the
// owner's rules for this locale: no sentence built on a dash, «ИИ» rather than
// a Latin «AI-» compound, and no accent on what the Free check costs.

import { TASK_EXAMPLE_LIMIT } from './developer-task';
import { takesRuSingular } from './i18n.ru.grammar';

/** One problem of the example, in the words the Russian page prints for it. */
export interface RussianExampleFinding {
  /** The problem's name in the owner's words, as `problemTitle` gives it. */
  readonly title: string;
  /** The rule's own name, for the page's technical fold, as `ruleTitle` gives it. */
  readonly ruleTitle: string;
  readonly what: string;
  readonly fix: string;
  readonly why: string;
}

/**
 * The sentence that keeps the page honest: these words are a translation, and
 * the report the reader will be sent is not.
 *
 * It belongs with the report rather than in a footnote, so the page prints it
 * at the top of the document, above the score.
 */
export const russianExampleNote =
  'Здесь пример переведён на русский, чтобы его было легче читать. Ваш собственный отчёт придёт на украинском: именно на этом языке мы пишем находки.';

/**
 * The six problems the example reports on.
 *
 * Keyed by rule id, and every rule of the fixture has an entry:
 * `example-report-content.ts` refuses to build the Russian page without one.
 */
export const russianExampleFindings: Readonly<Record<string, RussianExampleFinding>> = {
  'SEO-TECH-006': {
    title: 'Ссылки, которые ведут на страницы с ошибкой',
    ruleTitle: 'Ссылки на страницы, которые отвечают ошибкой (4xx/5xx)',
    what: 'Эти страницы ссылаются на адреса вашего же сайта, которые вместо страницы ответили ошибкой, например «страница не найдена».',
    fix: 'Направьте каждую из этих ссылок на работающую страницу или верните страницу, которой не хватает. Технические детали называют саму ссылку и то, куда она ведёт.',
    why: 'Посетитель, который нажимает такую ссылку, попадает в тупик, и поисковые системы, переходя по ней, тоже.',
  },
  'UX-CONV-AI-003': {
    title: 'Что-то может удерживать посетителей от обращения к вам',
    ruleTitle: 'Трение или нехватка сигналов доверия',
    what: 'Проверка искусственным интеллектом шагов, способов связи и признаков доверия в тексте этих страниц (отзывы, цены, адрес, гарантии) показывает: что-то может заставить посетителя колебаться, например не хватает способа связаться, есть лишний шаг или слишком мало сведений. Она читала только текст страницы, а не её вид.',
    fix: 'Просмотрите замечания и добавьте то, чего не хватает (телефон или ссылку на мессенджер, цены, отзывы, адрес), либо уберите лишний шаг. Технические детали цитируют, на чём основано замечание.',
    why: 'Посетители, которые не могут легко с вами связаться или ещё не уверены в вас, могут обратиться к кому-то другому.',
  },
  'SEO-ONPAGE-002': {
    title: 'Описание страницы для поиска отсутствует или неправильной длины',
    ruleTitle: 'Meta description отсутствует или неправильной длины',
    what: 'У этих страниц нет короткого описания для поисковых систем, либо оно короче 50 или длиннее 160 символов.',
    fix: 'Напишите для каждой страницы описание в одно-два предложения. В большинстве конструкторов сайтов для этого есть поле, часто оно называется SEO-описание.',
    why: 'Поисковые системы часто показывают это описание под заголовком вашего результата; если подходящего нет, они берут кусок страницы сами.',
  },
  'SEO-ONPAGE-003': {
    title: 'Заголовки не складываются в чёткую структуру',
    ruleTitle: 'Нарушена структура заголовков (H1–H6)',
    what: 'У этих страниц нет главного заголовка, или их несколько, или среди заголовков пропущен уровень, например мелкий подзаголовок стоит сразу под главным.',
    fix: 'Дайте каждой странице один главный заголовок и используйте подзаголовки по порядку. Если заголовки задаёт шаблон сайта, обратитесь к разработчику; иначе их может исправить тот, кто редактирует страницы.',
    why: 'Поисковые системы и посетители, которые просматривают страницу вскользь, по заголовкам понимают, о чём она и как построена.',
  },
  'SEO-ONPAGE-005': {
    title: 'Изображения без текстового описания',
    ruleTitle: 'Изображения без alt-текста',
    what: 'На этих страницах есть изображения (и фотографии, и логотипы, и значки), у которых текстового описания нет вообще, даже пустого.',
    fix: 'Добавьте короткое описание к каждому содержательному изображению, например «Розовый гель-маникюр с золотыми кончиками». Изображение, которое служит только украшением, можно пометить пустым описанием: оно говорит, что описывать нечего; разработчик знает это поле. В большинстве конструкторов сайтов для этого есть поле рядом с изображением, часто оно называется alt-текст.',
    why: 'Посетители, которые не видят изображение, и поисковые системы, которые его тоже не видят, не могут понять, что на нём, поэтому галерея, ради которой и существует страница, ничего о себе не говорит.',
  },
  'CONTENT-005': {
    title: 'Текст, который трудно читать',
    ruleTitle: 'Текст трудно читать',
    what: 'Текст этих страниц получил низкую оценку по формуле читабельности для своего языка, которая считает длину предложений и слов.',
    fix: 'Сократите длинные предложения, выберите более простые слова и разбейте плотные абзацы. Оценка считает только длины и не судит о смысле текста.',
    why: 'Длинные предложения и длинные слова заставляют посетителей напрягаться, особенно с телефона, и кто-то бросает читать, не дойдя до главного.',
  },
};

/** Locative, after «на»: «на 1 странице», «на 21 странице», «на 5 страницах». */
const pagesOn = (count: number): string => (takesRuSingular(count) ? 'странице' : 'страницах');

/** What the example's own ready message is assembled from. */
export interface RussianExampleTaskInput {
  readonly title: string;
  readonly ruleTitle: string;
  readonly ruleId: string;
  /** The problem's open findings, which the example has loaded in full. */
  readonly findings: number;
  /**
   * Every distinct address the problem was found on, uncut.
   *
   * The reach line counts all of them, as `developerTaskText` does; the cut to
   * `TASK_EXAMPLE_LIMIT` happens below and applies to the examples list only.
   */
  readonly targets: readonly string[];
  readonly what: string;
  readonly fix: string;
}

/**
 * The ready message for the first problem, in Russian.
 *
 * Line for line the shape `developer-task.ts` produces over a fully loaded
 * problem — the task, the check and its id, the reach, the example addresses,
 * what was found and what to do — so the page shows the message the product
 * writes rather than a different document with the same heading. The numbers
 * are handed in from the fixture, which is where the real generator counts
 * them too.
 */
export function russianExampleTask(input: RussianExampleTaskInput): string {
  const pages = input.targets.length;
  const where =
    input.findings === pages
      ? `Найдено на ${pages} ${pagesOn(pages)}.`
      : `Находок: ${input.findings}, на ${pages} ${pagesOn(pages)}.`;
  return [
    `Задача: ${input.title}`,
    `Проверка FluxRadar: ${input.ruleTitle} (${input.ruleId})`,
    where,
    '',
    'Примеры страниц:',
    ...input.targets.slice(0, TASK_EXAMPLE_LIMIT).map((target) => `- ${target}`),
    '',
    `Что нашли: ${input.what}`,
    '',
    `Что сделать: ${input.fix}`,
  ].join('\n');
}
