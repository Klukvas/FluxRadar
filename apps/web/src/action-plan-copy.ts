// Copy for the AI Action Plan block, in the `findings-copy` style.
//
// Kept beside `i18n.ts` rather than inside it: the shared file is already far
// past the size anyone can review, and this block is read as one screen.

import type { Language } from './i18n';
import { takesRuSingular } from './i18n.ru.grammar';

export type ActionPlanCopy = {
  readonly heading: string;
  readonly aiLabel: string;
  readonly lockedTitle: string;
  readonly lockedBody: string;
  readonly lockedAction: string;
  readonly nothingToPlan: string;
  readonly windowClosed: string;
  readonly idleLead: string;
  readonly languageLabel: string;
  readonly generate: string;
  readonly consent: string;
  readonly running: string;
  readonly failed: string;
  readonly retry: string;
  readonly noAttemptsLeft: string;
  readonly overviewHeading: string;
  readonly actionsHeading: string;
  readonly effort: Readonly<Record<string, string>>;
  readonly effortLabel: string;
  readonly settled: string;
  readonly settledNote: string;
  readonly openIssues: (open: number, total: number) => string;
  readonly reach: (share: number, rules: number) => string;
  readonly caveat: (module: string) => string;
  readonly generatedAt: (when: string, model: string) => string;
  readonly regenerate: (left: number) => string;
  readonly otherLanguage: (language: string) => string;
  /**
   * Said beside the PDF button when the reader has picked a plan language the
   * PDF cannot carry, and a plan in the report's own language does exist. The
   * PDF is a report document, so it is built in the report's language
   * (`report-language.ts`); the plan inside it is the one written in that
   * language, not the one the picker is showing.
   */
  readonly pdfPlanLanguage: string;
  /**
   * Said instead, when no plan exists in the report's language at all. The
   * server embeds the document-language plan and never falls back, so promising
   * a plan here would promise a chapter the file will not contain.
   */
  readonly pdfPlanMissing: string;
};

const EN: ActionPlanCopy = {
  heading: 'AI Action Plan',
  aiLabel: 'AI-generated',
  lockedTitle: 'AI Action Plan',
  lockedBody: 'An AI Action Plan comes with a new Basic or Complete scan of this site.',
  lockedAction: 'Run a Complete scan',
  // True of both reports that reach this state: the one with nothing open at
  // all, and the one whose only open findings are Analytics — which are still
  // listed below, so the line must not call them settled.
  nothingToPlan:
    'No open finding on this report can go into a plan — findings in the Analytics section come from your own Google data and are never part of one.',
  windowClosed:
    'The three-day window for asking for an Action Plan has closed. The plans already written stay readable.',
  idleLead:
    'Claude reads this report’s findings and writes a prioritized plan of fixes, with a short overview you can forward to a client.',
  languageLabel: 'Plan language',
  generate: 'Write the Action Plan',
  consent:
    'Pressing the button sends this report’s rule names, severities, open counts, sample page addresses and recommendations to Anthropic. It never sends evidence excerpts, screenshots or anything from the Analytics section.',
  running: 'Claude is writing the plan. This usually takes a minute or two.',
  failed: 'The plan could not be written this time.',
  retry: 'Try again',
  noAttemptsLeft: 'This scan has used all of its Action Plan attempts.',
  overviewHeading: 'Overview',
  actionsHeading: 'Actions',
  effort: { small: 'Small effort', medium: 'Medium effort', large: 'Large effort' },
  effortLabel: 'Effort',
  settled: 'Settled',
  settledNote:
    'No open issue is left on this Action’s rules. Inside one scan that means they were marked Ignored or a False Positive, not that the site changed.',
  openIssues: (open, total) => `${open} open of ${total}`,
  reach: (share, rules) =>
    `This plan addresses ${Math.round(share * 100)}% of the open findings, across ${rules} rules.`,
  caveat: (module) => `${module} was only partly checked — the plan may be incomplete.`,
  generatedAt: (when, model) => `Written ${when} by ${model}.`,
  regenerate: (left) => `Rewrite the plan (${left} left)`,
  otherLanguage: (language) => `A plan already exists in ${language}. Open it`,
  pdfPlanLanguage: 'The PDF includes the English plan.',
  pdfPlanMissing: 'The PDF has no plan: write one in English first.',
};

