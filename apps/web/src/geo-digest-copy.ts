// Copy for "What AI says about your business" and for the tone and place lines
// on each answer card, in the `action-plan-copy` style.
//
// Kept beside `i18n.ts` rather than inside it: the shared file is already far
// past the size anyone can review, and this block is read as one screen.
//
// One rule runs through every sentence: an answer *differs from your site*. It
// never says that an AI is wrong — the site is the only evidence the scan has,
// and it can be the out-of-date side.

import { takesUkSingular, ukCountForm, type Language } from './i18n';
import type { GeoAnswerPosition, GeoProsePosition, GeoToneLabel } from './api';

export type GeoDigestCopy = {
  readonly heading: string;
  readonly lead: string;
  readonly notEvaluated: string;
  readonly factsHeading: string;
  readonly factsNotEvaluated: string;
  readonly factsNone: (checked: number) => string;
  readonly factsSummary: (count: number, checked: number) => string;
  readonly factsPageSource: string;
  readonly factsProfileSource: string;
  /**
   * The profile fields by the name the scan keys them with (`profile:<field>`),
   * worded as on the profile form. The stored label is the evaluator's English
   * one; a field this list does not know falls back to it.
   */
  readonly profileFields: Readonly<Record<string, string>>;
  readonly factsProviders: string;
  readonly factsAnswerQuote: string;
  readonly factsSiteQuote: string;
  readonly factsPageAdvice: string;
  readonly factsProfileAdvice: string;
  readonly toneHeading: string;
  readonly toneNotEvaluated: string;
  readonly toneLabels: Readonly<Record<GeoToneLabel, string>>;
  readonly toneCount: (label: string, count: number) => string;
  readonly toneNoDescription: (count: number) => string;
  readonly toneUnconfirmed: (count: number) => string;
  readonly toneNotRated: (count: number) => string;
  readonly toneNegativeHeading: string;
  readonly toneNoNegative: string;
  readonly positionHeading: string;
  readonly positionNotEvaluated: string;
  readonly positionNoDiscovery: string;
  readonly positionNotNamed: (answers: number) => string;
  readonly positionFirst: (first: number, placed: number) => string;
  readonly positionMedian: (rank: string) => string;
  readonly positionInList: (lists: number, placed: number) => string;
  readonly positionAfterCompetitors: (after: number, placed: number) => string;
  readonly positionNoCompetitors: string;
  readonly cardTone: string;
  readonly cardToneNotEvaluated: string;
  readonly cardToneNone: string;
  readonly cardToneUnconfirmed: string;
  readonly cardPosition: (position: GeoAnswerPosition) => string;
};

const enAnswers = (count: number): string => (count === 1 ? 'answer' : 'answers');

const EN_PROSE: Readonly<Record<GeoProsePosition, string>> = {
  'first-sentence': 'in the first sentence',
  early: 'in the first half of the answer',
  late: 'in the second half of the answer',
};

