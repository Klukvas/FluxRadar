// What a finding means, for an owner who does not run servers or write markup.
//
// The rules that fill a report are named for engineers — "Content-Security-Policy
// is missing or weak", "ARIA attributes are used incorrectly" — and a site that
// misses one server setting misses it on every page, so one fix arrives as
// hundreds of findings whose only text is the server's wording.
//
// So each entry answers, in the owner's words, what the problem is called, what
// was found, why it is worth a developer's time, the one thing the owner can do,
// and what one finding counts — the rules do not all count the same thing.
// Header names, attribute names and markup belong to the developer, so they stay
// out of here and live in the finding's technical details instead.
//
// Deliberately narrow about what the scanner knows: it reads the response a
// public page sent back. A finding is a safeguard that is not switched on, or a
// page that reads worse than it could — never a claim that the site has been
// exploited, and never a promise of what a fix will earn.
//
// Not every rule has an entry. `finding-variants.test.ts` reads the rule
// registry and fails when a scored rule is neither explained here nor listed
// there as deliberately left to its technical title, so a new rule is a
// decision, not an accident. Scored rules only: informational ones (D-109)
// never become Issue rows. A rule with no entry keeps the title, evidence and
// recommendation it always had.

import type { Language } from './i18n';
import { ruleTitle } from './rule-titles';

export interface FindingExplainer {
  /** The problem's name in the owner's words — no header, attribute or acronym. */
  readonly title: string;
  /** What the check found, without naming a header or an attribute. */
  readonly what: string;
  /** Why it is worth a developer's time — no attack claims, no promises. */
  readonly why: string;
  /** The one thing the owner can do about it. */
  readonly fix: string;
  /** What one finding of this rule is, so the count can be read correctly. */
  readonly count: string;
}

interface ExplainedRule {
  /**
   * Whether a finding of this rule is one page — at most one finding per page —
   * so a count of findings can be said as a count of pages. False for a rule
   * that reports per cookie, per link, per address group or per AI remark.
   */
  readonly countsPages: boolean;
  readonly en: FindingExplainer;
  readonly uk: FindingExplainer;
}

const ASK_DEVELOPER_SERVER_EN =
  'Ask your website developer to set this protection up on the server and to check that the site still works as before. The specifics are in the technical details.';

const ASK_DEVELOPER_SERVER_UK =
  'Попросіть розробника налаштувати цей захист на сервері та перевірити, що сайт працює як раніше. Точний перелік є в технічних деталях.';

const AI_REVIEW_COUNT_EN =
  'One finding for each point the review raised, so one page can appear more than once.';
const AI_REVIEW_COUNT_UK =
  'Одна знахідка на кожне зауваження перевірки, тож одна сторінка може зʼявитися кілька разів.';

const EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  'SEC-ASVS-001': {
    countsPages: true,
    en: {
      title: 'Pages do not limit where they load content from',
      what: 'These pages do not tell the browser which outside sources it may load content from.',
      why: 'That instruction is an extra safeguard: it lets you tell the browser which places scripts and other content may come from.',
      fix: ASK_DEVELOPER_SERVER_EN,
      count: 'One finding for each page where it is not set.',
    },
    uk: {
      title: 'Сторінки не обмежують, звідки завантажувати вміст',
      what: 'Ці сторінки не повідомляють браузеру, з яких сторонніх джерел йому можна завантажувати вміст.',
      why: 'Це додатковий запобіжник: він дає змогу вказати браузеру, звідки можна брати скрипти та інший вміст.',
      fix: ASK_DEVELOPER_SERVER_UK,
      count: 'Одна знахідка на кожну сторінку, де його не задано.',
    },
  },
  'SEC-ASVS-002': {
    countsPages: true,
    en: {
      title: 'Pages do not limit which device features they may use',
      what: 'These pages do not tell the browser which device features, such as the camera, microphone or location, the page and anything embedded in it may ask for.',
      why: 'That instruction is an extra safeguard: where it is set, an embedded widget or an added script cannot ask for a feature you did not allow.',
      fix: ASK_DEVELOPER_SERVER_EN,
      count: 'One finding for each page where it is not set.',
    },
    uk: {
      title: 'Сторінки не обмежують, якими можливостями пристрою можна користуватися',
      what: 'Ці сторінки не повідомляють браузеру, які можливості пристрою — камеру, мікрофон, геолокацію — можуть запитувати сторінка та вбудований у неї вміст.',
      why: 'Це додатковий запобіжник: там, де його задано, вбудований віджет чи доданий скрипт не зможе запитати можливість, якої ви не дозволили.',
      fix: ASK_DEVELOPER_SERVER_UK,
      count: 'Одна знахідка на кожну сторінку, де його не задано.',
    },
  },
  'SEC-PASSIVE-002': {
    countsPages: true,
    en: {
      title: 'Some browser protection settings are off',
      what: 'Some of the extra browser protection settings are not switched on for these pages.',
      why: 'These settings help limit unwanted embedding of your pages and the passing of information to other sites.',
      fix: ASK_DEVELOPER_SERVER_EN,
      count: 'One finding for each page that was missing something.',
    },
    uk: {
      title: 'Частину захисних налаштувань браузера вимкнено',
      what: 'На цих сторінках не задано частину додаткових налаштувань захисту браузера.',
      why: 'Такі налаштування допомагають обмежити небажане вбудовування сторінок і передачу інформації стороннім сайтам.',
      fix: ASK_DEVELOPER_SERVER_UK,
      count: 'Одна знахідка на кожну сторінку, якій чогось бракувало.',
    },
  },
  'SEC-PASSIVE-005': {
    countsPages: false,
    en: {
      title: 'Cookies without all the usual safety limits',
      what: 'A cookie these pages set is missing some of the limits a browser can put on how it is used. The cookie’s value is not shown in the finding evidence.',
      why: 'Those limits make such a cookie harder to read, or to send along from another site.',
      fix: 'Ask your website developer to review this cookie and add the missing limits where it carries a sign-in or private data; leaving one off is sometimes a deliberate choice that keeps the site working. The specifics are in the technical details.',
      count:
        'One finding for each cookie on each page, so a page can appear more than once and there can be more findings than pages.',
    },
    uk: {
      title: 'Cookie без усіх звичних обмежень безпеки',
      what: 'Cookie, яку встановлюють ці сторінки, має не всі обмеження, які браузер може накласти на її використання. Значення cookie не показується в доказах знахідки.',
      why: 'Такі обмеження ускладнюють читання цієї cookie та її надсилання з інших сайтів.',
      fix: 'Попросіть розробника переглянути цю cookie й додати відсутні обмеження там, де вона несе вхід в акаунт чи приватні дані; інколи обмеження свідомо лишають вимкненим, щоб сайт працював. Точний перелік є в технічних деталях.',
      count:
        'Одна знахідка на кожну cookie на кожній сторінці, тож сторінка може зʼявитися кілька разів, а знахідок може бути більше, ніж сторінок.',
    },
  },
  'A11Y-003': {
    countsPages: true,
    en: {
      title: 'Page language not set, or headings out of order',
      what: 'On these pages either the page does not say which language it is written in, or its headings do not form a clear outline: there is no main heading, there are several, or a level is skipped.',
      why: 'Screen readers use the page language to pronounce the text, and many of their users move through a page by its headings.',
      fix: 'Ask your website developer to set the page language and to give each page one main heading with sub-headings in order. The technical details say which of the two applies to each page.',
      count: 'One finding for each page, whichever of the two it has.',
    },
    uk: {
      title: 'Не вказано мову сторінки або порушено порядок заголовків',
      what: 'На цих сторінках або не вказано, якою мовою написано сторінку, або заголовки не складаються в чітку структуру: головного заголовка немає, їх кілька чи пропущено рівень.',
      why: 'Програми читання з екрана за мовою сторінки вимовляють текст, а багато їхніх користувачів переходять сторінкою саме за заголовками.',
      fix: 'Попросіть розробника вказати мову сторінки й дати кожній сторінці один головний заголовок із підзаголовками по порядку. Технічні деталі показують, що з цього стосується кожної сторінки.',
      count:
        'Одна знахідка на кожну сторінку, незалежно від того, що саме з цього на ній знайдено.',
    },
  },
  'A11Y-007': {
    countsPages: true,
    en: {
      title: 'Screen-reader hints on these pages are broken',
      what: 'Some elements on these pages carry hints meant for screen readers and other assistive tools, but a hint names a role that does not exist, points to a part of the page that is not there, or hides from those tools something a keyboard user can still reach.',
      why: 'People who use a screen reader or a keyboard rely on these hints to know what an element is and to reach it. A broken hint can make a menu or a button confusing or unusable for them.',
      fix: 'Ask your website developer to correct or remove the broken hint on the element named in the technical details. It is often one shared part of the site, such as the menu, repeated on every page.',
      count:
        'One finding for each page; the technical details name the first broken element on it.',
    },
    uk: {
      title: 'Підказки для програм читання з екрана несправні',
      what: 'Деякі елементи цих сторінок мають підказки для програм читання з екрана та інших допоміжних засобів, але підказка називає роль, якої не існує, посилається на частину сторінки, якої немає, або ховає від цих засобів те, до чого можна дістатися з клавіатури.',
      why: 'Люди, які користуються програмою читання з екрана чи клавіатурою, з цих підказок дізнаються, що це за елемент, і дістаються до нього. Несправна підказка може зробити меню чи кнопку незрозумілими або недоступними для них.',
      fix: 'Попросіть розробника виправити або прибрати несправну підказку на елементі, названому в технічних деталях. Часто це одна спільна частина сайту, наприклад меню, що повторюється на кожній сторінці.',
      count:
        'Одна знахідка на кожну сторінку; технічні деталі називають перший несправний елемент на ній.',
    },
  },
  'SEO-TECH-003': {
    countsPages: true,
    en: {
      title: 'Pages that answer with an error',
      what: 'When FluxRadar opened these addresses, the server answered with an error, such as “page not found” or a server failure, instead of the page.',
      why: 'Visitors who reach these addresses see an error, and search engines tend to drop such addresses from their results.',
      fix: 'Ask your website developer to restore these pages or to send visitors on to the right page. If a page was removed on purpose, remove the links that still lead to it.',
      count: 'One finding for each address that answered with an error.',
    },
    uk: {
      title: 'Сторінки, що відповідають помилкою',
      what: 'Коли FluxRadar відкривав ці адреси, сервер замість сторінки відповів помилкою, наприклад «сторінку не знайдено» чи збоєм сервера.',
      why: 'Відвідувачі за цими адресами бачать помилку, а пошукові системи зазвичай прибирають такі адреси з результатів.',
      fix: 'Попросіть розробника відновити ці сторінки або перенаправляти відвідувачів на потрібну сторінку. Якщо сторінку прибрали свідомо, приберіть посилання, що досі на неї ведуть.',
      count: 'Одна знахідка на кожну адресу, що відповіла помилкою.',
    },
  },
  'SEO-TECH-006': {
    countsPages: false,
    en: {
      title: 'Links that lead to error pages',
      what: 'These pages link to addresses on your own site that answered with an error instead of a page, for example “page not found”.',
      why: 'A visitor who clicks such a link reaches a dead end, and search engines meet the same dead end when they follow it.',
      fix: 'Point each of these links at a working page, or bring the missing page back. The technical details name the link and where it leads.',
      count:
        'One finding for each broken link on each page, so a page with several broken links appears several times.',
    },
    uk: {
      title: 'Посилання, що ведуть на сторінки з помилкою',
      what: 'Ці сторінки посилаються на адреси вашого ж сайту, які замість сторінки відповіли помилкою, наприклад «сторінку не знайдено».',
      why: 'Відвідувач, що натискає таке посилання, потрапляє в глухий кут, а пошукові системи, переходячи за ним, — теж.',
      fix: 'Спрямуйте кожне з цих посилань на робочу сторінку або поверніть сторінку, якої бракує. Технічні деталі називають посилання і куди воно веде.',
      count:
        'Одна знахідка на кожне неробоче посилання на кожній сторінці, тож сторінка з кількома такими посиланнями зʼявляється кілька разів.',
    },
  },
  'SEO-TECH-007': {
    countsPages: false,
    en: {
      title: 'The same page opens at several addresses',
      what: 'Links on your site lead to the same page under slightly different addresses, for example with and without extra tracking text at the end.',
      why: 'Search engines may treat each address as a separate page and split the page’s visibility between them.',
      fix: 'Ask your website developer to make every variant lead to one main address. The technical details list the variants that were found.',
      count: 'One finding for each page that was found under more than one address.',
    },
    uk: {
      title: 'Та сама сторінка відкривається за кількома адресами',
      what: 'Посилання на вашому сайті ведуть на ту саму сторінку за трохи різними адресами, наприклад із додатковим текстом для відстеження в кінці й без нього.',
      why: 'Пошукові системи можуть вважати кожну адресу окремою сторінкою й ділити видимість сторінки між ними.',
      fix: 'Попросіть розробника звести всі варіанти до однієї головної адреси. Знайдені варіанти перелічено в технічних деталях.',
      count: 'Одна знахідка на кожну сторінку, яку знайдено за кількома адресами.',
    },
  },
  'SEO-TECH-011': {
    countsPages: true,
    en: {
      title: 'Pages only one other page links to',
      what: 'Each of these pages is linked from only one other page of your site.',
      why: 'If that one link changes or disappears, visitors and search engines lose their way to the page.',
      fix: 'Link to these pages from other pages where it makes sense: a menu, a related section or the footer.',
      count:
        'One finding for each such page; the technical details name the one page that links to it.',
    },
    uk: {
      title: 'Сторінки, на які посилається лише одна інша сторінка',
      what: 'На кожну з цих сторінок посилається лише одна інша сторінка вашого сайту.',
      why: 'Якщо це посилання зміниться чи зникне, відвідувачі й пошукові системи втратять шлях до сторінки.',
      fix: 'Додайте посилання на ці сторінки з інших сторінок, де це доречно: з меню, схожого розділу чи підвалу сайту.',
      count:
        'Одна знахідка на кожну таку сторінку; технічні деталі називають ту єдину сторінку, що на неї посилається.',
    },
  },
  'SEO-ONPAGE-001': {
    countsPages: true,
    en: {
      title: 'Page name for search results is missing, too short or too long',
      what: 'These pages have no page name (the one shown in the browser tab and as the headline of a search result), or it is shorter than 10 or longer than 70 characters.',
      why: 'Search engines usually show this name as the headline of your result; a missing or cut-off one gives people less reason to click.',
      fix: 'Give each page a short, distinct name that says what is on it. Most site builders have a field for it, often called the SEO title.',
      count: 'One finding for each page.',
    },
    uk: {
      title: 'Назва сторінки для пошуку відсутня, закоротка або задовга',
      what: 'Ці сторінки не мають назви (тієї, що видно на вкладці браузера й у заголовку результату пошуку), або вона коротша за 10 чи довша за 70 символів.',
      why: 'Пошукові системи зазвичай показують цю назву як заголовок вашого результату; без неї чи з обрізаною людям менше причин натиснути.',
      fix: 'Дайте кожній сторінці коротку власну назву, яка каже, що на ній. У більшості конструкторів сайтів для цього є поле, часто воно зветься SEO-заголовок.',
      count: 'Одна знахідка на кожну сторінку.',
    },
  },
  'SEO-ONPAGE-002': {
    countsPages: true,
    en: {
      title: 'Page summary for search results is missing or the wrong length',
      what: 'These pages have no short summary for search engines, or it is shorter than 50 or longer than 160 characters.',
      why: 'Search engines often show this summary under the headline of your result; without a fitting one they pick a piece of the page themselves.',
      fix: 'Write a one- or two-sentence summary for each page. Most site builders have a field for it, often called the SEO description.',
      count: 'One finding for each page.',
    },
    uk: {
      title: 'Опис сторінки для пошуку відсутній або неправильної довжини',
      what: 'Ці сторінки не мають короткого опису для пошукових систем, або він коротший за 50 чи довший за 160 символів.',
      why: 'Пошукові системи часто показують цей опис під заголовком вашого результату; якщо доречного немає, вони беруть шматок сторінки самі.',
      fix: 'Напишіть для кожної сторінки опис в одне-два речення. У більшості конструкторів сайтів для цього є поле, часто воно зветься SEO-опис.',
      count: 'Одна знахідка на кожну сторінку.',
    },
  },
  'SEO-ONPAGE-003': {
    countsPages: true,
    en: {
      title: 'Headings do not form a clear outline',
      what: 'These pages have no main heading, more than one, or headings that skip a level, such as a small sub-heading straight under the main one.',
      why: 'Search engines and visitors who skim use the headings to understand what a page is about and how it is organised.',
      fix: 'Give each page one main heading and use sub-headings in order. If the headings come from the site template, ask your website developer; otherwise whoever edits the pages can fix it.',
      count: 'One finding for each page, covering every heading issue on it.',
    },
    uk: {
      title: 'Заголовки не складаються в чітку структуру',
      what: 'Ці сторінки не мають головного заголовка, мають кілька або містять заголовки з пропущеним рівнем, наприклад дрібний підзаголовок одразу під головним.',
      why: 'Пошукові системи й відвідувачі, що переглядають сторінку побіжно, за заголовками розуміють, про що вона і як побудована.',
      fix: 'Дайте кожній сторінці один головний заголовок і використовуйте підзаголовки по порядку. Якщо заголовки задає шаблон сайту, зверніться до розробника; інакше це може виправити той, хто редагує сторінки.',
      count: 'Одна знахідка на кожну сторінку, що охоплює всі проблеми із заголовками на ній.',
    },
  },
  // "Photos" was the wrong word for what the rule does. `seo-onpage-005.ts`
  // flags every <img> with no `alt` attribute at all — logos, icons and spacer
  // images included — and treats an empty alt="" as correct, which is what the
  // product's own recommendation asks for ("every decorative one an explicit
  // empty alt"). So the advice said "add a short description to each photo" to
  // a developer whose correct answer, for half of them, is an empty one.
  'SEO-ONPAGE-005': {
    countsPages: true,
    en: {
      title: 'Pictures with no written description',
      what: 'These pages carry pictures — photographs, logos and icons alike — with no written description at all, not even an empty one.',
      why: 'Visitors who cannot see the picture — and search engines, which cannot see it either — have nothing to go on, so a gallery that is the whole point of the page says nothing about it.',
      fix: 'Add a short description to each picture that carries meaning, such as “Pink gel manicure with gold tips”. A picture that is only decoration can be marked as having nothing to describe (an empty description) — your developer will know the field. Most site builders have a field for it beside the picture, often called the alt text.',
      count:
        'One finding for each page that has such pictures, however many of them it has; the technical details count the pictures.',
    },
    uk: {
      title: 'Зображення без текстового опису',
      what: 'На цих сторінках є зображення — і фотографії, і логотипи, і значки, — у яких текстового опису немає взагалі, навіть порожнього.',
      why: 'Відвідувачі, які не бачать зображення, — і пошукові системи, які їх теж не бачать, — не мають із чого зрозуміти, що на них, тож галерея, задля якої й існує сторінка, нічого про неї не каже.',
      fix: 'Додайте короткий опис до кожного змістовного зображення, наприклад «Рожевий гель-манікюр із золотими кінчиками». Зображення, яке є лише оздобою, можна позначити як таке, що описувати нічого (порожній опис), — ваш розробник знає це поле. У більшості конструкторів сайтів для цього є поле біля зображення, часто воно зветься alt-текст.',
      count:
        'Одна знахідка на кожну сторінку з такими зображеннями, хоч би скільки їх на ній було; технічні деталі рахують зображення.',
    },
  },
  'SEO-ONPAGE-004': {
    countsPages: true,
    en: {
      title: 'Several pages share the same name in search results',
      what: 'These pages have exactly the same page name (the one shown in the browser tab and as the headline of a search result) as at least one other page, and nothing tells search engines which of them is the main one.',
      why: 'When pages share a name, search engines find it harder to tell them apart and may show the less useful one, and people reading the results cannot tell them apart either.',
      fix: 'Give each page its own name that says what is on it; most site builders call this field the SEO title. If two pages really are the same, ask your website developer to mark one of them as the original.',
      count:
        'One finding for each page that shares its name, so two pages with the same name are two findings.',
    },
    uk: {
      title: 'Кілька сторінок мають однакову назву в пошуку',
      what: 'Ці сторінки мають точно таку саму назву (ту, що видно на вкладці браузера й у заголовку результату пошуку), як щонайменше одна інша сторінка, і ніщо не підказує пошуковим системам, яка з них головна.',
      why: 'Коли назви однакові, пошуковим системам важче розрізнити сторінки, і вони можуть показати менш корисну, а людям у результатах пошуку теж важко їх розрізнити.',
      fix: 'Дайте кожній сторінці власну назву, яка каже, що на ній; у більшості конструкторів це поле зветься SEO-заголовок. Якщо дві сторінки справді однакові, попросіть розробника позначити одну з них як оригінал.',
      count:
        'Одна знахідка на кожну сторінку з повторюваною назвою, тож дві сторінки з однаковою назвою — це дві знахідки.',
    },
  },
  'SEO-STRUCT-002': {
    countsPages: true,
    en: {
      title: 'Hidden page descriptions for search engines are incomplete',
      what: 'These pages carry a hidden, machine-readable description for search engines, but part of it is incomplete: it does not say which vocabulary it uses or what kind of thing it describes.',
      why: 'Search engines use this description to understand a page and sometimes to show a richer result; an incomplete one may simply be ignored.',
      fix: 'Ask your website developer, or check the plugin that adds this description, to fill in what is missing. The technical details say how many parts are incomplete.',
      count: 'One finding for each page, however many incomplete parts it has.',
    },
    uk: {
      title: 'Приховані описи сторінок для пошукових систем неповні',
      what: 'Ці сторінки містять прихований машиночитний опис для пошукових систем, але частина його неповна: не вказано, за яким словником його складено або що саме описано.',
      why: 'Пошукові системи використовують цей опис, щоб зрозуміти сторінку, а інколи — щоб показати розширений результат; неповний опис можуть просто проігнорувати.',
      fix: 'Попросіть розробника доповнити те, чого бракує, або перевірте плагін, що додає цей опис. Технічні деталі кажуть, скільки частин неповні.',
      count: 'Одна знахідка на кожну сторінку, хоч би скільки неповних частин на ній було.',
    },
  },
  'PRIVACY-001': {
    countsPages: true,
    en: {
      title: 'Pages that set cookies',
      what: 'These pages store cookies in the visitor’s browser. The finding lists their names; their values are not recorded.',
      why: 'Privacy rules in many places expect a site to explain the cookies it uses and to ask before setting the ones that are not strictly needed. This is an inventory to check, not a sign that something is wrong.',
      fix: 'Check that each cookie named in the technical details is needed and described in your privacy policy and — where the rules that apply to your visitors require it — that the ones not strictly needed wait for the visitor’s consent. Your website developer can tell you what sets each one.',
      count: 'One finding for each page that sets at least one cookie.',
    },
    uk: {
      title: 'Сторінки, що встановлюють cookie',
      what: 'Ці сторінки зберігають cookie в браузері відвідувача. Знахідка перелічує їхні назви; значення не записуються.',
      why: 'Правила приватності в багатьох країнах очікують, що сайт пояснює, які cookie використовує, і питає згоди перед тими, що не є суто необхідними. Це перелік для перевірки, а не ознака, що щось не так.',
      fix: 'Перевірте, що кожна cookie з технічних деталей потрібна й описана у вашій політиці конфіденційності, а там, де цього вимагають правила для ваших відвідувачів, — що не суто необхідні чекають на згоду відвідувача. Розробник може підказати, що встановлює кожну з них.',
      count: 'Одна знахідка на кожну сторінку, що встановлює хоча б одну cookie.',
    },
  },
  'CONTENT-005': {
    countsPages: true,
    en: {
      title: 'Text that is hard to read',
      what: 'The text on these pages scored low on a readability formula for its language, which counts the length of sentences and words.',
      why: 'Long sentences and long words make visitors work harder, especially on a phone, and some of them give up before reaching what you wanted them to read.',
      fix: 'Shorten long sentences, choose simpler words and split dense paragraphs. The score counts lengths only; it does not judge what the text says.',
      count: 'One finding for each page whose text scored below the threshold.',
    },
    uk: {
      title: 'Текст, який важко читати',
      what: 'Текст цих сторінок отримав низьку оцінку за формулою читабельності для своєї мови, яка рахує довжину речень і слів.',
      why: 'Довгі речення й довгі слова змушують відвідувачів напружуватися, особливо з телефона, і дехто кидає читати, не дійшовши до головного.',
      fix: 'Скоротіть довгі речення, оберіть простіші слова й розбийте щільні абзаци. Оцінка рахує лише довжини й не оцінює зміст тексту.',
      count: 'Одна знахідка на кожну сторінку, текст якої отримав оцінку нижче порогу.',
    },
  },
  'UX-CONV-AI-001': {
    countsPages: false,
    en: {
      title: 'It may not be clear what you offer',
      what: 'An AI review of the text on these pages, read against how your site profile describes the business, suggests that a new visitor may not quickly understand what you offer and to whom. It read the page text only, not how the page looks.',
      why: 'Visitors decide quickly whether a page is meant for them, and an unclear offer gives them a reason to look elsewhere.',
      fix: 'Read the page as a first-time visitor and make its first lines say plainly what you offer, to whom and where. The technical details quote what the review was based on.',
      count: AI_REVIEW_COUNT_EN,
    },
    uk: {
      title: 'Може бути незрозуміло, що ви пропонуєте',
      what: 'Перевірка тексту цих сторінок штучним інтелектом, з огляду на опис бізнесу в профілі сайту, показує, що новий відвідувач може не одразу зрозуміти, що ви пропонуєте й кому. Вона читала лише текст сторінки, а не її вигляд.',
      why: 'Відвідувачі швидко вирішують, чи сторінка для них, і незрозуміла пропозиція дає їм привід шукати деінде.',
      fix: 'Прочитайте сторінку очима нового відвідувача й зробіть так, щоб перші рядки прямо казали, що ви пропонуєте, кому й де. Технічні деталі цитують, на чому ґрунтується зауваження.',
      count: AI_REVIEW_COUNT_UK,
    },
  },
  'UX-CONV-AI-002': {
    countsPages: false,
    en: {
      title: 'The main next step may be unclear',
      what: 'An AI review of the buttons, links and forms on these pages suggests that the one thing you want a visitor to do (book, call, buy, write) may be hard to spot or easy to confuse with other options. It read the page text only, not how the page looks.',
      why: 'A visitor who is ready to act has to find the next step; when it is unclear, some of them stop there.',
      fix: 'Decide on the one action each page should lead to and make its button or link say it plainly. The technical details quote what the review was based on.',
      count: AI_REVIEW_COUNT_EN,
    },
    uk: {
      title: 'Головний наступний крок може бути незрозумілим',
      what: 'Перевірка кнопок, посилань і форм цих сторінок штучним інтелектом показує, що головну дію, якої ви чекаєте від відвідувача (записатися, подзвонити, купити, написати), може бути важко помітити або сплутати з іншими. Вона читала лише текст сторінки, а не її вигляд.',
      why: 'Відвідувач, готовий діяти, має знайти наступний крок; коли він незрозумілий, дехто на цьому й зупиняється.',
      fix: 'Визначте одну дію, до якої має вести кожна сторінка, і зробіть так, щоб її кнопка чи посилання прямо про неї казали. Технічні деталі цитують, на чому ґрунтується зауваження.',
      count: AI_REVIEW_COUNT_UK,
    },
  },
  'UX-CONV-AI-003': {
    countsPages: false,
    en: {
      title: 'Something may hold visitors back from contacting you',
      what: 'An AI review of the steps, contact options and signs of trust in the text of these pages (reviews, prices, an address, guarantees) suggests that something may make a visitor hesitate: a missing way to get in touch, an extra step, or too little to go on. It read the page text only, not how the page looks.',
      why: 'Visitors who cannot easily reach you, or are not yet sure about you, may turn to someone else.',
      fix: 'Check the point the review raised and add what is missing (a phone or messenger link, prices, reviews, an address), or remove the extra step. The technical details quote what the review was based on.',
      count: AI_REVIEW_COUNT_EN,
    },
    uk: {
      title: 'Щось може стримувати відвідувачів від звернення до вас',
      what: 'Перевірка штучним інтелектом кроків, способів звʼязку й ознак довіри в тексті цих сторінок (відгуки, ціни, адреса, гарантії) показує, що щось може змусити відвідувача вагатися: бракує способу звʼязатися, є зайвий крок або замало відомостей. Вона читала лише текст сторінки, а не її вигляд.',
      why: 'Відвідувачі, які не можуть легко з вами звʼязатися чи ще не впевнені у вас, можуть звернутися до когось іншого.',
      fix: 'Перегляньте зауваження й додайте те, чого бракує (телефон чи посилання на месенджер, ціни, відгуки, адресу), або приберіть зайвий крок. Технічні деталі цитують, на чому ґрунтується зауваження.',
      count: AI_REVIEW_COUNT_UK,
    },
  },
};

