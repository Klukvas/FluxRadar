// Accessibility: what makes a page harder to use with a screen reader or a keyboard.

import { type ExplainedRule } from './types';

export const ACCESSIBILITY_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  'A11Y-012': {
    countsPages: true,
    en: {
      title: 'Visitors cannot enlarge the page enough',
      what: 'The page limits how much a visitor can enlarge it.',
      why: 'People with low vision may be unable to make the text readable.',
      fix: 'Ask your developer to allow visitors to enlarge the page at least twofold.',
      count: 'One finding for each affected page.',
    },
    uk: {
      title: 'Відвідувачі не можуть достатньо збільшити сторінку',
      what: 'Сторінка обмежує збільшення її вмісту відвідувачем.',
      why: 'Людям зі слабким зором може бути важко зробити текст читабельним.',
      fix: 'Попросіть розробника дозволити збільшення сторінки щонайменше вдвічі.',
      count: 'Одна знахідка на кожну сторінку з проблемою.',
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
  // Only colours written on the element itself can be judged without a browser
  // laying out the page (a11y-001.ts); the copy says so, so a page whose pale
  // text comes from the theme is not read as having passed.
  'A11Y-001': {
    countsPages: true,
    en: {
      title: 'Text that is hard to read against its background',
      what: 'On these pages an element sets its own text and background colours, and the two are too close: the contrast is below 4.5 to 1, or below 3 to 1 for large text. Only colours written directly on the element are checked; colours that come from the site’s design files are not.',
      why: 'Pale text on a pale background, or dark text on a dark one, is hard to read for many visitors, especially people with weaker eyesight or anyone reading a phone in sunlight.',
      fix: 'Make the text darker or the background lighter (or the other way round) for the element named in the technical details. In most site builders this is the colour setting of the text or of the block behind it.',
      count: 'One finding for each page; the technical details name the first such element on it.',
    },
    uk: {
      title: 'Текст, який погано видно на фоні',
      what: 'На цих сторінках елемент сам задає колір тексту й фону, і вони надто близькі: контраст нижчий за 4,5 до 1, а для великого тексту нижчий за 3 до 1. Перевіряються лише кольори, записані безпосередньо на елементі; кольори з файлів оформлення сайту не перевіряються.',
      why: 'Блідий текст на блідому фоні чи темний на темному важко читати багатьом відвідувачам, особливо людям зі слабшим зором або тим, хто читає з телефона на сонці.',
      fix: 'Зробіть текст темнішим або фон світлішим (чи навпаки) для елемента, названого в технічних деталях. У більшості конструкторів сайтів це налаштування кольору тексту або блоку позаду нього.',
      count:
        'Одна знахідка на кожну сторінку; технічні деталі називають перший такий елемент на ній.',
    },
  },
  // The same pictures as SEO-ONPAGE-005 (a11y-002.ts flags an <img> with no alt
  // at all and accepts an empty one), told from the screen reader's side.
  'A11Y-002': {
    countsPages: true,
    en: {
      title: 'Pictures a screen reader cannot describe',
      what: 'These pages carry pictures (photographs, logos and icons alike) with no written description at all, not even an empty one.',
      why: 'A screen reader announces such a picture as just “image”, so a visitor who cannot see it does not know what it shows or whether it matters.',
      fix: 'Add a short description to each picture that carries meaning, and mark a picture that is only decoration as having nothing to describe (an empty description). Most site builders have a field for it beside the picture, often called the alt text.',
      count:
        'One finding for each page that has such pictures, however many of them it has; the technical details count them.',
    },
    uk: {
      title: 'Зображення, які програма читання з екрана не може описати',
      what: 'На цих сторінках є зображення (і фотографії, і логотипи, і значки), у яких текстового опису немає взагалі, навіть порожнього.',
      why: 'Програма читання з екрана оголошує таке зображення просто як «зображення», тож відвідувач, який його не бачить, не знає, що на ньому і чи воно важливе.',
      fix: 'Додайте короткий опис до кожного змістовного зображення, а зображення, яке є лише оздобою, позначте як таке, що описувати нічого (порожній опис). У більшості конструкторів сайтів для цього є поле біля зображення, часто воно зветься alt-текст.',
      count:
        'Одна знахідка на кожну сторінку з такими зображеннями, хоч би скільки їх на ній було; технічні деталі їх рахують.',
    },
  },
  'A11Y-004': {
    countsPages: false,
    en: {
      title: 'Form fields without a name',
      what: 'Fields in the forms on these pages, such as a text box, a drop-down list or a comment box, have no label tied to them that says what to enter. A hint written inside the box does not count. Buttons are not checked.',
      why: 'A screen reader reads such a field out as an empty box, so its user cannot tell whether it wants a name, a phone number or a date, and may give up on the form.',
      fix: 'Give every field a visible label, such as “Your phone”. In most site builders this is the field’s label setting; if the form comes from a plugin or the template, ask your website developer to tie the labels to the fields.',
      count:
        'One finding for each unlabelled field on each page, so a page with a form can appear several times (fields that cannot be told apart are counted once).',
    },
    uk: {
      title: 'Поля форм без назви',
      what: 'Поля у формах цих сторінок, як-от текстове поле, випадний список чи поле для коментаря, не мають повʼязаного з ними підпису, який каже, що вводити. Підказка, написана всередині поля, не рахується. Кнопки не перевіряються.',
      why: 'Програма читання з екрана озвучує таке поле як порожнє, тож її користувач не знає, чого від нього чекають — імені, телефону чи дати — і може покинути форму.',
      fix: 'Дайте кожному полю видимий підпис, наприклад «Ваш телефон». У більшості конструкторів сайтів це налаштування підпису поля; якщо форма з плагіна чи шаблону, попросіть розробника повʼязати підписи з полями.',
      count:
        'Одна знахідка на кожне поле без підпису на кожній сторінці, тож сторінка з формою може зʼявитися кілька разів (поля, які не можна розрізнити, рахуються один раз).',
    },
  },
  'A11Y-005': {
    countsPages: true,
    en: {
      title: 'Parts of the page that do not work from the keyboard',
      what: 'On these pages either an element changes the order in which the Tab key moves through the page, or a plain block of the page, not a real button or link, reacts to a mouse click but gives the keyboard no way to use it.',
      why: 'People who cannot use a mouse move through a page with the keyboard. For them such a block may do nothing, and a changed Tab order makes the cursor jump around unexpectedly.',
      fix: 'Ask your website developer to turn the block named in the technical details into a real button or link, and to leave the Tab order the way the page reads.',
      count: 'One finding for each page; the technical details name the first such element on it.',
    },
    uk: {
      title: 'Частини сторінки, якими не скористатися з клавіатури',
      what: 'На цих сторінках або якийсь елемент змінює порядок, у якому клавіша Tab переходить сторінкою, або звичайний блок сторінки, не справжня кнопка чи посилання, реагує на клацання мишею, але з клавіатури ним скористатися неможливо.',
      why: 'Люди, які не можуть користуватися мишею, переходять сторінкою з клавіатури. Для них такий блок може нічого не робити, а змінений порядок переходу клавішею Tab змушує курсор несподівано перескакувати.',
      fix: 'Попросіть розробника перетворити блок, названий у технічних деталях, на справжню кнопку чи посилання й лишити порядок переходу клавішею Tab таким, як читається сторінка.',
      count:
        'Одна знахідка на кожну сторінку; технічні деталі називають перший такий елемент на ній.',
    },
  },
  // a11y-006.ts reads inline styles and <style> blocks only, so a theme file that
  // hides the outline goes unseen; `what` says which styles were read.
  'A11Y-006': {
    countsPages: true,
    en: {
      title: 'The keyboard cursor is hidden',
      what: 'The design of these pages switches off the outline a browser draws around the button or link the keyboard is on, and no other highlight was found in its place. Only the styles written in the page itself are checked, not the site’s separate design files.',
      why: 'Someone moving through the page with the Tab key cannot see where they are, so they cannot tell which link or button pressing Enter will open.',
      fix: 'Ask your website developer to bring back a visible highlight, in a colour that stands out, for the item the keyboard is on.',
      count: 'One finding for each page.',
    },
    uk: {
      title: 'Курсор клавіатури приховано',
      what: 'Оформлення цих сторінок вимикає рамку, яку браузер малює навколо кнопки чи посилання, на якому стоїть курсор клавіатури, а іншого виділення замість неї не знайдено. Перевіряються лише стилі, записані в самій сторінці, а не окремі файли оформлення сайту.',
      why: 'Людина, яка переходить сторінкою клавішею Tab, не бачить, де вона, тож не знає, яке посилання чи кнопку відкриє натискання Enter.',
      fix: 'Попросіть розробника повернути помітне виділення контрастного кольору для елемента, на якому стоїть курсор клавіатури.',
      count: 'Одна знахідка на кожну сторінку.',
    },
  },
  'A11Y-008': {
    countsPages: true,
    en: {
      title: 'Buttons or links with nothing to read out',
      what: 'On these pages a button or a link has no text, label or description a screen reader can announce, for example a button that is only an icon, or a link with no address to lead to, which the keyboard cannot reach.',
      why: 'A screen reader announces such an element as just “button” or “link”, so its user cannot tell whether it opens the menu, calls you or sends the form.',
      fix: 'Ask your website developer to give the element named in the technical details a name, such as “Open menu” or “Call us”, and to give every link an address. It is often an icon in a shared part of the site, such as the header, repeated on every page.',
      count: 'One finding for each page; the technical details name the first such element on it.',
    },
    uk: {
      title: 'Кнопки чи посилання, про які нічого озвучити',
      what: 'На цих сторінках кнопка чи посилання не має тексту, підпису чи опису, які могла б озвучити програма читання з екрана, як-от кнопка, що є лише значком, або посилання без адреси, до якого не дістатися з клавіатури.',
      why: 'Програма читання з екрана оголошує такий елемент просто як «кнопка» чи «посилання», тож її користувач не знає, чи відкриє він меню, набере ваш номер чи надішле форму.',
      fix: 'Попросіть розробника дати елементу, названому в технічних деталях, назву, наприклад «Відкрити меню» чи «Зателефонувати», а кожному посиланню — адресу. Часто це значок у спільній частині сайту, як-от шапці, що повторюється на кожній сторінці.',
      count:
        'Одна знахідка на кожну сторінку; технічні деталі називають перший такий елемент на ній.',
    },
  },
  // a11y-009.ts judges the error state the page already carries, not what the
  // form does after someone types (that needs a browser), and `what` says so.
  'A11Y-009': {
    countsPages: true,
    en: {
      title: 'Form errors that are not read out',
      what: 'A field on these pages is marked as filled in wrongly, but is not tied to any message saying what is wrong. Only what the page carries when it is opened is checked, not what the form does once someone types into it.',
      why: 'A visitor using a screen reader learns that the field has an error but not what to correct, and may not manage to send the form.',
      fix: 'Ask your website developer to tie each error message to its field, so that it is read out together with the field.',
      count: 'One finding for each page; the technical details name the first such field.',
    },
    uk: {
      title: 'Помилки у формах, які не озвучуються',
      what: 'Поле на цих сторінках позначене як заповнене неправильно, але не повʼязане з жодним повідомленням про те, що саме не так. Перевіряється лише те, що містить сторінка одразу після відкриття, а не те, що робить форма, коли в неї вже щось ввели.',
      why: 'Відвідувач із програмою читання з екрана дізнається, що в полі помилка, але не те, що треба виправити, і може так і не надіслати форму.',
      fix: 'Попросіть розробника повʼязати кожне повідомлення про помилку з його полем, щоб воно озвучувалося разом із полем.',
      count: 'Одна знахідка на кожну сторінку; технічні деталі називають перше таке поле.',
    },
  },
  // One finding per page, naming the first gap in a11y-010.ts's order: the main
  // region, then an untitled frame, a video without captions, an unnamed menu.
  'A11Y-010': {
    countsPages: true,
    en: {
      title: 'The page is hard to find one’s way around with a screen reader',
      what: 'These pages have one of these gaps: the main part of the page is not marked, or more than one part is marked as the main one; an embedded window, such as a map or a video player, has no name; a video has no captions; or one of several menus has no name. They are checked in that order, and the first gap found is reported.',
      why: 'Screen-reader users jump straight to the main content or between menus, and hear what an embedded window is; without these marks they have to listen through the whole page. A video with no captions says nothing to visitors who cannot hear it.',
      fix: 'Ask your website developer to fix the gap named in the technical details. It is often in a shared part of the site, such as the template, and then one fix covers every page.',
      count: 'One finding for each page, naming the first gap found on it.',
    },
    uk: {
      title: 'На сторінці важко орієнтуватися з програмою читання з екрана',
      what: 'На цих сторінках є одна з таких прогалин: головну частину сторінки не позначено або головними позначено кілька частин; вбудоване вікно, як-от карта чи відеоплеєр, не має назви; відео не має субтитрів; або одне з кількох меню не має назви. Вони перевіряються в цьому порядку, і звіт називає першу знайдену прогалину.',
      why: 'Користувачі програм читання з екрана переходять одразу до головного вмісту чи між меню й чують, що за вбудоване вікно перед ними; без цих позначок їм доводиться слухати всю сторінку. Відео без субтитрів нічого не каже відвідувачам, які його не чують.',
      fix: 'Попросіть розробника виправити прогалину, названу в технічних деталях. Часто вона в спільній частині сайту, як-от шаблоні, і тоді одне виправлення охоплює всі сторінки.',
      count: 'Одна знахідка на кожну сторінку; вона називає першу знайдену на ній прогалину.',
    },
  },
};