const EN: GeoDigestCopy = {
  heading: 'What AI says about your business',
  lead: 'Every answer of this scan, summed up: where an answer differs from what your site says, the tone it describes your business in, and where your brand comes up in answers to neutral questions. It is a snapshot of this one run, not what a model knows about you in general.',
  notEvaluated: 'Not evaluated in this scan.',
  factsHeading: 'Where AI answers differ from your site',
  factsNotEvaluated:
    'Not evaluated in this scan: no answer was checked against what your site says.',
  factsNone: (checked) =>
    `In the ${checked} ${enAnswers(checked)} checked against your site, nothing differs from what your site says.`,
  factsSummary: (count, checked) =>
    `AI answers differ from your site in ${count} ${count === 1 ? 'place' : 'places'}, across ${checked} ${enAnswers(checked)} checked.`,
  factsPageSource: 'Your page',
  factsProfileSource: 'Your site profile',
  profileFields: {
    brand: 'Brand name',
    businessDescription: 'What is this site about?',
    offerings: 'Services or products',
    industry: 'Business or site type',
    region: 'Where does it operate?',
    targetAudience: 'Who is it for?',
    language: 'Primary language',
    targetLanguages: 'Target languages',
  },
  factsProviders: 'In answers from',
  factsAnswerQuote: 'The answer says',
  factsSiteQuote: 'Your site says',
  factsPageAdvice:
    'Make the correct fact explicit on this page, in plain words an assistant can quote. If the page itself is out of date, update it first.',
  factsProfileAdvice:
    'This was checked against a field of your site profile. If the field is out of date, correct it; if it is right, state the same fact plainly on your site.',
  toneHeading: 'How the answers describe your business',
  toneNotEvaluated: 'Tone was not evaluated in this scan.',
  toneLabels: { positive: 'Positive', neutral: 'Neutral', negative: 'Negative', mixed: 'Mixed' },
  toneCount: (label, count) => `${label}: ${count}`,
  toneNoDescription: (count) => `Did not describe you: ${count}`,
  toneUnconfirmed: (count) => `Not confirmed: ${count}`,
  toneNotRated: (count) => `Not evaluated: ${count}`,
  toneNegativeHeading: 'Answers that describe your business negatively',
  toneNoNegative: 'No answer described your business negatively.',
  positionHeading: 'Where your brand comes up',
  positionNotEvaluated: 'Not evaluated in this scan.',
  positionNoDiscovery: 'No neutral question was answered in this scan.',
  positionNotNamed: (answers) =>
    `Your brand was not named in its ${answers} ${enAnswers(answers)} to neutral questions.`,
  positionFirst: (first, placed) =>
    `Named first in ${first} of ${placed} ${enAnswers(placed)} that ${placed === 1 ? 'mentions' : 'mention'} you`,
  positionMedian: (rank) => `median place in a list: ${rank}`,
  positionInList: (lists, placed) => `in a list in ${lists} of ${placed}`,
  positionAfterCompetitors: (after, placed) =>
    `named after a competitor from your profile in ${after} of ${placed}`,
  positionNoCompetitors:
    'Add competitor names to your site profile to see whether answers name them before you.',
  cardTone: 'Tone',
  cardToneNotEvaluated: 'Tone not evaluated in this scan',
  cardToneNone: 'No tone: the answer did not describe your business',
  cardToneUnconfirmed: 'Tone not shown: it could not be confirmed from the answer’s own words',
  cardPosition: (position) => {
    const place =
      position.kind === 'list'
        ? `${position.rank} of ${position.listSize} in a list`
        : EN_PROSE[position.bucket];
    const before =
      position.competitorsBefore === 0
        ? ''
        : `; ${position.competitorsBefore} ${position.competitorsBefore === 1 ? 'competitor' : 'competitors'} named before you`;
    return `Your place in this answer: ${place}${before}`;
  },
};

/** Genitive after «з»: «з 1 відповіді», «з 3 відповідей». */
const ukAnswersOf = (count: number): string =>
  ukCountForm(count, 'відповіді', 'відповідей', 'відповідей');

/** Locative after «у»: «у 1 відповіді», «у 3 відповідях». */
const ukInAnswers = (count: number): string =>
  ukCountForm(count, 'відповіді', 'відповідях', 'відповідях');

const UK_PROSE: Readonly<Record<GeoProsePosition, string>> = {
  'first-sentence': 'у першому реченні',
  early: 'у першій половині відповіді',
  late: 'у другій половині відповіді',
};

