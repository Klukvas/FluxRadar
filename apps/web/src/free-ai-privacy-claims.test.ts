import { describe, expect, it } from 'vitest';

import { faqCopyEn, faqCopyUk } from './faq-copy';
import { faqCopyRu } from './faq-copy.ru';

// The FAQ used to say the Free check never sends data to an AI provider. Since
// D-236 it may ask Anthropic one question, and the box for it is ticked by
// default: the public answer says what is sent, that unticking the box sends
// nothing, and that the answer can be added later from the finished report, in
// every language. The old absolute claim may not come back.

const FAQ = { en: faqCopyEn, uk: faqCopyUk, ru: faqCopyRu } as const;

const WHAT_IS_SENT = {
  en: 'The free homepage check asks Anthropic (Claude) one closed-book question about your business',
  uk: 'Безкоштовна перевірка головної ставить Anthropic (Claude) одне питання про ваш бізнес',
  ru: 'Проверка главной страницы по тарифу Free задаёт Anthropic (Claude) один вопрос о вашем бизнесе',
} as const;

const DEFAULT_AND_UNTICK = {
  en: 'The box for it on the scan form is ticked by default: untick it and the free check sends nothing to any AI provider.',
  uk: 'Галочку для цього у формі перевірки поставлено за замовчуванням: якщо її зняти, безкоштовна перевірка нічого не надсилає жодному AI-провайдеру.',
  ru: 'Галочка для этого в форме проверки стоит по умолчанию: если её снять, проверка Free ничего не отправляет ни одному ИИ-провайдеру.',
} as const;

const ADDED_LATER = {
  en: 'you can still add the answer later with a button in the finished report',
  uk: 'відповідь можна додати пізніше кнопкою в готовому звіті',
  ru: 'ответ можно добавить позже кнопкой в готовом отчёте',
} as const;

const ONLY_ANTHROPIC = {
  en: 'No other AI provider receives anything from a free check.',
  uk: 'Жоден інший AI-провайдер нічого не отримує від безкоштовної перевірки.',
  ru: 'Ни один другой ИИ-провайдер ничего не получает от проверки Free.',
} as const;

const OLD_ABSOLUTE_CLAIM =
  /never sends data to an AI provider|ніколи не надсилає дані AI-провайдеру|никогда не отправляет данные ИИ-провайдеру|(free|безкоштовн|Free)[^.]{0,80}(uses no AI|без ШІ|без ИИ)/i;

describe('what the FAQ says the Free check sends to AI providers', () => {
  it.each(['en', 'uk', 'ru'] as const)(
    'names the default box and Anthropic only (%s)',
    (language) => {
      const text = JSON.stringify(FAQ[language]);
      expect(text).toContain(WHAT_IS_SENT[language]);
      expect(text).toContain(DEFAULT_AND_UNTICK[language]);
      expect(text).toContain(ADDED_LATER[language]);
      expect(text).toContain(ONLY_ANTHROPIC[language]);
      expect(text).not.toMatch(OLD_ABSOLUTE_CLAIM);
    },
  );
});
