// Security: what the pages’ server settings leave switched off.

import { ASK_DEVELOPER_SERVER_EN, ASK_DEVELOPER_SERVER_UK, type ExplainedRule } from './types';

export const SECURITY_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  'SEC-ASVS-001': {
    countsPages: true,
    en: {
      title: 'Pages do not limit where they load content from',
      what: 'These pages do not tell the browser which outside sources it may load content from.',
      why: 'Telling the browser which sources it may load content from is an extra safeguard: it lets you say which places scripts and other content may come from.',
      fix: ASK_DEVELOPER_SERVER_EN,
      count: 'One finding for each page where it is not set.',
    },
    uk: {
      title: 'Сторінки не обмежують, звідки завантажувати вміст',
      what: 'Ці сторінки не повідомляють браузеру, з яких сторонніх джерел йому можна завантажувати вміст.',
      why: 'Обмеження джерел вмісту є додатковим запобіжником: воно дає змогу вказати браузеру, звідки можна брати скрипти та інший вміст.',
      fix: ASK_DEVELOPER_SERVER_UK,
      count: 'Одна знахідка на кожну сторінку, де його не задано.',
    },
  },
  'SEC-ASVS-002': {
    countsPages: true,
    en: {
      title: 'Pages do not limit which device features they may use',
      what: 'These pages do not tell the browser which device features, such as the camera, microphone or location, the page and anything embedded in it may ask for.',
      why: 'Telling the browser which device features a page may ask for is an extra safeguard: where it is set, an embedded widget or an added script cannot ask for a feature you did not allow.',
      fix: ASK_DEVELOPER_SERVER_EN,
      count: 'One finding for each page where it is not set.',
    },
    uk: {
      title: 'Сторінки не обмежують, якими можливостями пристрою можна користуватися',
      what: 'Ці сторінки не повідомляють браузеру, які можливості пристрою — камеру, мікрофон, геолокацію — можуть запитувати сторінка та вбудований у неї вміст.',
      why: 'Обмеження можливостей пристрою є додатковим запобіжником: там, де його задано, вбудований віджет чи доданий скрипт не зможе запитати можливість, якої ви не дозволили.',
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
};
