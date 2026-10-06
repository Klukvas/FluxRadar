// The words around the example report.
//
// Only the words that are the example's own live here. The report's own
// vocabulary — the score, the coverage, the severities and what each finding
// means — is read from the real catalogues the real report reads
// (`findings-copy.ts`, `finding-explainers.ts`, `i18n.ts`), so the page cannot
// teach a reader one thing and the product show them another.
//
// Written for a nail-salon owner who has never heard of a crawler, a heading
// level or a page description. Where a word cannot be avoided — description,
// alt text — it is in the small glossary at the bottom and nowhere else, and
// the glossary holds only words the page really uses: it used to define "alt
// text" for a report with no photo problem in it and "page title" for one that
// had stopped reporting on page names.

import type { Language } from './i18n';

/** A step of the "How to read this page" strip, and where it jumps to. */
export interface ExampleStep {
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
}

/** One word the page cannot avoid, explained once. */
export interface GlossaryEntry {
  readonly term: string;
  readonly body: string;
}

export type ExampleReportCopy = {
  readonly kicker: string;
  readonly title: string;
  readonly lead: string;
  readonly back: string;
  readonly contents: string;
  /**
   * The label that has to be impossible to miss, on screen and on paper: the
   * numbers are invented and the site does not exist. It is repeated in the
   * document's accessible name, so it is the first thing a screen reader says
   * about the report too.
   */
  readonly exampleLabel: string;
  readonly exampleBody: string;
  readonly howToRead: string;
  readonly steps: readonly ExampleStep[];
  readonly siteLabel: string;
  readonly planLabel: string;
  /**
   * What the plan name means, for a reader who has met it for the first time
   * in a header reading "Report · Complete". The link goes to the home page's
   * pricing section and says only what each report includes: this page carries
   * no price and starts no purchase.
   */
  readonly planNote: string;
  readonly planLink: string;
  /**
   * The plan, and how much of it this page shows. It read "Complete — every
   * section" over a report drawing six of Complete's ten sections, so a reader
   * comparing it with the pricing card was missing four and had no way to know
   * whether the plan or the page was lying. The count is pinned against
   * `PLAN_MODULES.Complete` and the fixture by `example-report.test.tsx`.
   */
  readonly planValue: string;
  readonly dateLabel: string;
  readonly dateValue: string;
  /** One sentence beside the score saying what the number is and is not. */
  readonly scoreHeading: string;
  readonly scoreCallout: string;
  readonly coverageCallout: string;
  readonly sectionsHeading: string;
  readonly sectionsLead: string;
  /** Each audit section under a name an owner can read. */
  readonly sectionNames: Readonly<Record<string, string>>;
  readonly sectionScoreLabel: string;
  /**
   * The one sentence under "Fix these first": where to start, and what the
   * number beside each problem counts.
   *
   * It said "how many pages it was found on", and the block prints
   * `fixFirst.pages` — "3 findings", never pages. One sentence and not two,
   * because the unit needs saying once: the page used to carry this callout and
   * nothing else, so a reader met "3 findings" here and "On 4 pages" on the
   * cards below with no word about either.
   */
  readonly fixFirstCallout: string;
  /**
   * The list of problems, and how the page has to introduce it: as a selection.
   *
   * It read "Every problem, in full" over "All six problems", which is a claim
   * about the made-up site rather than about the list — and a false one. The
   * fixture reports SEO-ONPAGE-005 (images with no alt attribute) and gives
   * Accessibility a Completed 18 of 18, but `packages/rules` runs A11Y-002 over
   * the same evidence on purpose (§14: one `IMG_ALT_EVIDENCE_CATEGORY` group,
   * two findings, two tariff weights), so a real Complete report of three pages
   * with alt-less images would carry A11Y-002 three times as well. Adding it to
   * the fixture would mean inventing a second rule's worth of plain-language
   * copy; saying "six of its problems" costs nothing and is true either way.
   * `example-report.test.tsx` pins the pair: a rule whose evidence category is
   * shared with a rule the fixture leaves out is only allowed while this
   * sentence says the list is a selection.
   */
  readonly findingsHeading: string;
  readonly findingsLead: string;
  /**
   * What each problem means for this particular salon, one sentence per
   * problem, keyed by the rule it belongs to.
   *
   * The page had one of these, beside the first problem only, so the second —
   * "Something may hold visitors back from contacting you" — told the reader
   * that something may make a visitor hesitate and never what. Every card has
   * one now, and `example-report.test.tsx` fails if a problem in the fixture
   * has none.
   */
  readonly findingMeanings: Readonly<Record<string, string>>;
  readonly severityLabel: string;
  readonly exampleAddressLabel: string;
  readonly taskHeading: string;
  readonly taskLead: string;
  readonly taskNote: string;
  readonly glossaryHeading: string;
  readonly glossaryLead: string;
  readonly glossary: readonly GlossaryEntry[];
  /**
   * What the real report's "Findings" entry says, reworded for this page.
   *
   * The report's own sentence ends "Open the findings list below to review
   * them" — true under a report, which has a findings list below it, and not
   * here: the list is above, and this page has no Issue Center to open.
   */
  readonly helpFindingsBody: string;
  readonly nextHeading: string;
  readonly nextSteps: readonly string[];
  readonly ctaHeading: string;
  readonly ctaBody: string;
  readonly ctaFree: string;
  readonly ctaCoverage: string;
  readonly ctaFaq: string;
  /** What a row of "Fix these first" says in place of the report's "Open". */
  readonly showBelow: string;
  /** The fold holding the only technical names on the page. */
  readonly technicalHeading: string;
  readonly technicalLead: string;
  readonly technicalSectionLabel: string;
  readonly technicalRuleLabel: string;
  readonly footerBrand: string;
  readonly footerHome: string;
};

