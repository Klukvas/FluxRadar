// Analytics: what the owner's connected Google Analytics and Search Console
// data say next to the crawl (apps/api/src/orchestrator/analytics). These
// findings are not read from the pages' public responses, so each one says
// where its figures came from instead of the report's general sentence.

import type { ExplainedRule } from './types';

const GOOGLE_DATA_SCOPE_EN =
  'These findings come from the Google Analytics or Search Console account you connected, read with view-only access, compared with the pages this scan crawled. FluxRadar changed nothing in that account, and the figures are the ones Google reported at the time of the scan.';
const GOOGLE_DATA_SCOPE_UK =
  'Ці знахідки ґрунтуються на даних підключеного вами акаунта Google Analytics чи Search Console, прочитаних лише з доступом на перегляд і зіставлених зі сторінками, які обійшло це сканування. FluxRadar нічого в цьому акаунті не змінював, а цифри такі, якими їх подав Google на момент сканування.';

// GA-002 needs a connected property to run, but reads the crawled pages' code.
const PAGE_CODE_SCOPE_EN =
  'This check runs only while a Google Analytics property is connected, but what it reads is the code of the pages this scan crawled, not your Google data. FluxRadar changed nothing in that account.';
const PAGE_CODE_SCOPE_UK =
  'Ця перевірка виконується лише тоді, коли підключено ресурс Google Analytics, але читає вона код сторінок, які обійшло це сканування, а не ваші дані Google. FluxRadar нічого в цьому акаунті не змінював.';