const UK: ActionPlanCopy = {
  heading: 'AI-план дій',
  aiLabel: 'Згенеровано AI',
  lockedTitle: 'AI-план дій',
  lockedBody: 'AI-план дій є в новій перевірці Basic або Complete цього сайту.',
  lockedAction: 'Запустити перевірку Complete',
  nothingToPlan:
    'Жодна відкрита знахідка цього звіту не може потрапити до плану — знахідки розділу «Аналітика» беруться з ваших даних Google і ніколи до нього не входять.',
  windowClosed:
    'Трьохденне вікно для запиту плану дій закрилося. Уже написані плани залишаються доступними.',
  idleLead:
    'Claude читає знахідки цього звіту й пише впорядкований план правок із коротким оглядом, який можна переслати клієнту.',
  languageLabel: 'Мова плану',
  generate: 'Написати план дій',
  consent:
    'Натискання кнопки надсилає до Anthropic назви правил цього звіту, їхню серйозність, кількість відкритих знахідок, приклади адрес сторінок і рекомендації. Уривки доказів, знімки екрана та будь-що з розділу «Аналітика» не надсилаються ніколи.',
  running: 'Claude пише план. Зазвичай це займає одну-дві хвилини.',
  failed: 'Цього разу план написати не вдалося.',
  retry: 'Спробувати ще раз',
  noAttemptsLeft: 'Ця перевірка вичерпала всі спроби написання плану.',
  overviewHeading: 'Огляд',
  actionsHeading: 'Дії',
  effort: { small: 'Невеликі зусилля', medium: 'Середні зусилля', large: 'Великі зусилля' },
  effortLabel: 'Зусилля',
  settled: 'Знято',
  settledNote:
    'На правилах цієї дії не залишилось відкритих знахідок. У межах однієї перевірки це означає, що їх позначили як «Ігнорувати» або «Хибне спрацювання», а не що сайт змінився.',
  openIssues: (open, total) => `${open} відкрито з ${total}`,
  reach: (share, rules) =>
    `Цей план охоплює ${Math.round(share * 100)}% відкритих знахідок за ${rules} правилами.`,
  caveat: (module) => `Розділ «${module}» перевірено лише частково — план може бути неповним.`,
  generatedAt: (when, model) => `Написано ${when}, модель ${model}.`,
  regenerate: (left) => `Переписати план (залишилось ${left})`,
  otherLanguage: (language) => `План уже існує мовою ${language}. Відкрити`,
  pdfPlanLanguage: 'У PDF входить план українською.',
  pdfPlanMissing: 'У PDF немає плану: спершу складіть його українською.',
};

const RU: ActionPlanCopy = {
  heading: 'ИИ-план действий',
  aiLabel: 'Сгенерировано ИИ',
  lockedTitle: 'ИИ-план действий',
  lockedBody: 'ИИ-план действий есть в новой проверке Basic или Complete этого сайта.',
  lockedAction: 'Запустить проверку Complete',
  nothingToPlan:
    'Ни одна открытая находка этого отчёта не может попасть в план: находки раздела «Аналитика» берутся из ваших данных Google и никогда в него не входят.',
  windowClosed:
    'Трёхдневное окно для запроса плана действий закрылось. Уже написанные планы остаются доступными.',
  idleLead:
    'Claude читает находки этого отчёта и пишет упорядоченный план правок с коротким обзором, который можно переслать клиенту.',
  languageLabel: 'Язык плана',
  generate: 'Написать план действий',
  consent:
    'Нажатие кнопки отправляет в Anthropic названия правил этого отчёта, их серьёзность, количество открытых находок, примеры адресов страниц и рекомендации. Отрывки доказательств, снимки экрана и что-либо из раздела «Аналитика» не отправляются никогда.',
  running: 'Claude пишет план. Обычно это занимает одну-две минуты.',
  failed: 'На этот раз план написать не удалось.',
  retry: 'Попробовать ещё раз',
  noAttemptsLeft: 'Эта проверка исчерпала все попытки написания плана.',
  overviewHeading: 'Обзор',
  actionsHeading: 'Действия',
  effort: { small: 'Небольшие усилия', medium: 'Средние усилия', large: 'Большие усилия' },
  effortLabel: 'Усилия',
  settled: 'Снято',
  settledNote:
    'На правилах этого действия не осталось открытых находок. В пределах одной проверки это значит, что им поставили статус «Игнорируется» или «Ложная», а не что сайт изменился.',
  openIssues: (open, total) => `${open} открыто из ${total}`,
  reach: (share, rules) =>
    `Этот план охватывает ${Math.round(share * 100)}% открытых находок по ${rules} ${
      takesRuSingular(rules) ? 'правилу' : 'правилам'
    }.`,
  caveat: (module) =>
    `Раздел «${module}» проверен только частично, поэтому план может быть неполным.`,
  generatedAt: (when, model) => `Написано ${when}, модель ${model}.`,
  regenerate: (left) => `Переписать план (осталось ${left})`,
  otherLanguage: (language) => `План уже существует на языке ${language}. Открыть`,
  pdfPlanLanguage: 'В PDF входит план на украинском.',
  pdfPlanMissing: 'В PDF нет плана: сначала составьте его на украинском.',
};

export const actionPlanCopy: Readonly<Record<Language, ActionPlanCopy>> = {
  en: EN,
  uk: UK,
  ru: RU,
};
