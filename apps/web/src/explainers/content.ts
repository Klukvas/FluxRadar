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
};