export const ANALYTICS_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  'ANALYTICS-GA-001': {
    countsPages: false,
    en: {
      title: 'Google Analytics records no key actions',
      what: 'In the Google Analytics property you connected, the last 28 days have visits but not one key event: an action you mark as important, such as a booking, a call or a sent form.',
      why: 'Without key events Google Analytics cannot show which visits led to an enquiry or a sale, so you cannot tell which pages or channels bring you customers.',
      fix: 'In Google Analytics, mark the actions that matter to you, such as a sent form or a booking, as key events, and check that they are actually recorded. If the site does not pass such actions to Google Analytics yet, ask whoever set it up to add them.',
      count: 'One finding for the whole site.',
      scope: GOOGLE_DATA_SCOPE_EN,
    },
    uk: {
      title: 'Google Analytics не фіксує жодних ключових дій',
      what: 'У ресурсі Google Analytics, який ви підключили, за останні 28 днів є відвідування, але немає жодної ключової події, тобто дії, яку ви позначаєте як важливу: запису на прийом, дзвінка чи надісланої форми.',
      why: 'Без ключових подій Google Analytics не покаже, які відвідування закінчилися зверненням чи покупкою, тож ви не знаєте, які сторінки чи канали приводять клієнтів.',
      fix: 'У Google Analytics позначте як ключові події ті дії, що для вас важливі, як-от надіслану форму чи запис, і перевірте, що вони справді фіксуються. Якщо сайт іще не передає таких дій у Google Analytics, попросіть того, хто його налаштовував, їх додати.',
      count: 'Одна знахідка на весь сайт.',
      scope: GOOGLE_DATA_SCOPE_UK,
    },
  },
  // ga-checks.ts judges only when at least one crawled page carries the tag in
  // its code: a site loading it some other way would otherwise be "untagged"
  // everywhere. `what` names that limit.
  'ANALYTICS-GA-002': {
    countsPages: true,
    en: {
      title: 'Pages Google Analytics may not count',
      what: 'The code of these pages carries no Google Analytics or Google Tag Manager tag, while other pages of the same scan do. Only the page code FluxRadar received is read, so a tag the site adds some other way is not seen.',
      why: 'Visits to a page without the tag are probably not counted, so your Google Analytics figures for these pages can come out lower than they really are.',
      fix: 'Add the same Google tag the other pages use, usually once in your site builder’s site-wide settings (often a field for header code or tracking code), or ask whoever set up Google Analytics.',
      count: 'One finding for each page without the tag.',
      scope: PAGE_CODE_SCOPE_EN,
    },
    uk: {
      title: 'Сторінки, які Google Analytics може не враховувати',
      what: 'Код цих сторінок не містить тегу Google Analytics чи Google Tag Manager, тоді як інші сторінки цього ж сканування його мають. Читається лише код сторінки, який отримав FluxRadar, тож тегу, який сайт додає інакше, не видно.',
      why: 'Відвідування сторінки без тегу, імовірно, не враховуються, тож цифри Google Analytics для цих сторінок можуть бути меншими, ніж насправді.',
      fix: 'Додайте той самий тег Google, що й на інших сторінках, зазвичай один раз у загальних налаштуваннях конструктора сайту (часто це поле для коду в шапці чи коду відстеження), або зверніться до того, хто налаштовував Google Analytics.',
      count: 'Одна знахідка на кожну сторінку без тегу.',
      scope: PAGE_CODE_SCOPE_UK,
    },
  },
  // search-checks.ts: clicks when the earlier period had at least 10, the
  // number of times the site was shown otherwise; a fall of 30% or more.
  'ANALYTICS-SC-001': {
    countsPages: false,
    en: {
      title: 'Fewer visits from Google search',
      what: 'In the Search Console data you connected, clicks from Google search over the last 28 days fell by 30% or more against the 28 days before. Where there were too few clicks to compare, the number of times Google showed the site is compared instead.',
      why: 'A fall this size is more than everyday ups and downs: fewer people are reaching the site from Google, and it is worth finding which pages or searches it started with.',
      fix: 'In Search Console, compare the two periods page by page and search by search to see where the visits went, and check whether some pages dropped out of Google or changed their address. Your website developer can help with the second part.',
      count: 'One finding for the whole site.',
      scope: GOOGLE_DATA_SCOPE_EN,
    },
    uk: {
      title: 'Менше переходів із пошуку Google',
      what: 'За даними Search Console, яку ви підключили, переходів із пошуку Google за останні 28 днів стало щонайменше на 30% менше, ніж за попередні 28 днів. Якщо переходів замало для порівняння, натомість порівнюється, скільки разів Google показував сайт.',
      why: 'Таке падіння більше за звичайні коливання: до сайту з Google доходить менше людей, і варто знайти, з яких сторінок чи пошукових запитів воно почалося.',
      fix: 'У Search Console порівняйте обидва періоди за сторінками й запитами, щоб побачити, куди поділися переходи, і перевірте, чи не випали якісь сторінки з Google або чи не змінили вони адресу. З другим може допомогти розробник.',
      count: 'Одна знахідка на весь сайт.',
      scope: GOOGLE_DATA_SCOPE_UK,
    },
  },
  'ANALYTICS-SC-002': {
    countsPages: true,
    en: {
      title: 'Pages on Google’s first page that nobody clicks',
      what: 'According to the Search Console data you connected, Google showed each of these pages at least 50 times, on average within the top 10 results, and nobody clicked it.',
      why: 'Being on the first page and not being chosen usually means the headline and summary in the result do not tell people the page is what they are looking for.',
      fix: 'Rewrite the page’s name and summary for search results so they say plainly what the page offers; most site builders call these fields the SEO title and the SEO description. Also check that the page answers the searches it is shown for.',
      count: 'One finding for each such page.',
      scope: GOOGLE_DATA_SCOPE_EN,
    },
    uk: {
      title: 'Сторінки серед перших результатів Google, на які ніхто не переходить',
      what: 'За даними Search Console, яку ви підключили, Google показав кожну з цих сторінок щонайменше 50 разів, у середньому серед перших 10 результатів, і ніхто на неї не перейшов.',
      why: 'Якщо сторінка серед перших результатів, а її не обирають, це зазвичай означає, що заголовок і опис у результаті не кажуть людям, що це саме те, що вони шукають.',
      fix: 'Перепишіть назву й опис сторінки для пошуку так, щоб вони прямо казали, що пропонує сторінка; у більшості конструкторів сайтів ці поля звуться SEO-заголовок і SEO-опис. Також перевірте, що сторінка відповідає на запити, за якими її показують.',
      count: 'Одна знахідка на кожну таку сторінку.',
      scope: GOOGLE_DATA_SCOPE_UK,
    },
  },
  // Judged only for crawled pages that do not ask to be kept out of search, and
  // only when Search Console's page list came back complete (search-checks.ts).
  'ANALYTICS-SC-004': {
    countsPages: true,
    en: {
      title: 'Pages Google has not shown in search',
      what: 'These pages were read by this scan, are not hidden from search and do not name another address as their main one, yet the Search Console data you connected records not one appearance of them in Google’s results in the last 28 days.',
      why: 'A page Google never shows brings no visitors from search: Google may not have added it to its index yet, or finds other pages a better match.',
      fix: 'Check in Search Console whether Google has indexed the page. If it has, link to it from pages that already get visits from search, and make its name match what people search for. A page published in the last few weeks may simply not have been shown yet.',
      count: 'One finding for each such page.',
      scope: GOOGLE_DATA_SCOPE_EN,
    },
    uk: {
      title: 'Сторінки, яких Google не показував у пошуку',
      what: 'Ці сторінки прочитано під час сканування, вони не приховані від пошуку й не називають іншу адресу своєю головною, але за даними Search Console, яку ви підключили, за останні 28 днів Google жодного разу не показав їх у результатах.',
      why: 'Сторінка, якої Google не показує, не приводить відвідувачів із пошуку: можливо, Google ще не додав її до свого індексу або вважає інші сторінки кращою відповіддю.',
      fix: 'Перевірте в Search Console, чи Google проіндексував сторінку. Якщо так, поставте на неї посилання зі сторінок, які вже мають переходи з пошуку, і узгодьте її назву з тим, що шукають люди. Сторінку, опубліковану кілька тижнів тому, Google міг ще просто не показувати.',
      count: 'Одна знахідка на кожну таку сторінку.',
      scope: GOOGLE_DATA_SCOPE_UK,
    },
  },
  'ANALYTICS-SC-005': {
    countsPages: false,
    en: {
      title: 'Google shows the site, but nobody clicks through',
      what: 'According to the Search Console data you connected, Google showed the site at least 100 times in the last 28 days, and not one person clicked through to it.',
      why: 'This usually means the site appears too far down the results, where people rarely look, so it brings no visitors from search yet.',
      fix: 'In Search Console, look at the searches Google shows the site for, starting with any listed under “Queries close to the top results” in the report’s Analytics section, and make the pages Google already shows for them answer those searches better.',
      count: 'One finding for the whole site.',
      scope: GOOGLE_DATA_SCOPE_EN,
    },
    uk: {
      title: 'Google показує сайт, але ніхто не переходить',
      what: 'За даними Search Console, яку ви підключили, Google показав сайт щонайменше 100 разів за останні 28 днів, і жодна людина на нього не перейшла.',
      why: 'Зазвичай це означає, що сайт зʼявляється надто низько в результатах, куди люди рідко дивляться, тож із пошуку він поки не приводить відвідувачів.',
      fix: 'Перегляньте в Search Console запити, за якими Google показує сайт, почавши з тих, що є в списку «Запити, близькі до топу пошуку» в розділі «Аналітика» звіту, і зробіть так, щоб сторінки, які Google уже показує за ними, краще відповідали на ці запити.',
      count: 'Одна знахідка на весь сайт.',
      scope: GOOGLE_DATA_SCOPE_UK,
    },
  },
};
