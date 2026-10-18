// UX/Conversion: what may stand between a visitor and contacting you.

import { AI_REVIEW_COUNT_EN, AI_REVIEW_COUNT_UK, type ExplainedRule } from './types';

export const UX_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  'UX-CONV-AI-001': {
    countsPages: false,
    isAiReview: true,
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
    isAiReview: true,
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
    isAiReview: true,
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
  // The two start-page checks look at the first page the crawl read only
  // (ux/analyzer.ts, entryPageFindings); they are deterministic, not AI.
  'UX-CONV-STATIC-001': {
    countsPages: true,
    en: {
      title: 'The start page has no main heading',
      what: 'The page this scan started at, usually your home page, has no main heading. Only that page is checked.',
      why: 'The main heading is often the first thing a new visitor reads to see whether they are in the right place, and search engines use it to understand what the page is about.',
      fix: 'Add one short main heading at the top of the page that says what you offer and where, such as “Dental clinic in Lviv”. In most site builders this is a text block set to the largest heading style.',
      count: 'One finding, about the start page only.',
    },
    uk: {
      title: 'Стартова сторінка без головного заголовка',
      what: 'Сторінка, з якої почалося сканування (зазвичай головна), не має головного заголовка. Перевіряється лише вона.',
      why: 'Головний заголовок часто є першим, що читає новий відвідувач, щоб зрозуміти, чи він там, де треба, а пошукові системи за ним розуміють, про що сторінка.',
      fix: 'Додайте вгорі сторінки один короткий головний заголовок, що каже, що ви пропонуєте й де, наприклад «Стоматологія у Львові». У більшості конструкторів сайтів це текстовий блок зі стилем найбільшого заголовка.',
      count: 'Одна знахідка лише про стартову сторінку.',
    },
  },
  'UX-CONV-STATIC-002': {
    countsPages: true,
    en: {
      title: 'The start page has nothing to press',
      what: 'The page this scan started at, usually your home page, has not a single link, button or form button, as FluxRadar read it. Only that page is checked.',
      why: 'A visitor who is ready to book, call or write needs something to press; a page with nothing to press leaves them to find their own way.',
      fix: 'Add a clear button near the top of the page for the one thing you want visitors to do, such as “Book a visit” or “Call us”, leading to your booking page, form or phone number.',
      count: 'One finding, about the start page only.',
    },
    uk: {
      title: 'На стартовій сторінці нічого натиснути',
      what: 'Сторінка, з якої почалося сканування (зазвичай головна), у тому вигляді, в якому її прочитав FluxRadar, не має жодного посилання, кнопки чи кнопки форми. Перевіряється лише вона.',
      why: 'Відвідувачу, готовому записатися, подзвонити чи написати, потрібно щось натиснути; сторінка, на якій нічого натиснути, змушує його самостійно шукати, що робити далі.',
      fix: 'Додайте вгорі сторінки помітну кнопку для тієї однієї дії, якої ви чекаєте від відвідувачів, як-от «Записатися» чи «Зателефонувати», що веде на сторінку запису, форму чи ваш номер.',
      count: 'Одна знахідка лише про стартову сторінку.',
    },
  },
  // ux/analyzer.ts counts only a button marked as the form's send button, so a
  // button that merely looks like one is flagged too; the fix says to check
  // the form works before asking for the mark.
  'UX-CONV-STATIC-003': {
    countsPages: false,
    en: {
      title: 'Forms without a clear send button',
      what: 'A form on these pages has fields to fill in but no button marked as the one that sends it. Up to 12 pages are checked: the start page and the pages with the most forms, contact links and buttons.',
      why: 'Without a proper send button a visitor may not find how to send the form, or it may not send when they press Enter, and the enquiry is lost. A button that looks right can still lack the mark that tells the browser it sends the form.',
      fix: 'Check that each form named in the technical details has a clear button, such as “Send” or “Book”, and that a test message arrives. If it does, ask your website developer to mark that button as the form’s send button.',
      count: 'One finding for each such form, so a page can appear more than once.',
    },
    uk: {
      title: 'Форми без чіткої кнопки надсилання',
      what: 'Форма на цих сторінках має поля для заповнення, але не має кнопки, позначеної як та, що її надсилає. Перевіряється до 12 сторінок: стартова й ті, де найбільше форм, контактних посилань і кнопок.',
      why: 'Без справжньої кнопки надсилання відвідувач може не знайти, як надіслати форму, або вона не надішлеться натисканням Enter, і звернення загубиться. Кнопка, що виглядає правильно, теж може не мати позначки, яка каже браузеру, що вона надсилає форму.',
      fix: 'Перевірте, що кожна форма з технічних деталей має чітку кнопку, як-от «Надіслати» чи «Записатися», і що тестове повідомлення доходить. Якщо доходить, попросіть розробника позначити цю кнопку як кнопку надсилання форми.',
      count: 'Одна знахідка на кожну таку форму, тож сторінка може зʼявитися кілька разів.',
    },
  },
};
