// The words of the Free check's AI preview and consent (D-236), in all interface
// languages. Kept beside the components that read them, the way
// geo-digest-copy.ts and new-scan-copy.ts are, rather than added to i18n.ts.

import type { GeoClaimVerdict } from './api';
import type { FreeGeoHeadline } from './free-geo-claims';
import type { Language } from './i18n';
import type { AiLanguage } from './site-language';

export interface FreePreviewCopy {
  /**
   * A preview section on the plan-scope list: shown here, sold in full in a
   * paid check. Names no plan, so it cannot disagree with the Free report's
   * upgrade buttons, which all lead to Complete (owner decision).
   */
  readonly scopePreview: string;
  readonly consent: {
    readonly eyebrow: string;
    readonly title: string;
    readonly mode: string;
    readonly lead: string;
    readonly body: string;
    readonly checkbox: string;
  };
  readonly preview: {
    readonly heading: string;
    /** What was done, without the question or the model: the brand, when one was saved. */
    readonly answerLead: (brand: string | null) => string;
    /**
     * Added to the lead only when the question was asked in a language other
     * than the one the report is read in: the language's name, never the question.
     */
    readonly askedIn: (asked: AiLanguage) => string;
    /** One plain sentence leading the block: the verdict, before any detail. */
    readonly headline: Readonly<Record<FreeGeoHeadline, string>>;
    /** A claim's state, in the chips and in the count row (the words carry it, not colour). */
    readonly claimStatus: Readonly<Record<GeoClaimVerdict, string>>;
    /** Accessible names of the count row and the claim list. */
    readonly countsLabel: string;
    readonly claimsLabel: string;
    readonly showMoreClaims: (hidden: number) => string;
    readonly showFewerClaims: string;
    /** The one disclosure for quotes, evidence and the scope note, closed by default. */
    readonly showDetails: string;
    readonly detailsAnswerQuote: string;
    readonly detailsComparedWith: string;
    /** An unconfirmed claim that cites nothing: the site said nothing either way. */
    readonly detailsNoEvidence: string;
    /** What the check covers and what "not confirmed" does not mean. */
    readonly detailsScope: string;
    /** The disclosure that holds the model's own words, closed by default. */
    readonly showAnswer: string;
    /** The same disclosure's label when it starts open: nothing to "show". */
    readonly answerHeading: string;
    /** The evaluator-failure note, worded for an answer placed below it. */
    readonly evaluationUnavailable: string;
    readonly answerCitations: string;
    readonly notRunConsent: string;
    readonly notRunAllowlisted: string;
    readonly notRunAlreadyRequested: string;
    readonly notRunOther: string;
    readonly pending: string;
  };
}