const EN: ExampleReportCopy = {
  kicker: 'EXAMPLE REPORT',
  title: 'What a finished report looks like',
  lead: 'This is a whole report for a made-up nail salon, written the way your own report would be written. Read it in two minutes and you will know what you get and what to do with it.',
  back: 'Back to the home page',
  contents: 'ON THIS PAGE',
  exampleLabel: 'EXAMPLE — not a real site, the numbers are made up',
  exampleBody:
    'bloom-nails.example is not a real business and no address on this page can be opened. Every number, score and finding below was written by hand to show the shape of a report. Your own report would say what we actually found on your own site.',
  howToRead: 'How to read this page',
  steps: [
    {
      anchor: 'example-score',
      title: '1. Look at the score',
      body: 'One number for the whole site, so you can tell this month from next month. On its own it tells you nothing to do.',
    },
    {
      anchor: 'example-fix-first',
      title: '2. Read "Fix these first"',
      body: 'Five problems at most, most urgent at the top. This is the part that tells you what to do.',
    },
    {
      anchor: 'example-findings',
      title: '3. Hand the list on',
      body: 'Each problem comes with a ready message for whoever builds or looks after your site. Copy it and send it.',
    },
  ],
  siteLabel: 'Site',
  planLabel: 'Report',
  planValue: 'Complete — six of its ten sections shown here',
  planNote: 'Complete is the fullest of our three reports.',
  planLink: 'See what each report includes',
  dateLabel: 'Checked',
  dateValue: '2 October 2026',
  scoreHeading: 'The score',
  scoreCallout:
    'What it means: 0 is worst, 100 is best, and it is one number over the parts that count towards it. “Whether visitors get in touch” is not one of them — it is scored on its own, which its card below says too. Use the number to see whether the site is getting better over time. What to do about it: nothing — the list below is the part you act on.',
  coverageCallout:
    'What it means: how much of the site we opened and read — here, all of it: every address we found was read. It is not the same thing as the “checks done” figure beside each part below, which counts how many of that part’s own checks finished; one part is measured for us by an outside service and not every measurement came back. What to do about it: nothing.',
  sectionsHeading: 'The parts that were checked',
  sectionsLead:
    'Six of the ten parts a Complete check covers are shown here, enough to read a report without making the page twice as long. Each part gets its own score, so a site that is easy to use and hard to find is not the same as the other way round. The names here are plain; the names your developer uses are in the technical details at the bottom.',
  sectionNames: {
    SEO: 'Being found in search',
    'Content Quality': 'How your text reads',
    'UX/Conversion': 'Whether visitors get in touch',
    Performance: 'How fast pages load',
    Accessibility: 'Whether everyone can use it',
    Reliability: 'Whether pages work at all',
    'AI SEO / GEO': 'Being named by AI assistants',
    Privacy: 'What the site asks of visitors',
    Security: 'Everyday safety settings',
    Analytics: 'Your own visitor numbers',
  },
  sectionScoreLabel: 'Score',
  fixFirstCallout:
    'Start at the top: the first two cost you bookings today, and the rest can wait a week. Beside each one is how many findings it has — a finding is one place where that problem was found, which for some problems is one page each and for others several on the same page.',
  findingsHeading: 'Six problems, in full',
  findingsLead:
    'Six of its problems, not every problem it has. The first is open; open any of the others to read what we found and what to do about it.',
  findingMeanings: {
    'SEO-TECH-006':
      'What it means: a visitor pressed “Book now” and landed on a page that does not exist. Three links on the site do that.',
    'UX-CONV-AI-003':
      'What it means: the contact page has a form and nothing else — no phone number and no messenger link — so a customer who wants to ask one quick question before booking has nowhere to ask it.',
    'SEO-ONPAGE-002':
      'What it means: four pages, the price list among them, show search engines no summary of themselves, so Google writes its own from whatever text it finds first.',
    'SEO-ONPAGE-003':
      'What it means: on five pages the headings are not in order — a small sub-heading sits where the page’s own name should be — so anyone skimming has to read the whole page to find out what is on it.',
    'SEO-ONPAGE-005':
      'What it means: twelve pictures across the gallery, the team page and the tips page have no written description, so a customer using a screen reader hears nothing about them, and neither does Google.',
    'CONTENT-005':
      'What it means: the text on two pages is built from long sentences and long words, which is hard work to read on a phone.',
  },
  severityLabel: 'How urgent',
  exampleAddressLabel: 'An example page it was found on',
  taskHeading: 'What you would send your developer',
  taskLead:
    'Every problem has a button that copies a ready message. This is exactly what the first one copies — you do not have to write anything yourself.',
  taskNote:
    'On your own report there is a Copy button here. This page only shows the text; the links on it just move you around the page.',
  glossaryHeading: 'Two words you cannot avoid',
  glossaryLead:
    'Everything else on this page is in plain words. These two are not ours to rename — they are what the field is called in your own site builder.',
  glossary: [
    {
      term: 'Description',
      body: 'One or two sentences about a page. Search results usually show it under the page’s name, so it is what makes somebody click you rather than the salon next door.',
    },
    {
      term: 'Alt text',
      body: 'A short written description of a picture, for people who cannot see it and for search engines, which cannot see it either. A picture that is only decoration gets an empty one, which says there is nothing to describe.',
    },
  ],
  helpFindingsBody:
    'Specific problems we found, each with the evidence behind it. “Fix these first” above is the short list of them, in the order worth doing.',
  nextHeading: 'What you would do first',
  nextSteps: [
    'Open the booking link yourself. If it is broken for us it is broken for your customers, and that is money today.',
    'Send the ready message for the first two problems to whoever builds or looks after your site. You do not have to understand them to pass them on.',
    'Do the rest in the order they are listed, or ignore the bottom of the list — "can wait" means it can wait.',
  ],
  ctaHeading: 'Check your own site',
  ctaBody:
    'Create a free account and the free check reads your home page and reports what it finds there — one home page per account, per site. No payment and no card, for the account or for the check.',
  ctaFree: 'Create a free account and check my site',
  ctaCoverage: 'See every check we run',
  ctaFaq: 'Read the plain-language questions and answers',
  showBelow: 'Show below ↓',
  technicalHeading: 'Technical details',
  technicalLead:
    'For whoever does the work: the names each part and each problem has inside FluxRadar, and the identifier a developer can look up.',
  technicalSectionLabel: 'Section',
  technicalRuleLabel: 'Check',
  footerBrand: 'FLUXRADAR / BY FLUXLAB',
  footerHome: 'Home',
};

