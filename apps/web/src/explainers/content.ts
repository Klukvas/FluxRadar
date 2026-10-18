// Content quality: what there is to read on a page.

import { type ExplainedRule } from './types';

export const CONTENT_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
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
  // Exact copies only (content-001.ts compares the visible text character for
  // character); a page that names another one as its original is not reported.
  'CONTENT-001': {
    countsPages: true,
    en: {
      title: 'Pages with the same text as another page',
      what: 'The visible text of these pages is exactly the same, character for character, as that of at least one other page this scan read, and nothing tells search engines which of them is the original. Pages that are only similar are not compared.',
      why: 'Search engines usually show only one of several identical pages and may pick one you did not want, and a visitor who lands on both finds nothing new.',
      fix: 'Keep one page for this text, and remove the copies or rewrite each around what only it covers. If two addresses really must show the same text, ask your website developer to mark one of them as the original.',
      count:
        'One finding for each page that shares its text, so two identical pages are two findings.',
    },
    uk: {
      title: 'Сторінки з таким самим текстом, як інша сторінка',
      what: 'Видимий текст цих сторінок збігається знак у знак із текстом щонайменше однієї іншої сторінки, прочитаної під час сканування, і ніщо не підказує пошуковим системам, яка з них оригінал. Просто схожі сторінки не порівнюються.',
      why: 'Пошукові системи зазвичай показують лише одну з кількох однакових сторінок і можуть обрати не ту, яку хотіли б ви, а відвідувач, що потрапив на обидві, не знаходить нічого нового.',
      fix: 'Залиште для цього тексту одну сторінку, а копії приберіть або перепишіть кожну про те, що є лише на ній. Якщо дві адреси справді мають показувати той самий текст, попросіть розробника позначити одну з них як оригінал.',
      count:
        'Одна знахідка на кожну сторінку зі спільним текстом, тож дві однакові сторінки — це дві знахідки.',
    },
  },
  // The threshold is written out in words: the owner-facing copy keeps bare
  // status-like numbers out (finding-variants.test.ts), and 200 is one of them.
  'CONTENT-003': {
    countsPages: true,
    en: {
      title: 'Pages with almost nothing to read',
      what: 'The visible text of these pages, menus and footer included, is shorter than two hundred characters, which is about two or three sentences.',
      why: 'A page with so little text tells visitors and search engines almost nothing, and gives search engines little reason to show it.',
      fix: 'Add a few paragraphs about what the page is for, such as the service, its price and how to book. If it is a technical page nobody needs to find in search, ask your website developer to keep it out of search results.',
      count: 'One finding for each page.',
    },
    uk: {
      title: 'Сторінки, на яких майже нічого читати',
      what: 'Видимий текст цих сторінок разом із меню й підвалом коротший за двісті символів, а це приблизно два-три речення.',
      why: 'Сторінка з таким коротким текстом майже нічого не каже ні відвідувачам, ні пошуковим системам, і пошуковим системам мало причин її показувати.',
      fix: 'Додайте кілька абзаців про те, для чого ця сторінка: про послугу, її ціну й те, як записатися. Якщо це службова сторінка, яку не потрібно знаходити в пошуку, попросіть розробника закрити її від пошукових систем.',
      count: 'Одна знахідка на кожну сторінку.',
    },
  },
  // Broken only on proof (content-004.ts): a file the crawl did not ask for is
  // not reported, and `what` says so.
  'CONTENT-004': {
    countsPages: true,
    en: {
      title: 'Pictures or videos that do not load',
      what: 'These pages show images, videos or audio whose file, when FluxRadar asked for it, answered with an error, did not answer at all, or sent back a web page instead of the file. Files the scan did not ask for are not counted as broken.',
      why: 'Visitors see an empty space or a broken-picture icon where a photo of your work or a video should be, which makes the page look neglected.',
      fix: 'Upload the missing picture or video again in your site builder, or remove it from the page. The technical details name each file.',
      count:
        'One finding for each page, however many broken files it has; the technical details list them.',
    },
    uk: {
      title: 'Зображення чи відео, які не завантажуються',
      what: 'На цих сторінках є зображення, відео чи аудіо, файл яких на запит FluxRadar відповів помилкою, не відповів зовсім або повернув вебсторінку замість файлу. Файли, яких сканування не запитувало, битими не вважаються.',
      why: 'Відвідувачі бачать порожнє місце чи значок битого зображення там, де мало бути фото вашої роботи чи відео, і сторінка здається занедбаною.',
      fix: 'Завантажте відсутнє зображення чи відео ще раз у конструкторі сайту або приберіть його зі сторінки. Технічні деталі називають кожен файл.',
      count:
        'Одна знахідка на кожну сторінку, хоч би скільки битих файлів на ній було; технічні деталі їх перелічують.',
    },
  },
};
