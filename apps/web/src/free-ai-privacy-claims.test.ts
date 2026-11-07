import { describe, expect, it } from 'vitest';

import { faqCopyEn, faqCopyUk } from './faq-copy';
import { faqCopyRu } from './faq-copy.ru';

// The FAQ used to say the Free check never sends data to an AI provider. Since
// D-236 it may ask Anthropic one question — but only after the owner ticks the
// box on the scan form. The public answer says exactly that, in every language,
// and the old absolute claim may not come back.

const FAQ = { en: faqCopyEn, uk: faqCopyUk, ru: faqCopyRu } as const;

const OPT_IN_STATEMENT = {
  en: 'The free homepage check sends nothing to an AI provider unless you tick the box on the scan form: then it asks Anthropic (Claude) one closed-book question about your business',
  uk: 'Безкоштовна перевірка головної нічого не надсилає AI-провайдеру, якщо ви не позначите галочку у формі перевірки: тоді вона ставить Anthropic (Claude) одне питання про ваш бізнес',
  ru: 'Проверка главной страницы по тарифу Free ничего не отправляет ИИ-провайдеру, если вы не отметите галочку в форме проверки: тогда она задаёт Anthropic (Claude) один вопрос о вашем бизнесе',
} as const;

const ONLY_ANTHROPIC = {
  en: 'No other AI provider receives anything from a free check.',
  uk: 'Жоден інший AI-провайдер нічого не отримує від безкоштовної перевірки.',
  ru: 'Ни один другой ИИ-провайдер ничего не получает от проверки Free.',
} as const;

const OLD_ABSOLUTE_CLAIM =
  /never sends data to an AI provider|ніколи не надсилає дані AI-провайдеру|никогда не отправляет данные ИИ-провайдеру|(free|безкоштовн|Free)[^.]{0,80}(uses no AI|без ШІ|без ИИ)/i;

describe('what the FAQ says the Free check sends to AI providers', () => {
  it.each(['en', 'uk', 'ru'] as const)('names the tick box and Anthropic only (%s)', (language) => {
    const text = JSON.stringify(FAQ[language]);
    expect(text).toContain(OPT_IN_STATEMENT[language]);
    expect(text).toContain(ONLY_ANTHROPIC[language]);
    expect(text).not.toMatch(OLD_ABSOLUTE_CLAIM);
  });
});
