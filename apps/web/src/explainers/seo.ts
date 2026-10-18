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
  'SEO-ONPAGE-006': {
    countsPages: true,
    en: {
      title: 'Several pages share the same summary in search results',
      what: 'These pages have exactly the same short summary for search engines as at least one other page, and nothing tells search engines which of them is the main one. Pages with no summary at all are a separate finding.',
      why: 'When pages share a summary, people reading the search results cannot tell them apart, and search engines often replace it with a piece of the page they pick themselves.',
      fix: 'Write each page its own one- or two-sentence summary of what is on it; most site builders call this field the SEO description.',
      count:
        'One finding for each page that shares its summary, so two pages with the same summary are two findings.',
    },
    uk: {
      title: 'Кілька сторінок мають однаковий опис у пошуку',
      what: 'Ці сторінки мають точно такий самий короткий опис для пошукових систем, як щонайменше одна інша сторінка, і ніщо не підказує пошуковим системам, яка з них головна. Сторінки зовсім без опису — це окрема знахідка.',
      why: 'Коли опис однаковий, люди в результатах пошуку не можуть розрізнити сторінки, а пошукові системи часто замінюють його шматком сторінки, обраним на свій розсуд.',
      fix: 'Напишіть для кожної сторінки власний опис в одне-два речення про те, що на ній; у більшості конструкторів сайтів це поле зветься SEO-опис.',
      count:
        'Одна знахідка на кожну сторінку з повторюваним описом, тож дві сторінки з однаковим описом — це дві знахідки.',
    },
  },
  'SEO-SOCIAL-001': {
    countsPages: true,
    en: {
      title: 'Links to these pages share without a full preview',
      what: 'These pages lack some of the fields that messengers and social networks read to build a link preview: its headline, short description, picture, address, or the card type X (formerly Twitter) uses. The technical details name the missing ones.',
      why: 'When someone shares the page on Facebook, Telegram or Viber, the preview may come out without a picture or with the wrong text, and people are less likely to open it.',
      fix: 'Fill in each page’s settings for sharing on social networks, usually called the social image and description in your site builder; on WordPress an SEO plugin does it. Then share a link to check the preview.',
      count: 'One finding for each page, however many fields it lacks.',
    },
    uk: {
      title: 'Посилання на ці сторінки поширюються без повного превʼю',
      what: 'Цим сторінкам бракує частини полів, з яких месенджери й соцмережі складають превʼю посилання: заголовка, короткого опису, зображення, адреси чи типу картки, який використовує X (колишній Twitter). Технічні деталі називають, яких саме.',
      why: 'Коли хтось ділиться сторінкою у Facebook, Telegram чи Viber, превʼю може вийти без зображення чи з не тим текстом, і відкривати його будуть рідше.',
      fix: 'Заповніть для кожної сторінки налаштування для соцмереж, які в конструкторі сайту зазвичай звуться зображенням і описом для поширення; у WordPress це робить SEO-плагін. Потім поділіться посиланням, щоб перевірити превʼю.',
      count: 'Одна знахідка на кожну сторінку, хоч би скільки полів їй бракувало.',
    },
  },
  // seo/structured-data.ts: a block that is empty counts as one that cannot be
  // read, so `what` says "broken or empty".
  'SEO-STRUCT-001': {
    countsPages: true,
    en: {
      title: 'Hidden page descriptions for search engines cannot be read',
      what: 'These pages carry a hidden, machine-readable description for search engines, but at least one part of it is broken or empty and cannot be read at all.',
      why: 'Search engines skip a part they cannot read, so whatever it was meant to tell them about your business, such as the address, opening hours or reviews, is lost to them.',
      fix: 'Ask your website developer to repair it, or check the plugin that adds this description. The technical details say how many parts cannot be read.',
      count: 'One finding for each page, however many broken parts it has.',
    },
    uk: {
      title: 'Приховані описи сторінок для пошукових систем не читаються',
      what: 'Ці сторінки містять прихований машиночитний опис для пошукових систем, але щонайменше одна його частина пошкоджена або порожня й не читається зовсім.',
      why: 'Частину, яку не вдається прочитати, пошукові системи пропускають, тож усе, що вона мала сказати їм про ваш бізнес, як-от адресу, години роботи чи відгуки, для них втрачено.',
      fix: 'Попросіть розробника її виправити або перевірте плагін, що додає цей опис. Технічні деталі кажуть, скільки частин не читаються.',
      count: 'Одна знахідка на кожну сторінку, хоч би скільки пошкоджених частин на ній було.',
    },
  },
  // seo-tech-001.ts: reported only when the file does not come back; an empty
  // or odd file is not judged.
  'SEO-TECH-001': {
    countsPages: false,
    en: {
      title: 'The instructions file for search engines is missing',
      what: 'Your site did not return its file of instructions for search engine crawlers at the usual address when FluxRadar asked for it. Only whether the file comes back is checked; an empty file would not have been reported.',
      why: 'Search engines look for this file first, to learn what they may read and where your list of pages is. Without it they read everything they find, which is usually fine, but you cannot point them to that list.',
      fix: 'Most site builders create this file for you, so check that it is not switched off in the SEO settings; otherwise ask your website developer to publish one with a link to the list of your pages.',
      count: 'One finding for the whole site.',
    },
    uk: {
      title: 'Немає файлу інструкцій для пошукових систем',
      what: 'Ваш сайт не віддав файлу інструкцій для пошукових роботів за звичною адресою, коли FluxRadar його запитав. Перевіряється лише те, чи файл віддається; порожній файл знахідки не дав би.',
      why: 'Пошукові системи насамперед шукають цей файл, щоб дізнатися, що їм можна читати й де лежить перелік ваших сторінок. Без нього вони читають усе, що знайдуть, і зазвичай це нормально, але вказати їм на цей перелік ви не можете.',
      fix: 'Більшість конструкторів сайтів створюють цей файл самі, тож перевірте, чи його не вимкнено в налаштуваннях SEO; інакше попросіть розробника опублікувати його з посиланням на перелік ваших сторінок.',
      count: 'Одна знахідка на весь сайт.',
    },
  },
  'SEO-TECH-002': {
    countsPages: false,
    en: {
      title: 'No list of pages for search engines',
      what: 'FluxRadar found no list of your pages for search engines (a sitemap): the instructions file for search engines does not point to one, and the usual address does not return one with any pages in it.',
      why: 'Search engines use this list to find every page you want shown, including ones few links lead to; without it, they rely on following links alone.',
      fix: 'Most site builders make this list automatically, so check that it is switched on in the SEO settings; on WordPress an SEO plugin usually adds it. Otherwise ask your website developer to publish one.',
      count: 'One finding for the whole site.',
    },
    uk: {
      title: 'Немає переліку сторінок для пошукових систем',
      what: 'FluxRadar не знайшов переліку ваших сторінок для пошукових систем (карти сайту): на нього не вказує файл інструкцій для пошукових систем, а за звичною адресою немає переліку бодай з однією сторінкою.',
      why: 'Пошукові системи за цим переліком знаходять усі сторінки, які ви хочете показувати, зокрема ті, на які веде мало посилань; без нього вони покладаються лише на посилання.',
      fix: 'Більшість конструкторів сайтів створюють цей перелік автоматично, тож перевірте, чи його ввімкнено в налаштуваннях SEO; у WordPress його зазвичай додає SEO-плагін. Інакше попросіть розробника його опублікувати.',
      count: 'Одна знахідка на весь сайт.',
    },
  },
  // seo-tech-004.ts: no mark, a mark that is not a valid address, or one on a
  // different host — and the www and bare forms are different hosts there.
  'SEO-TECH-004': {
    countsPages: true,
    en: {
      title: 'Pages do not say which address is their main one',
      what: 'These pages either do not name their own main address for search engines, name one that is not a valid address, or name an address on a different domain, where even the forms with and without “www” count as different.',
      why: 'Search engines use this mark to pick one address when a page opens at several. Without it they pick for themselves, and a mark pointing to another domain asks them to show that domain instead.',
      fix: 'Most site builders and SEO plugins set this mark for you, so check that it is switched on and that the site uses one form of its domain. The technical details say which of the three applies to each page; your website developer can fix the rest.',
      count: 'One finding for each page.',
    },
    uk: {
      title: 'Сторінки не вказують своєї головної адреси',
      what: 'Ці сторінки або не називають пошуковим системам своєї головної адреси, або називають недійсну адресу, або адресу на іншому домені, причому навіть варіанти з «www» і без нього вважаються різними.',
      why: 'Пошукові системи за цією позначкою обирають одну адресу, коли сторінка відкривається за кількома. Без неї вони обирають самі, а позначка, що веде на інший домен, просить їх показувати той домен замість вашого.',
      fix: 'Більшість конструкторів сайтів і SEO-плагінів ставлять цю позначку самі, тож перевірте, чи її ввімкнено й чи сайт використовує одну форму домену. Технічні деталі кажуть, який із трьох випадків стосується кожної сторінки; решту виправить розробник.',
      count: 'Одна знахідка на кожну сторінку.',
    },
  },
  'SEO-TECH-005': {
    countsPages: true,
    en: {
      title: 'Addresses that forward too many times',
      what: 'These addresses forward the visitor two or more times before the page appears, or keep forwarding without ever reaching a page.',
      why: 'Each extra step makes the page open more slowly, and search engines may stop following a long chain; an address that never reaches a page does not open at all.',
      fix: 'Ask your website developer to forward old addresses straight to the final page in one step, and to point the site’s own links at the final address. The technical details show each step.',
      count: 'One finding for each address.',
    },
    uk: {
      title: 'Адреси із забагатьма перенаправленнями',
      what: 'Ці адреси перенаправляють відвідувача двічі або більше, перш ніж зʼявиться сторінка, або перенаправляють далі й далі, так і не діставшись сторінки.',
      why: 'Кожен зайвий крок сповільнює відкриття сторінки, а за довгим ланцюжком пошукові системи можуть і не піти; а якщо перенаправлення так і не доходять до сторінки, вона не відкривається зовсім.',
      fix: 'Попросіть розробника перенаправляти старі адреси одразу на кінцеву сторінку одним кроком, а посилання самого сайту спрямувати на кінцеву адресу. Технічні деталі показують кожен крок.',
      count: 'Одна знахідка на кожну адресу.',
    },
  },
  // A page that asks to stay out of search is reported only when the site
  // still points to it (seo-tech-008.ts); on its own it is the owner's choice.
  'SEO-TECH-008': {
    countsPages: true,
    en: {
      title: 'Pages hidden from search that the site still points to',
      what: 'These pages ask search engines not to show them, yet your list of pages for search engines includes them, or other pages of your site link to them.',
      why: 'The two signals contradict each other: if the page should be found, the request to hide it keeps it out of search; if it should stay hidden, the list and the links keep sending search engines to it.',
      fix: 'Decide whether each page should be found. If it should, switch off hiding it from search engines in its page settings; if not, take it out of the list of pages and remove the links to it.',
      count: 'One finding for each page.',
    },
    uk: {
      title: 'Сторінки, приховані від пошуку, на які сайт досі вказує',
      what: 'Ці сторінки просять пошукові системи не показувати їх, але їх містить ваш перелік сторінок для пошукових систем або на них посилаються інші сторінки вашого сайту.',
      why: 'Ці два сигнали суперечать один одному: якщо сторінку мають знаходити, прохання її приховати не пускає її в пошук; якщо вона має лишатися прихованою, перелік і посилання й далі ведуть до неї пошукові системи.',
      fix: 'Вирішіть для кожної сторінки, чи її мають знаходити. Якщо так, вимкніть приховування від пошукових систем у її налаштуваннях; якщо ні, приберіть її з переліку сторінок і зніміть посилання на неї.',
      count: 'Одна знахідка на кожну сторінку.',
    },
  },
  // seo-tech-009.ts: in the sitemap, read, and linked from none of the pages
  // the scan read; the start page is never a candidate.
  'SEO-TECH-009': {
    countsPages: true,
    en: {
      title: 'Pages only the list for search engines leads to',
      what: 'These pages are in your list of pages for search engines, but none of the pages this scan read links to them.',
      why: 'Visitors cannot reach such a page by clicking through the site, and search engines tend to treat a page nothing links to as less important.',
      fix: 'Link to each of these pages from where it belongs: the menu, a related section or the footer. If a page is no longer needed, remove it from the site.',
      count: 'One finding for each such page.',
    },
    uk: {
      title: 'Сторінки, до яких веде лише перелік для пошукових систем',
      what: 'Ці сторінки є у вашому переліку сторінок для пошукових систем, але жодна сторінка, прочитана під час сканування, на них не посилається.',
      why: 'Відвідувачі не можуть дістатися до такої сторінки, переходячи сайтом, а пошукові системи зазвичай вважають сторінку, на яку ніщо не посилається, менш важливою.',
      fix: 'Поставте посилання на кожну з цих сторінок там, де їй місце: у меню, схожому розділі чи підвалі сайту. Якщо сторінка більше не потрібна, приберіть її із сайту.',
      count: 'Одна знахідка на кожну таку сторінку.',
    },
  },
  'SEO-TECH-010': {
    countsPages: true,
    en: {
      title: 'Pages too many clicks away from the start',
      what: 'Reaching these pages from the page this scan started at, usually your home page, takes four or more clicks on links.',
      why: 'Visitors rarely click that far, and search engines tend to find and revisit deep pages later than ones close to the home page.',
      fix: 'Bring these pages closer: link to them from the menu, or from a section page one or two clicks from the home page.',
      count: 'One finding for each such page; the technical details give the number of clicks.',
    },
    uk: {
      title: 'Сторінки, до яких від стартової сторінки забагато кліків',
      what: 'Щоб дістатися до цих сторінок від сторінки, з якої почалося сканування (зазвичай головної), потрібно чотири або більше переходів за посиланнями.',
      why: 'Відвідувачі рідко клацають так далеко, а пошукові системи зазвичай знаходять і переглядають глибокі сторінки пізніше, ніж ті, що близько до головної.',
      fix: 'Наблизьте ці сторінки: поставте на них посилання з меню або зі сторінки розділу, що за один-два кліки від головної.',
      count: 'Одна знахідка на кожну таку сторінку; технічні деталі наводять кількість кліків.',
    },
  },
  // seo-tech-013.ts reports each insecure file once per page; on a page not yet
  // served securely only files from other sites count.
  'SEO-TECH-013': {
    countsPages: false,
    en: {
      title: 'Files loaded over an insecure connection',
      what: 'These pages load a picture, script, embedded window, design file, icon or another file the page asks the browser to fetch from an address without the secure connection (one starting with “http://” rather than “https://”). On a page that is not yet served securely itself, only such files from other websites are counted.',
      why: 'Browsers block some of these files or mark the page as not fully secure, so a picture may go missing or the visitor may see a warning.',
      fix: 'Change each address named in the technical details to its secure version, which usually means adding an “s” after “http”, or upload the file to your own site. If it comes from the theme or a plugin, ask your website developer.',
      count: 'One finding for each such file on each page, so a page can appear more than once.',
    },
    uk: {
      title: 'Файли, що завантажуються незахищеним зʼєднанням',
      what: 'Ці сторінки завантажують зображення, скрипт, вбудоване вікно, файл оформлення, значок чи інший файл, який сторінка просить браузер завантажити, з адреси без захищеного зʼєднання (що починається з «http://», а не з «https://»). На сторінці, яка сама ще відкривається без захищеного зʼєднання, рахуються лише такі файли з інших сайтів.',
      why: 'Браузери блокують частину таких файлів або позначають сторінку як не повністю захищену, тож зображення може зникнути, а відвідувач може побачити попередження.',
      fix: 'Замініть кожну адресу з технічних деталей на її захищену версію (зазвичай досить додати «s» після «http») або завантажте файл на власний сайт. Якщо файл іде з теми оформлення чи плагіна, зверніться до розробника.',
      count:
        'Одна знахідка на кожен такий файл на кожній сторінці, тож сторінка може зʼявитися кілька разів.',
    },
  },
};
