// The Russian half of "What AI says about your business".
//
// Every string here is the frame the app draws around the answers: headings,
// labels over a quote, the counts under each tone, the advice lines. The
// answers themselves, and the fragments of the site they are compared with,
// come from the scan and stay in the report's language (`report-language.ts`).
//
// The same rule as the Ukrainian half runs through it: an answer *differs from
// your site*, and nothing here says an AI is wrong.

import type { GeoProsePosition } from './api';
import type { GeoDigestCopy } from './geo-digest-copy';
import { ruCountForm, takesRuSingular } from './i18n.ru.grammar';

/** Locative after «в»: «в 1 ответе», «в 3 ответах». */
const ruInAnswers = (count: number): string => (takesRuSingular(count) ? 'ответе' : 'ответах');

/** Genitive after «из»: «из 1 ответа», «из 3 ответов». */
const ruAnswersOf = (count: number): string => (takesRuSingular(count) ? 'ответа' : 'ответов');

const RU_PROSE: Readonly<Record<GeoProsePosition, string>> = {
  'first-sentence': 'в первом предложении',
  early: 'в первой половине ответа',
  late: 'во второй половине ответа',
};

export const russianGeoDigestCopy: GeoDigestCopy = {
  heading: 'Что ИИ говорит о вашем бизнесе',
  lead: 'Итог всех ответов этой проверки: где ответ расходится с тем, что говорит ваш сайт, каким тоном он описывает ваш бизнес и где ваш бренд появляется в ответах на нейтральные вопросы. Это снимок одного запуска, а не то, что модель знает о вас в целом.',
  notEvaluated: 'В этой проверке не оценивалось.',
  factsHeading: 'Где ответы ИИ расходятся с вашим сайтом',
  factsNotEvaluated:
    'В этой проверке не оценивалось: ни один ответ не сверяли с тем, что говорит ваш сайт.',
  factsNone: (checked) =>
    `В ${checked} ${ruInAnswers(checked)}, ${takesRuSingular(checked) ? 'сверенном' : 'сверенных'} с вашим сайтом, нет ничего, что расходилось бы с ним.`,
  factsSummary: (count, checked) =>
    `Ответы ИИ расходятся с вашим сайтом в ${count} ${ruCountForm(count, 'месте', 'местах', 'местах')}; сверено ответов: ${checked}.`,
  factsPageSource: 'Ваша страница',
  factsProfileSource: 'Профиль вашего сайта',
  profileFields: {
    brand: 'Название бренда',
    businessDescription: 'О чём этот сайт?',
    offerings: 'Услуги или товары',
    industry: 'Тип бизнеса или сайта',
    region: 'Где работает сайт?',
    targetAudience: 'Для кого этот сайт?',
    language: 'Основной язык',
    targetLanguages: 'Целевые языки',
  },
  factsProviders: 'В ответах от',
  factsAnswerQuote: 'В ответе',
  factsSiteQuote: 'На вашем сайте',
  factsPageAdvice:
    'Напишите верный факт на этой странице явно, простыми словами, которые помощник может процитировать. Если устарела сама страница, сначала обновите её.',
  factsProfileAdvice:
    'Это сверено с полем профиля вашего сайта. Если поле устарело, исправьте его; если оно верное, напишите тот же факт на сайте.',
  toneHeading: 'Каким тоном ответы описывают ваш бизнес',
  toneNotEvaluated: 'Тон в этой проверке не оценивался.',
  toneLabels: {
    positive: 'Положительный',
    neutral: 'Нейтральный',
    negative: 'Отрицательный',
    mixed: 'Смешанный',
  },
  toneCount: (label, count) => `${label}: ${count}`,
  toneNoDescription: (count) => `Не описали вас: ${count}`,
  toneUnconfirmed: (count) => `Не подтверждено: ${count}`,
  toneNotRated: (count) => `Не оценено: ${count}`,
  toneNegativeHeading: 'Ответы, которые описывают ваш бизнес отрицательно',
  toneNoNegative: 'Ни один ответ не описал ваш бизнес отрицательно.',
  positionHeading: 'Где появляется ваш бренд',
  positionNotEvaluated: 'В этой проверке не оценивалось.',
  positionNoDiscovery: 'В этой проверке не было ответов на нейтральные вопросы.',
  positionNotNamed: (answers) =>
    `Ваш бренд не назван ни в одном ответе на нейтральные вопросы (всего ответов: ${answers}).`,
  positionFirst: (first, placed) =>
    `Назван первым в ${first} из ${placed} ${ruAnswersOf(placed)}, ${takesRuSingular(placed) ? 'который вас упоминает' : 'которые вас упоминают'}`,
  positionMedian: (rank) => `медианное место в списке: ${rank}`,
  positionInList: (lists, placed) => `в списке в ${lists} из ${placed}`,
  positionAfterCompetitors: (after, placed) =>
    `после конкурента из вашего профиля в ${after} из ${placed}`,
  positionNoCompetitors:
    'Добавьте названия конкурентов в профиль сайта, чтобы видеть, называют ли их раньше вас.',
  cardTone: 'Тон',
  cardToneNotEvaluated: 'Тон в этой проверке не оценивался',
  cardToneNone: 'Тона нет: ответ не описал ваш бизнес',
  cardToneUnconfirmed: 'Тон не показан: его не удалось подтвердить словами самого ответа',
  cardPosition: (position) => {
    const place =
      position.kind === 'list'
        ? `${position.rank} из ${position.listSize} в списке`
        : RU_PROSE[position.bucket];
    const before =
      position.competitorsBefore === 0
        ? ''
        : `; раньше вас назвали конкурентов: ${position.competitorsBefore}`;
    return `Ваше место в этом ответе: ${place}${before}`;
  },
};