/** Every rule with a plain-language explanation, for the coverage test. */
export const EXPLAINED_RULE_IDS: readonly string[] = Object.keys(EXPLAINERS);

/** The plain-language explanation of a rule, or null for a rule that has none. */
export function findingExplainer(ruleId: string, language: Language): FindingExplainer | null {
  return EXPLAINERS[ruleId]?.[language] ?? null;
}

/**
 * Whether this rule is explained in plain language — the condition for folding
 * its raw evidence and recommendation away under the technical disclosure.
 */
export function hasFindingExplainer(ruleId: string): boolean {
  return EXPLAINERS[ruleId] !== undefined;
}

/**
 * Whether one finding of this rule is one page, so a count of its findings can
 * be said as a count of pages. Unknown rules say "findings": claiming pages for
 * a rule that reports per cookie or per link would overstate the reach.
 */
export function findingCountsPages(ruleId: string): boolean {
  return EXPLAINERS[ruleId]?.countsPages ?? false;
}

/** The problem's name in the owner's words, or the rule's own title when it has none. */
export function problemTitle(ruleId: string, language: Language): string {
  return findingExplainer(ruleId, language)?.title ?? ruleTitle(ruleId, language);
}

/**
 * The rule's technical title when the headline is the plain one — the name the
 * report's dashboard and the developer use — and the bare rule id otherwise,
 * as it always was. It belongs in a finding's technical details: beside the
 * plain name it restated the same problem in the developer's words, and the
 * row read as two problems.
 */
export function problemTechnicalName(ruleId: string, language: Language): string {
  return hasFindingExplainer(ruleId) ? ruleTitle(ruleId, language) : ruleId;
}

/**
 * The rule id for a list row to carry beside the section, or null when it adds
 * nothing there.
 *
 * It adds nothing twice over: under a plain-language name the id is a support
 * code that belongs with the rest of the developer's half, and for a rule with
 * no registered title at all `problemTitle` already falls back to the id, so
 * printing it again says the same word twice on one row.
 */
export function problemSupportCode(ruleId: string, language: Language): string | null {
  if (hasFindingExplainer(ruleId)) return null;
  return problemTitle(ruleId, language) === ruleId ? null : ruleId;
}
