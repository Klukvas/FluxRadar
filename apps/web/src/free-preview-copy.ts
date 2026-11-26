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
    readonly mode: string;
    /** One sentence beside the box. The rest of the disclosure is in the terms. */
    readonly note: string;
    /** The full disclosure, shown beside "Add the AI answer" on a finished report. */
    readonly body: string;
    readonly checkbox: string;
  };
  /**
   * A finished Free report whose AI answer was left out at launch: the same
   * disclosure as the launch form (`consent.body`), shown open beside a button
   * whose click is the consent.
   */
  readonly addAnswer: {
    readonly lead: string;
    readonly button: string;
    /** The button while the request is on its way. */
    readonly sending: string;
    /** The block while the one question and its check run. */
    readonly running: string;
    /** The request did not arrive or was rate-limited: pressing again can work. */
    readonly retryShortly: string;
    /** The request was refused for good: no button is offered any more. */
    readonly refused: string;
    /** The run outlasted the report's patience: it stops asking and says so. */
    readonly slow: string;
    /** The last attempt never started: the homepage could not be read then. */
    readonly lastAttemptSiteUnread: string;
    /** The last attempt never started: a fault on FluxRadar's side. */
    readonly lastAttemptPlatform: string;
    /** The last attempt never started: robots.txt keeps the homepage closed. */
    readonly lastAttemptRobots: string;
    /** Several attempts never started: no further press is accepted. */
    readonly attemptsExhausted: string;
    /** Added to the last-attempt note when the next press is the last one accepted. */
    readonly oneAttemptLeft: string;
    /** The same, when robots.txt keeps the homepage closed: fix that first. */
    readonly oneAttemptLeftRobots: string;
  };
  /**
   * The question a running Free check asks when it was started without its AI
   * box — from the address on the public page, which shows no scan form. The
   * disclosure beside its button is `consent.body`, the same text as everywhere.
   */
  readonly ask: {
    readonly heading: string;
    /** One question, one model — and what a paid check asks instead. */
    readonly oneModel: string;
    readonly yes: string;
    readonly no: string;
    /**
     * Agreed while the check is still running: it is sent when the check ends,
     * by this screen — so it says the screen has to stay open.
     */
    readonly queued: string;
    /** The request is on its way. */
    readonly sending: string;
    /** The request was accepted: the report shows the answer when it lands. */
    readonly requested: string;
    /** The request did not go through: the report says whether it can still be added. */
    readonly failed: string;
    /** The owner said no: nothing is sent, and the report may still offer it. */
    readonly declined: string;
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
    /**
     * Under an answer that did not describe the business: what one answer does
     * and does not show, and what the paid AI/GEO section adds to it.
     */
    readonly notDescribedNext: string;
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
      mode: 'On by default',
      note: 'Untick it and nothing is sent. Details:',
      body: 'FluxRadar asks Anthropic (Claude) one question that names your business or domain, closed-book, without browsing or tools. Anthropic then checks that answer, in a separate request, against a bounded snapshot of this check: the profile fields you saved and text from your homepage. No other AI provider receives anything. AI can be wrong or omit a mention. Your account, payment details and Google or Bing access are never sent.',
      checkbox: 'Ask Anthropic (Claude) one question about my business',
    },
    addAnswer: {
      lead: 'You can still add the one AI answer to this report. Nothing is sent until you press the button. FluxRadar then reads your homepage again to check the answer.',
      button: 'Add the AI answer',
      sending: 'Adding the AI answer…',
      running:
        'FluxRadar is asking the AI now. The answer appears here in about a minute, and your homepage check and score stay as they are.',
      retryShortly: 'The AI answer could not be requested just now. Try again in a minute.',
      refused:
        'This check can no longer add its AI answer. Reload the report to see its current state.',
      slow: 'The AI answer is taking longer than usual. Reload the report in a few minutes to see it.',
      lastAttemptSiteUnread:
        'The last attempt did not start: FluxRadar could not read your homepage at that moment, so nothing was sent to any AI service. You can press the button again.',
      lastAttemptPlatform:
        'The last attempt did not start because of a problem on FluxRadar’s side, so nothing was sent to any AI service. You can press the button again.',
      lastAttemptRobots:
        'The last attempt did not start: your site’s robots.txt does not allow FluxRadar to read the homepage, so nothing was sent to any AI service. The button will work once robots.txt allows it.',
      attemptsExhausted:
        'The AI answer could not be added: several attempts could not start, because your homepage could not be read or FluxRadar had a problem on its side. Nothing was sent to any AI service, and the answer is not tried again for this check.',
      oneAttemptLeft: 'One attempt is left for this check.',
      oneAttemptLeftRobots:
        'One attempt is left for this check, so fix robots.txt before you press the button.',
    },
    ask: {
      heading: 'Ask an AI what it knows about your business?',
      oneModel:
        'The free check asks one model, Claude, one question. A paid audit asks two models — Claude and ChatGPT — more questions about your brand and your market.',
      yes: 'Yes, ask Claude',
      no: 'No, thanks',
      queued:
        'Got it. We send the question as soon as the homepage check finishes — keep this page open until then.',
      sending: 'Sending the question…',
      requested: 'The question has been sent. The answer appears in your report in about a minute.',
      failed:
        'The question could not be sent just now. Your report shows whether the AI answer can still be added.',
      declined:
        'No question will be sent. If you change your mind, the report may still let you add the AI answer.',
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
        'not-described': 'The AI could not describe your business.',
        'nothing-checkable': 'The AI’s answer said nothing about you that could be checked.',
        'not-checked': 'This answer was not checked against your site.',
      },
      notDescribedNext:
        'This is one answer from one AI assistant. Basic asks Claude and ChatGPT more questions — direct questions about your brand, answered from what they already know, and questions about your market, answered with their own web search — shows whether the answers mention you and which sources they rely on, and lets you request an AI Action Plan.',
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
        'The AI answer could not be produced for this check. Your homepage check and score are not affected.',
      pending: 'The AI step is not finished yet. No answer is available in this report yet.',
    },
  },
  uk: {
    scopePreview: 'Превʼю в цьому звіті — повний розділ у платній перевірці',
    consent: {
      mode: 'Увімкнено за замовчуванням',
      note: 'Зніміть галочку — і нічого не надішлеться. Подробиці:',
      body: 'FluxRadar ставить Anthropic (Claude) одне питання, що називає ваш бізнес або домен, у режимі closed-book, без перегляду вебу та інструментів. Потім Anthropic окремим запитом перевірить цю відповідь за обмеженим знімком цієї перевірки: полями профілю, які ви зберегли, і текстом вашої головної сторінки. Жоден інший ШІ-провайдер нічого не отримує. ШІ може помилятися або не згадати вас. Дані акаунта, оплати та доступи Google чи Bing ніколи не надсилаються.',
      checkbox: 'Поставити Anthropic (Claude) одне питання про мій бізнес',
    },
    addAnswer: {
      lead: 'Ви ще можете додати до цього звіту одну відповідь ШІ. Нічого не надсилається, доки ви не натиснете кнопку. Тоді FluxRadar ще раз прочитає вашу головну сторінку, щоб перевірити відповідь.',
      button: 'Додати відповідь ШІ',
      sending: 'Додаємо відповідь ШІ…',
      running:
        'FluxRadar зараз ставить питання ШІ. Відповідь зʼявиться тут приблизно за хвилину, а перевірка головної сторінки й оцінка не зміняться.',
      retryShortly: 'Зараз не вдалося запросити відповідь ШІ. Спробуйте ще раз за хвилину.',
      refused:
        'Ця перевірка вже не може додати відповідь ШІ. Оновіть звіт, щоб побачити її поточний стан.',
      slow: 'Відповідь ШІ готується довше, ніж зазвичай. Оновіть звіт за кілька хвилин, щоб її побачити.',
      lastAttemptSiteUnread:
        'Минула спроба не почалася: FluxRadar не зміг тоді прочитати вашу головну сторінку, тож жоден ШІ-сервіс нічого не отримав. Можна натиснути кнопку ще раз.',
      lastAttemptPlatform:
        'Минула спроба не почалася через збій на боці FluxRadar, тож жоден ШІ-сервіс нічого не отримав. Можна натиснути кнопку ще раз.',
      lastAttemptRobots:
        'Минула спроба не почалася: robots.txt вашого сайту не дозволяє FluxRadar читати головну сторінку, тож жоден ШІ-сервіс нічого не отримав. Кнопка спрацює, щойно robots.txt це дозволить.',
      attemptsExhausted:
        'Відповідь ШІ додати не вдалося: кілька спроб не почалися, бо вашу головну сторінку не вдалося прочитати або на боці FluxRadar стався збій. Жоден ШІ-сервіс нічого не отримав, і для цієї перевірки відповідь більше не запитують.',
      oneAttemptLeft: 'Для цієї перевірки лишилася одна спроба.',
      oneAttemptLeftRobots:
        'Для цієї перевірки лишилася одна спроба, тож спершу виправте robots.txt, а потім натискайте кнопку.',
    },
    ask: {
      heading: 'Запитати ШІ, що він знає про ваш бізнес?',
      oneModel:
        'Безкоштовна перевірка ставить одне питання одній моделі — Claude. Платний аудит опитує дві моделі — Claude і ChatGPT — і ставить більше питань про ваш бренд і ваш ринок.',
      yes: 'Так, запитати Claude',
      no: 'Ні, дякую',
      queued:
        'Добре. Питання надішлемо, щойно завершиться перевірка головної сторінки, — доти не закривайте цю сторінку.',
      sending: 'Надсилаємо питання…',
      requested: 'Питання надіслано. Відповідь зʼявиться у звіті приблизно за хвилину.',
      failed:
        'Зараз не вдалося надіслати питання. У звіті буде видно, чи можна ще додати відповідь ШІ.',
      declined:
        'Питання не надсилаємо. Якщо передумаєте, відповідь ШІ, можливо, ще вдасться додати у звіті.',
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
        'not-described': 'ШІ не зміг описати ваш бізнес.',
        'nothing-checkable': 'У відповіді ШІ немає нічого про вас, що можна було б перевірити.',
        'not-checked': 'Цю відповідь не звіряли з вашим сайтом.',
      },
      notDescribedNext:
        'Це одна відповідь одного ШІ-помічника. Basic ставить Claude і ChatGPT більше запитань — прямі запитання про ваш бренд, на які вони відповідають із того, що вже знають, і запитання про ваш ринок, на які вони відповідають за допомогою власного вебпошуку, — показує, чи згадують вас відповіді та на які джерела вони спираються, і дає змогу замовити AI-план дій.',
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
        'Для цієї перевірки відповідь ШІ отримати не вдалося. Перевірка головної сторінки й оцінка від цього не змінилися.',
      pending: 'Крок ШІ ще не завершено. Відповіді в цьому звіті поки немає.',
    },
  },
  // Russian chrome and saved AI texts use their own recorded language.
  ru: {
    scopePreview: 'Превью в этом отчёте, полный раздел в платной проверке',
    consent: {
      mode: 'Включено по умолчанию',
      note: 'Снимите галочку, и ничего не отправится. Подробности:',
      body: 'FluxRadar задаёт Anthropic (Claude) один вопрос, который называет ваш бизнес или домен, в режиме closed-book, без просмотра веба и инструментов. Затем Anthropic отдельным запросом сверит этот ответ с ограниченным снимком этой проверки: полями профиля, которые вы сохранили, и текстом вашей главной страницы. Ни один другой ИИ-провайдер ничего не получает. ИИ может ошибаться или не упомянуть вас. Данные аккаунта, оплаты и доступы Google или Bing никогда не отправляются.',
      checkbox: 'Задать Anthropic (Claude) один вопрос о моём бизнесе',
    },
    addAnswer: {
      lead: 'Вы ещё можете добавить в этот отчёт один ответ ИИ. Ничего не отправляется, пока вы не нажмёте кнопку. Тогда FluxRadar ещё раз прочитает вашу главную страницу, чтобы проверить ответ.',
      button: 'Добавить ответ ИИ',
      sending: 'Добавляем ответ ИИ…',
      running:
        'FluxRadar сейчас задаёт вопрос ИИ. Ответ появится здесь примерно через минуту, а проверка главной страницы и оценка не изменятся.',
      retryShortly: 'Сейчас не удалось запросить ответ ИИ. Попробуйте ещё раз через минуту.',
      refused:
        'Эта проверка уже не может добавить ответ ИИ. Обновите отчёт, чтобы увидеть её текущее состояние.',
      slow: 'Ответ ИИ готовится дольше обычного. Обновите отчёт через несколько минут, чтобы его увидеть.',
      lastAttemptSiteUnread:
        'Прошлая попытка не началась: FluxRadar не смог тогда прочитать вашу главную страницу, поэтому ни один ИИ-сервис ничего не получил. Можно нажать кнопку ещё раз.',
      lastAttemptPlatform:
        'Прошлая попытка не началась из-за сбоя на стороне FluxRadar, поэтому ни один ИИ-сервис ничего не получил. Можно нажать кнопку ещё раз.',
      lastAttemptRobots:
        'Прошлая попытка не началась: robots.txt вашего сайта не разрешает FluxRadar читать главную страницу, поэтому ни один ИИ-сервис ничего не получил. Кнопка сработает, как только robots.txt это разрешит.',
      attemptsExhausted:
        'Ответ ИИ добавить не удалось: несколько попыток не смогли начаться, потому что вашу главную страницу не удалось прочитать или на стороне FluxRadar произошёл сбой. Ни один ИИ-сервис ничего не получил, и для этой проверки ответ больше не запрашивают.',
      oneAttemptLeft: 'Для этой проверки осталась одна попытка.',
      oneAttemptLeftRobots:
        'Для этой проверки осталась одна попытка, поэтому сначала исправьте robots.txt, а потом нажимайте кнопку.',
    },
    ask: {
      heading: 'Спросить ИИ, что он знает о вашем бизнесе?',
      oneModel:
        'Бесплатная проверка задаёт один вопрос одной модели, Claude. Платный аудит опрашивает две модели, Claude и ChatGPT, и задаёт больше вопросов о вашем бренде и вашем рынке.',
      yes: 'Да, спросить Claude',
      no: 'Нет, спасибо',
      queued:
        'Хорошо. Вопрос отправим, как только закончится проверка главной страницы. До тех пор не закрывайте эту страницу.',
      sending: 'Отправляем вопрос…',
      requested: 'Вопрос отправлен. Ответ появится в отчёте примерно через минуту.',
      failed:
        'Сейчас не удалось отправить вопрос. В отчёте будет видно, можно ли ещё добавить ответ ИИ.',
      declined:
        'Вопрос не отправляем. Если передумаете, ответ ИИ, возможно, ещё получится добавить в отчёте.',
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
        'not-described': 'ИИ не смог описать ваш бизнес.',
        'nothing-checkable': 'В ответе ИИ нет ничего о вас, что можно было бы проверить.',
        'not-checked': 'Этот ответ не сверяли с вашим сайтом.',
      },
      notDescribedNext:
        'Это один ответ одного ИИ-помощника. Basic задаёт Claude и ChatGPT больше вопросов. На прямые вопросы о вашем бренде они отвечают из того, что уже знают, а на вопросы о вашем рынке отвечают с помощью своего веб-поиска. Отчёт показывает, упоминают ли вас ответы и на какие источники они опираются, и позволяет запросить ИИ-план действий.',
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
        'Для этой проверки ответ ИИ получить не удалось. Проверка главной страницы и оценка от этого не изменились.',
      pending: 'Шаг ИИ ещё не завершён. Ответа в этом отчёте пока нет.',
    },
  },
};
