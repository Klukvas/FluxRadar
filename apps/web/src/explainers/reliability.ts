// Reliability: whether the site's addresses answer, and how fast. The two API
// rules judge the address checks the owner listed when starting the scan, not
// the crawled pages, so they carry their own scope sentence.

import type { ExplainedRule } from './types';

const ADDRESS_CHECK_SCOPE_EN =
  'FluxRadar sent read-only requests, with no sign-in details, to the addresses you listed for checking. These findings describe the answers at the time of the scan; nothing was logged into and nothing on the site was changed.';
const ADDRESS_CHECK_SCOPE_UK =
  'FluxRadar надіслав запити лише на читання, без даних для входу, на адреси, які ви вказали для перевірки. Знахідки описують відповіді на момент перевірки; жодного входу в акаунт не виконувалося, і нічого на сайті не змінювалося.';

export const RELIABILITY_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  // rel-api-003.ts: the status the owner listed for the check, or any
  // successful one when none was listed.
  'REL-API-003': {
    countsPages: false,
    en: {
      title: 'An address you asked to check answered unexpectedly',
      what: 'One of the addresses you listed for checking when you started the scan answered with a different status than the one you expected. Where you named no status, any successful answer was expected.',
      why: 'These are addresses you chose to watch, such as the service behind online booking, so an unexpected answer may mean that the part of the site relying on them is not working.',
      fix: 'Pass the address and the answer from the technical details on to your website developer. If the new answer is intended, change the expected status for this address in the scan settings.',
      count: 'One finding for each listed check that answered unexpectedly.',
      scope: ADDRESS_CHECK_SCOPE_EN,
    },
    uk: {
      title: 'Адреса, яку ви просили перевірити, відповіла неочікувано',
      what: 'Одна з адрес, які ви вказали для перевірки під час запуску сканування, відповіла іншим статусом, ніж ви очікували. Якщо статус не було вказано, очікувалася будь-яка успішна відповідь.',
      why: 'Це адреси, за якими ви вирішили стежити, як-от сервіс, на якому тримається онлайн-запис, тож неочікувана відповідь може означати, що частина сайту, яка на них покладається, не працює.',
      fix: 'Передайте розробнику адресу й відповідь із технічних деталей. Якщо нова відповідь задумана, змініть очікуваний статус цієї адреси в налаштуваннях сканування.',
      count: 'Одна знахідка на кожну вказану перевірку, що відповіла неочікувано.',
      scope: ADDRESS_CHECK_SCOPE_UK,
    },
  },
  // rel-api-005.ts reads the check's settings before it is sent; the evidence
  // names the kind of detail only, never its value.
  'REL-API-005': {
    countsPages: false,
    en: {
      title: 'A check you added carries sign-in details',
      what: 'The settings of one of the address checks for this scan include sign-in details, such as a password, a key or a token, in its request. FluxRadar checks only public addresses that need no sign-in, so such a check is blocked; the technical details say if it went out anyway, and name only the kind of detail, never its value.',
      why: 'Sign-in details do not belong in a scan’s settings: they give more access than a public check needs, and an address that only opens after signing in is not one a public check can judge.',
      fix: 'Remove the sign-in details from this check, or remove the check if the address only works after signing in. If those details are real, ask whoever manages that service whether they should be changed.',
      count: 'One finding for each check that carries such details.',
      scope:
        'This finding comes from the settings of the address checks added to this scan, not from the site’s pages. FluxRadar does not send sign-in details on purpose; the technical details say whether this request went out.',
    },
    uk: {
      title: 'Перевірка, яку ви додали, містить дані для входу',
      what: 'Налаштування однієї з перевірок адрес цього сканування містять у запиті дані для входу, як-от пароль, ключ чи токен. FluxRadar перевіряє лише публічні адреси, яким не потрібен вхід, тож таку перевірку заблоковано; технічні деталі кажуть, якщо її все ж надіслано, і називають лише вид даних, а не їхнє значення.',
      why: 'Даним для входу не місце в налаштуваннях сканування: вони дають більше доступу, ніж потрібно публічній перевірці, а адресу, що відкривається лише після входу, публічна перевірка оцінити не може.',
      fix: 'Приберіть дані для входу з цієї перевірки або саму перевірку, якщо адреса працює лише після входу. Якщо ці дані справжні, запитайте в того, хто керує цим сервісом, чи не варто їх змінити.',
      count: 'Одна знахідка на кожну перевірку з такими даними.',
      scope:
        'Ця знахідка ґрунтується на налаштуваннях перевірок адрес, доданих до цього сканування, а не на сторінках сайту. FluxRadar свідомо не надсилає даних для входу; технічні деталі кажуть, чи цей запит було надіслано.',
    },
  },
  'REL-URL-001': {
    countsPages: true,
    en: {
      title: 'Pages that could not be opened at all',
      what: 'When FluxRadar tried to open these addresses, no answer came back: the address could not be found, the connection failed or ran out of time, or the address kept forwarding without end. The technical details give the exact reason.',
      why: 'If FluxRadar could not open a page, some visitors and search engines may not be able to either, and they see a browser error instead of your site.',
      fix: 'Open the address yourself, from a phone as well. If it does not open, pass the reason from the technical details to your website developer or hosting provider; if it does, it may have been a short outage, so check it again with the next scan.',
      count: 'One finding for each address that could not be opened.',
    },
    uk: {
      title: 'Сторінки, які не вдалося відкрити взагалі',
      what: 'Коли FluxRadar намагався відкрити ці адреси, відповіді не надійшло: адресу не знайдено, зʼєднання обірвалося чи не вклалося в час очікування, або адреса без кінця перенаправляла далі. Точну причину наведено в технічних деталях.',
      why: 'Якщо FluxRadar не зміг відкрити сторінку, частина відвідувачів і пошукових систем теж може не змогти, і замість вашого сайту вони побачать помилку браузера.',
      fix: 'Відкрийте адресу самі, зокрема з телефона. Якщо вона не відкривається, передайте причину з технічних деталей розробнику чи хостинг-провайдеру; якщо відкривається, можливо, це був короткий збій, тож перевірте її під час наступного сканування.',
      count: 'Одна знахідка на кожну адресу, яку не вдалося відкрити.',
    },
  },
  'REL-URL-003': {
    countsPages: true,
    en: {
      title: 'Pages where the server fails',
      what: 'When FluxRadar opened these addresses, the server answered that it had failed (a server error) instead of sending the page.',
      why: 'A server error means the site itself is not working at that address: visitors see an error page, and if it lasts, search engines may stop showing the page.',
      fix: 'Pass the addresses to your website developer or hosting provider: a server error is fixed on the server, not in the page text. If the page opens fine now, it may have been a short outage; check it with the next scan.',
      count: 'One finding for each address that answered with a server error.',
    },
    uk: {
      title: 'Сторінки, на яких сервер дає збій',
      what: 'Коли FluxRadar відкривав ці адреси, сервер замість сторінки відповів, що стався збій (помилка сервера).',
      why: 'Помилка сервера означає, що сам сайт за цією адресою не працює: відвідувачі бачать сторінку помилки, а якщо це триває, пошукові системи можуть перестати показувати сторінку.',
      fix: 'Передайте адреси розробнику чи хостинг-провайдеру: помилку сервера виправляють на сервері, а не в тексті сторінки. Якщо зараз сторінка відкривається, можливо, це був короткий збій; перевірте її під час наступного сканування.',
      count: 'Одна знахідка на кожну адресу, що відповіла помилкою сервера.',
    },
  },
  // safe-fetch times the whole answer, redirects and the full page included,
  // from FluxRadar's server; pictures and other files are not part of it.
  'REL-URL-009': {
    countsPages: true,
    en: {
      title: 'Pages the server is slow to send',
      what: 'The server took longer than 1.8 seconds to send these pages, counted from FluxRadar’s request until the whole page had arrived, not counting pictures and other files. The time was measured from FluxRadar’s server, so a visitor nearer to or farther from your server may get a different time.',
      why: 'Visitors look at a blank screen while the server answers, and on a phone some of them leave before the page appears.',
      fix: 'Ask your website developer or hosting provider to speed up the server’s answer, for example with caching.',
      count: 'One finding for each slow page.',
    },
    uk: {
      title: 'Сторінки, які сервер повільно надсилає',
      what: 'Серверу знадобилося понад 1,8 секунди, щоб надіслати ці сторінки, від запиту FluxRadar до отримання всієї сторінки, без зображень та інших файлів. Час виміряно із сервера FluxRadar, тож відвідувач, який ближче до вашого сервера чи далі від нього, може отримати інший час.',
      why: 'Поки сервер відповідає, відвідувачі дивляться на порожній екран, і з телефона дехто йде, не дочекавшись сторінки.',
      fix: 'Попросіть розробника чи хостинг-провайдера пришвидшити відповідь сервера, наприклад за допомогою кешування.',
      count: 'Одна знахідка на кожну повільну сторінку.',
    },
  },
};