const UK: ExampleReportCopy = {
  kicker: 'ПРИКЛАД ЗВІТУ',
  title: 'Як виглядає готовий звіт',
  lead: 'Це повний звіт для вигаданого нейл-салону, написаний так, як був би написаний ваш власний. Прочитайте його за дві хвилини — і знатимете, що саме ви отримаєте й що з цим робити.',
  back: 'Назад на головну',
  contents: 'НА ЦІЙ СТОРІНЦІ',
  exampleLabel: 'ПРИКЛАД — це не справжній сайт, числа вигадані',
  exampleBody:
    'bloom-nails.example — не справжній бізнес, і жодну адресу з цієї сторінки відкрити не можна. Усі числа, бали та знахідки нижче написані вручну, щоб показати, як виглядає звіт. Ваш власний звіт скаже те, що ми справді знайшли на вашому сайті.',
  howToRead: 'Як читати цю сторінку',
  steps: [
    {
      anchor: 'example-score',
      title: '1. Погляньте на бал',
      body: 'Одне число на весь сайт — щоб порівняти цей місяць із наступним. Саме по собі воно не каже, що робити.',
    },
    {
      anchor: 'example-fix-first',
      title: '2. Прочитайте «Виправте це першим»',
      body: 'Щонайбільше п’ять проблем, найнагальніша — зверху. Саме ця частина каже, що робити.',
    },
    {
      anchor: 'example-findings',
      title: '3. Передайте список',
      body: 'До кожної проблеми вже готове повідомлення для того, хто робить ваш сайт або доглядає за ним. Скопіюйте й надішліть.',
    },
  ],
  siteLabel: 'Сайт',
  planLabel: 'Звіт',
  planValue: 'Complete — тут показано шість із його десяти розділів',
  planNote: 'Complete — найповніший із наших трьох звітів.',
  planLink: 'Подивитися, що входить у кожен звіт',
  dateLabel: 'Перевірено',
  dateValue: '2 жовтня 2026',
  scoreHeading: 'Бал',
  scoreCallout:
    'Що це означає: 0 — найгірше, 100 — найкраще, і це одне число по тих частинах, які до нього входять. «Чи відвідувачі звертаються до вас» до нього не входить — ця частина має окремий бал, про що написано і на її картці нижче. Число потрібне, щоб бачити, чи сайт із часом стає кращим. Що з ним робити: нічого — діяти треба за списком нижче.',
  coverageCallout:
    'Що це означає: яку частину сайту ми відкрили й прочитали — тут усю: прочитано кожну адресу, яку ми знайшли. Це не те саме, що «виконано перевірок» біля кожної частини нижче: там ідеться про те, скільки власних перевірок цієї частини завершилося; одну з частин міряє для нас зовнішній сервіс, і не всі вимірювання повернулися. Що робити: нічого.',
  sectionsHeading: 'Що саме перевірено',
  sectionsLead:
    'Тут показано шість із десяти частин, які охоплює перевірка Complete, — цього досить, щоб прочитати звіт, і сторінка не стає вдвічі довшою. Кожна частина має власний бал, бо сайт, яким легко користуватися й важко знайти, — це не те саме, що навпаки. Назви тут прості; назви, якими користується розробник, — у технічних деталях унизу.',
  sectionNames: {
    SEO: 'Чи вас знаходять у пошуку',
    'Content Quality': 'Як читається ваш текст',
    'UX/Conversion': 'Чи відвідувачі звертаються до вас',
    Performance: 'Як швидко відкриваються сторінки',
    Accessibility: 'Чи всі можуть користуватися сайтом',
    Reliability: 'Чи сторінки взагалі працюють',
    'AI SEO / GEO': 'Чи вас називають AI-асистенти',
    Privacy: 'Що сайт просить у відвідувача',
    Security: 'Щоденні налаштування безпеки',
    Analytics: 'Ваші власні числа про відвідувачів',
  },
  sectionScoreLabel: 'Бал',
  fixFirstCallout:
    'Починайте згори: перші дві коштують вам записів уже сьогодні, а решта може почекати тиждень. Біля кожної написано, скільки в ній знахідок, — знахідка — це одне місце, де цю проблему знайдено, і для одних проблем це по одній сторінці, а для інших кілька на одній сторінці.',
  findingsHeading: 'Шість проблем, повністю',
  findingsLead:
    'Шість проблем цього сайту, а не всі, які він має. Перша розгорнута; розгорніть будь-яку іншу, щоб прочитати, що ми знайшли і що з цим робити.',
  findingMeanings: {
    'SEO-TECH-006':
      'Що це означає: відвідувач натиснув «Записатися» і потрапив на сторінку, якої не існує. Так роблять три посилання на сайті.',
    'UX-CONV-AI-003':
      'Що це означає: на сторінці контактів є лише форма — ні телефону, ні посилання на месенджер, — тож клієнтці, яка хоче швидко щось запитати перед записом, нема де це зробити.',
    'SEO-ONPAGE-002':
      'Що це означає: чотири сторінки, зокрема прайс, не показують пошуковим системам свого опису, тож Google складає його сам із першого тексту, який там знайде.',
    'SEO-ONPAGE-003':
      'Що це означає: на пʼятьох сторінках заголовки не по порядку — дрібний підзаголовок стоїть там, де має бути назва самої сторінки, — тож той, хто проглядає сторінку побіжно, має прочитати її всю, щоб зрозуміти, що на ній.',
    'SEO-ONPAGE-005':
      'Що це означає: дванадцять зображень у галереї, на сторінці команди й на сторінці порад не мають текстового опису, тож клієнтка, яка користується програмою читання екрана, нічого про них не почує — і Google теж.',
    'CONTENT-005':
      'Що це означає: текст двох сторінок складено з довгих речень і довгих слів, а це важко читати з телефона.',
  },
  severityLabel: 'Наскільки нагально',
  exampleAddressLabel: 'Приклад сторінки, де це знайдено',
  taskHeading: 'Що ви надіслали б розробнику',
  taskLead:
    'У кожної проблеми є кнопка, яка копіює готове повідомлення. Ось точно те, що копіює перша з них, — писати нічого не потрібно.',
  taskNote:
    'У вашому власному звіті тут є кнопка «Скопіювати». Ця сторінка лише показує текст; посилання на ній просто переміщують вас по самій сторінці.',
  glossaryHeading: 'Два слова, без яких не обійтися',
  glossaryLead:
    'Усе інше на цій сторінці — простими словами. Ці два перейменувати не в нашій владі: саме так зветься поле у вашому конструкторі сайту.',
  glossary: [
    {
      term: 'Опис',
      body: 'Одне-два речення про сторінку. У результатах пошуку його зазвичай показують під назвою сторінки, тож саме він змушує натиснути на вас, а не на салон поруч.',
    },
    {
      term: 'Опис зображення (alt-текст)',
      body: 'Короткий текстовий опис зображення — для тих, хто його не бачить, і для пошукових систем, які його теж не бачать. Зображення, яке є лише оздобою, отримує порожній опис: він каже, що описувати нічого.',
    },
  ],
  helpFindingsBody:
    'Конкретні проблеми, які ми знайшли, кожна з доказом. «Виправте це першим» вище — це їхній короткий список у тому порядку, у якому варто братися.',
  nextHeading: 'З чого почати',
  nextSteps: [
    'Самі відкрийте посилання на запис. Якщо воно не працює для нас — воно не працює і для ваших клієнтів, а це гроші вже сьогодні.',
    'Надішліть готові повідомлення щодо перших двох проблем тому, хто робить ваш сайт або доглядає за ним. Щоб передати їх, розуміти їх не обов’язково.',
    'Решту робіть у тому порядку, у якому вони перелічені, або не робіть зовсім: «може почекати» означає, що справді може.',
  ],
  ctaHeading: 'Перевірте свій сайт',
  ctaBody:
    'Створіть безкоштовний акаунт — і безкоштовна перевірка прочитає вашу головну сторінку й покаже, що на ній знайшла: одна головна сторінка на акаунт і на сайт. Ні оплати, ні картки — ні для акаунта, ні для перевірки.',
  ctaFree: 'Створити безкоштовний акаунт і перевірити мій сайт',
  ctaCoverage: 'Подивитися всі наші перевірки',
  ctaFaq: 'Прочитати питання й відповіді простою мовою',
  showBelow: 'Показати нижче ↓',
  technicalHeading: 'Технічні деталі',
  technicalLead:
    'Для того, хто виконуватиме роботу: назви, які кожна частина й кожна проблема мають усередині FluxRadar, та ідентифікатор, за яким розробник може їх знайти.',
  technicalSectionLabel: 'Розділ',
  technicalRuleLabel: 'Перевірка',
  footerBrand: 'FLUXRADAR / BY FLUXLAB',
  footerHome: 'Головна',
};

export const exampleReportCopy: Readonly<Record<Language, ExampleReportCopy>> = { en: EN, uk: UK };
