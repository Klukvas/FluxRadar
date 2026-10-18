// SEO: what search engines read on a page and how they reach it.

import { type ExplainedRule } from './types';

export const SEO_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
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
};
