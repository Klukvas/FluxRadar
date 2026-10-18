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
};