export const freePreviewCopy: Readonly<Record<Language, FreePreviewCopy>> = {
  en: {
    scopePreview: 'Preview in this report — the full section is in the paid check',
    consent: {
      eyebrow: 'AI PREVIEW · OPTIONAL',
      title: 'Include one AI answer about your business',
      mode: 'Off by default',
      lead: 'Tick the box to see what one AI assistant (Claude by Anthropic) says about your business. Leave it unticked and nothing is sent to any AI service.',
      body: 'If you tick it, FluxRadar asks Anthropic (Claude) one question that names your business or domain, closed-book, without browsing or tools. Anthropic then checks that answer, in a separate request, against a bounded snapshot of this check: the profile fields you saved and text from your homepage. No other AI provider receives anything. AI can be wrong or omit a mention. Your account, payment details and Google or Bing access are never sent.',
      checkbox: 'Ask Anthropic (Claude) one question about my business',
    },
    preview: {
      heading: 'What AI says about your business',
      answerLead: (brand) =>
        `One answer from one AI assistant, asked without web search what it knows about ${brand ?? 'your business'}. For information only — it does not change your homepage score.`,
      askedIn: (asked) =>
        `It was asked in ${asked === 'uk' ? 'Ukrainian' : asked === 'ru' ? 'Russian' : 'English'}.`,
      headline: {
        mismatch: 'The AI says something about you that does not match your site.',
        confirmed: 'What the AI says about you matches your site.',
        partial: 'Some of what the AI says matches your site; the rest could not be confirmed.',
        unconfirmed: 'Your site neither confirms nor contradicts what the AI says.',
        'nothing-checkable': 'The AI’s answer said nothing about you that could be checked.',
        'not-checked': 'This answer was not checked against your site.',
      },
      claimStatus: {
        contradicted: 'Contradicts',
        matched: 'Confirmed',
        unverified: 'Not confirmed',
      },
      countsLabel: 'Statements by result',
      claimsLabel: 'What the AI said about you',
      showMoreClaims: (hidden) => `Show ${hidden} more`,
      showFewerClaims: 'Show fewer',
      showDetails: 'Show details',
      detailsAnswerQuote: 'From the answer',
      detailsComparedWith: 'Compared with',
      detailsNoEvidence: 'This check found nothing that confirms or contradicts it.',
      detailsScope:
        'Only the statements listed here were checked, and only against what this check read on your site and in your profile. A statement nothing confirms is not necessarily wrong.',
      showAnswer: 'Show the AI’s full answer',
      answerHeading: 'The AI’s answer',
      evaluationUnavailable:
        'The evaluation could not run for this answer, so it stays unverified. The answer is shown below as the model gave it.',
      answerCitations: 'Sources the answer cited',
      notRunConsent:
        'No AI question was asked: you chose not to include the AI answer when you started this check.',
      notRunAllowlisted:
        'No AI question was asked: this site is on the operator’s list for repeated free checks, which never include the AI answer.',
      notRunAlreadyRequested:
        'No AI question was asked on this run: an earlier run of this check already reached the AI step, and the AI answer is never requested twice for one free check.',
      notRunOther:
        'The AI answer could not be produced this time. Your homepage check and score are not affected.',
      pending: 'The AI step is not finished yet. No answer is available in this report yet.',
    },
  },
  uk: {
    scopePreview: 'Превʼю в цьому звіті — повний розділ у платній перевірці',
    consent: {
      eyebrow: 'AI-ПРЕВʼЮ · НЕОБОВʼЯЗКОВО',
      title: 'Додати одну відповідь ШІ про ваш бізнес',
      mode: 'Вимкнено за замовчуванням',
      lead: 'Позначте, щоб побачити, що один ШІ-помічник (Claude від Anthropic) каже про ваш бізнес. Якщо не позначати, жоден ШІ-сервіс нічого не отримає.',
      body: 'Якщо ви позначите, FluxRadar поставить Anthropic (Claude) одне питання, що називає ваш бізнес або домен, у режимі closed-book — без перегляду вебу та інструментів. Потім Anthropic окремим запитом перевірить цю відповідь за обмеженим знімком цієї перевірки: полями профілю, які ви зберегли, і текстом вашої головної сторінки. Жоден інший ШІ-провайдер нічого не отримує. ШІ може помилятися або не згадати вас. Дані акаунта, оплати та доступи Google чи Bing ніколи не надсилаються.',
      checkbox: 'Поставити Anthropic (Claude) одне питання про мій бізнес',
    },
    preview: {
      heading: 'Що ШІ каже про ваш бізнес',
      answerLead: (brand) =>
        `Одна відповідь одного ШІ-помічника, якого без пошуку в інтернеті запитали, що він знає про ${brand === null ? 'ваш бізнес' : `«${brand}»`}. Лише для інформації — на оцінку головної сторінки це не впливає.`,
      askedIn: (asked) =>
        `Запитали ${asked === 'uk' ? 'українською' : asked === 'ru' ? 'російською' : 'англійською'}.`,
      headline: {
        mismatch: 'ШІ каже про вас щось, що не збігається з вашим сайтом.',
        confirmed: 'Те, що ШІ каже про вас, збігається з вашим сайтом.',
        partial: 'Частина сказаного ШІ збігається з вашим сайтом, решту підтвердити не вдалося.',
        unconfirmed: 'Ваш сайт не підтверджує й не спростовує того, що каже ШІ.',
        'nothing-checkable': 'У відповіді ШІ немає нічого про вас, що можна було б перевірити.',
        'not-checked': 'Цю відповідь не звіряли з вашим сайтом.',
      },
      claimStatus: {
        contradicted: 'Суперечить',
        matched: 'Підтверджено',
        unverified: 'Не підтверджено',
      },
      countsLabel: 'Твердження за результатом',
      claimsLabel: 'Що ШІ сказав про вас',
      showMoreClaims: (hidden) => `Показати ще ${hidden}`,
      showFewerClaims: 'Показати менше',
      showDetails: 'Показати подробиці',
      detailsAnswerQuote: 'З відповіді',
      detailsComparedWith: 'Звірено з',
      detailsNoEvidence: 'Ця перевірка не знайшла нічого, що це підтверджує чи спростовує.',
      detailsScope:
        'Перевірено лише перелічені тут твердження і лише за тим, що ця перевірка прочитала на вашому сайті та в профілі. Якщо твердження нічим не підтверджене, це ще не означає, що воно хибне.',
      showAnswer: 'Показати повну відповідь ШІ',
      answerHeading: 'Відповідь ШІ',
      evaluationUnavailable:
        'Оцінку для цієї відповіді виконати не вдалося, тому вона лишається непідтвердженою. Відповідь показано нижче так, як її дала модель.',
      answerCitations: 'Джерела, на які послалася відповідь',
      notRunConsent:
        'Питання ШІ не ставилося: запускаючи перевірку, ви вирішили не додавати відповідь ШІ.',
      notRunAllowlisted:
        'Питання ШІ не ставилося: цей сайт у списку оператора для повторних безкоштовних перевірок, а вони ніколи не містять відповіді ШІ.',
      notRunAlreadyRequested:
        'Цього разу питання ШІ не ставилося: попередній запуск цієї перевірки вже дійшов до кроку ШІ, а для однієї безкоштовної перевірки відповідь ШІ двічі не запитують.',
      notRunOther:
        'Цього разу відповідь ШІ отримати не вдалося. Перевірка головної сторінки й оцінка від цього не змінилися.',
      pending: 'Крок ШІ ще не завершено. Відповіді в цьому звіті поки немає.',
    },
  },
  // Russian chrome and saved AI texts use their own recorded language.
  ru: {
    scopePreview: 'Превью в этом отчёте, полный раздел в платной проверке',
    consent: {
      eyebrow: 'ИИ-ПРЕВЬЮ · НЕОБЯЗАТЕЛЬНО',
      title: 'Добавить один ответ ИИ о вашем бизнесе',
      mode: 'Выключено по умолчанию',
      lead: 'Отметьте, чтобы увидеть, что один ИИ-помощник (Claude от Anthropic) говорит о вашем бизнесе. Если не отмечать, ни один ИИ-сервис ничего не получит.',
      body: 'Если вы отметите, FluxRadar задаст Anthropic (Claude) один вопрос, который называет ваш бизнес или домен, в режиме closed-book, без просмотра веба и инструментов. Затем Anthropic отдельным запросом сверит этот ответ с ограниченным снимком этой проверки: полями профиля, которые вы сохранили, и текстом вашей главной страницы. Ни один другой ИИ-провайдер ничего не получает. ИИ может ошибаться или не упомянуть вас. Данные аккаунта, оплаты и доступы Google или Bing никогда не отправляются.',
      checkbox: 'Задать Anthropic (Claude) один вопрос о моём бизнесе',
    },
    preview: {
      heading: 'Что ИИ говорит о вашем бизнесе',
      answerLead: (brand) =>
        `Один ответ одного ИИ-помощника, которого без поиска в интернете спросили, что он знает о ${brand === null ? 'вашем бизнесе' : `«${brand}»`}. Только для информации: на оценку главной страницы это не влияет.`,
      askedIn: (asked) =>
        `Спрашивали ${asked === 'uk' ? 'по-украински' : asked === 'ru' ? 'по-русски' : 'по-английски'}.`,
      headline: {
        mismatch: 'ИИ говорит о вас что-то, что не совпадает с вашим сайтом.',
        confirmed: 'То, что ИИ говорит о вас, совпадает с вашим сайтом.',
        partial: 'Часть сказанного ИИ совпадает с вашим сайтом, остальное подтвердить не удалось.',
        unconfirmed: 'Ваш сайт не подтверждает и не опровергает то, что говорит ИИ.',
        'nothing-checkable': 'В ответе ИИ нет ничего о вас, что можно было бы проверить.',
        'not-checked': 'Этот ответ не сверяли с вашим сайтом.',
      },
      claimStatus: {
        contradicted: 'Противоречит',
        matched: 'Подтверждено',
        unverified: 'Не подтверждено',
      },
      countsLabel: 'Утверждения по результату',
      claimsLabel: 'Что ИИ сказал о вас',
      showMoreClaims: (hidden) => `Показать ещё ${hidden}`,
      showFewerClaims: 'Показать меньше',
      showDetails: 'Показать подробности',
      detailsAnswerQuote: 'Из ответа',
      detailsComparedWith: 'Сверено с',
      detailsNoEvidence: 'Эта проверка не нашла ничего, что это подтверждает или опровергает.',
      detailsScope:
        'Проверены только перечисленные здесь утверждения и только по тому, что эта проверка прочитала на вашем сайте и в профиле. Если утверждение ничем не подтверждено, это ещё не значит, что оно ложное.',
      showAnswer: 'Показать полный ответ ИИ',
      answerHeading: 'Ответ ИИ',
      evaluationUnavailable:
        'Оценку для этого ответа выполнить не удалось, поэтому он остаётся неподтверждённым. Ответ показан ниже так, как его дала модель.',
      answerCitations: 'Источники, на которые сослался ответ',
      notRunConsent: 'Вопрос ИИ не задавался: запуская проверку, вы решили не добавлять ответ ИИ.',
      notRunAllowlisted:
        'Вопрос ИИ не задавался: этот сайт в списке оператора для повторных проверок Free, а они никогда не включают ответ ИИ.',
      notRunAlreadyRequested:
        'В этот раз вопрос ИИ не задавался: предыдущий запуск этой проверки уже дошёл до шага ИИ, а для одной проверки Free ответ ИИ дважды не запрашивают.',
      notRunOther:
        'В этот раз ответ ИИ получить не удалось. Проверка главной страницы и оценка от этого не изменились.',
      pending: 'Шаг ИИ ещё не завершён. Ответа в этом отчёте пока нет.',
    },
  },
};