const UK: GeoDigestCopy = {
  heading: 'Що ШІ каже про ваш бізнес',
  lead: 'Підсумок усіх відповідей цієї перевірки: де відповідь розходиться з тим, що каже ваш сайт, яким тоном вона описує ваш бізнес і де ваш бренд з’являється у відповідях на нейтральні запитання. Це знімок одного запуску, а не те, що модель знає про вас загалом.',
  notEvaluated: 'У цій перевірці не оцінювалося.',
  factsHeading: 'Де відповіді ШІ розходяться з вашим сайтом',
  factsNotEvaluated:
    'У цій перевірці не оцінювалося: жодну відповідь не звіряли з тим, що каже ваш сайт.',
  factsNone: (checked) =>
    `У ${checked} ${ukInAnswers(checked)}, ${takesUkSingular(checked) ? 'звіреній' : 'звірених'} із вашим сайтом, немає нічого, що розходилося б із ним.`,
  factsSummary: (count, checked) =>
    `Відповіді ШІ розходяться з вашим сайтом у ${count} ${ukCountForm(count, 'місці', 'місцях', 'місцях')}; звірено ${checked} ${ukCountForm(checked, 'відповідь', 'відповіді', 'відповідей')}.`,
  factsPageSource: 'Ваша сторінка',
  factsProfileSource: 'Профіль вашого сайту',
  profileFields: {
    brand: 'Назва бренду',
    businessDescription: 'Про що цей сайт?',
    offerings: 'Послуги або товари',
    industry: 'Тип бізнесу або сайту',
    region: 'Де працює сайт?',
    targetAudience: 'Для кого цей сайт?',
    language: 'Основна мова',
    targetLanguages: 'Цільові мови',
  },
  factsProviders: 'У відповідях від',
  factsAnswerQuote: 'У відповіді',
  factsSiteQuote: 'На вашому сайті',
  factsPageAdvice:
    'Напишіть правильний факт на цій сторінці явно, простими словами, які асистент може процитувати. Якщо застаріла сама сторінка, спершу оновіть її.',
  factsProfileAdvice:
    'Це звірено з полем профілю вашого сайту. Якщо поле застаріло, виправте його; якщо воно правильне, напишіть той самий факт на сайті.',
  toneHeading: 'Яким тоном відповіді описують ваш бізнес',
  toneNotEvaluated: 'Тон у цій перевірці не оцінювався.',
  toneLabels: {
    positive: 'Позитивний',
    neutral: 'Нейтральний',
    negative: 'Негативний',
    mixed: 'Змішаний',
  },
  toneCount: (label, count) => `${label}: ${count}`,
  toneNoDescription: (count) => `Не описали вас: ${count}`,
  toneUnconfirmed: (count) => `Не підтверджено: ${count}`,
  toneNotRated: (count) => `Не оцінено: ${count}`,
  toneNegativeHeading: 'Відповіді, що описують ваш бізнес негативно',
  toneNoNegative: 'Жодна відповідь не описала ваш бізнес негативно.',
  positionHeading: 'Де з’являється ваш бренд',
  positionNotEvaluated: 'У цій перевірці не оцінювалося.',
  positionNoDiscovery: 'У цій перевірці не було відповідей на нейтральні запитання.',
  positionNotNamed: (answers) =>
    `Ваш бренд не названо в жодній відповіді на нейтральні запитання (усього відповідей: ${answers}).`,
  positionFirst: (first, placed) =>
    `Названо першим у ${first} з ${placed} ${ukAnswersOf(placed)}, що вас ${takesUkSingular(placed) ? 'згадує' : 'згадують'}`,
  positionMedian: (rank) => `медіанне місце у списку: ${rank}`,
  positionInList: (lists, placed) => `у списку в ${lists} з ${placed}`,
  positionAfterCompetitors: (after, placed) =>
    `після конкурента з вашого профілю в ${after} з ${placed}`,
  positionNoCompetitors:
    'Додайте назви конкурентів у профіль сайту, щоб бачити, чи називають їх раніше за вас.',
  cardTone: 'Тон',
  cardToneNotEvaluated: 'Тон у цій перевірці не оцінювався',
  cardToneNone: 'Тону немає: відповідь не описала ваш бізнес',
  cardToneUnconfirmed: 'Тон не показано: його не вдалося підтвердити словами самої відповіді',
  cardPosition: (position) => {
    const place =
      position.kind === 'list'
        ? `${position.rank} з ${position.listSize} у списку`
        : UK_PROSE[position.bucket];
    const before =
      position.competitorsBefore === 0
        ? ''
        : `; раніше за вас названо конкурентів: ${position.competitorsBefore}`;
    return `Ваше місце в цій відповіді: ${place}${before}`;
  },
};

export const geoDigestCopy: Readonly<Record<Language, GeoDigestCopy>> = { en: EN, uk: UK };
