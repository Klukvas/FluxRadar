// Mock fixtures for the Ukrainian Free GEO preview (W1), so a local run in
// Ukrainian shows an answer and its judged claims instead of "could not be
// produced" (the mock refuses any question no fixture matches).
//
// Same shape as the English defaults in geo.ts: the evaluator fixtures key on a
// phrase that exists only inside an answer and come first, because a judge
// request quotes the question back and would otherwise match the question's own
// fixture. The known-brand answer carries the Ukrainian apostrophe ʼ, and one
// claim quotes it re-typed as ' — the way a real judge does — to exercise the
// quote matcher's apostrophe folding end to end.

import type { MockAiFixture } from '@fluxradar/ai';

function ukrainianGeoAnswers(brand: string, siteHostname: string) {
  return {
    unknownDomain:
      `Я не маю достовірної інформації про бізнес, повʼязаний із ${siteHostname}. ` +
      'Я міг би лише вгадувати за назвою, а здогад — це не відповідь.',
    knownBrand:
      `${brand} — це сервіс аудиту вебсайтів для невеликих команд. Насправді його бренд ` +
      `називається Northwind Digital, а не ${brand}, і компанія розташована в Берліні. ` +
      `Ціни на перевірки та обʼєм модулів повʼязані з тарифами на https://${siteHostname}/.`,
  } as const;
}

function evaluationBody(payload: Record<string, unknown>): MockAiFixture['response'] {
  return {
    status: 'completed',
    output_text: JSON.stringify(payload),
    usage: { input_tokens: 900, output_tokens: 180 },
  };
}

/** Ukrainian evaluator and question fixtures; prepended to the English defaults. */
export function ukrainianGeoFixtures(
  brand: string,
  siteHostname: string,
): readonly MockAiFixture[] {
  const answers = ukrainianGeoAnswers(brand, siteHostname);
  return [
    {
      questionIncludes: 'Я не маю достовірної інформації про бізнес',
      response: evaluationBody({
        answerDescribesSubject: false,
        claims: [],
        overall: 'no-description',
      }),
    },
    {
      questionIncludes: 'сервіс аудиту вебсайтів для невеликих команд',
      response: evaluationBody({
        answerDescribesSubject: true,
        claims: [
          {
            claim: `Відповідь стосується бізнесу, який названо в профілі, — ${brand}.`,
            verdict: 'matched',
            answerQuote: `${brand} — це`,
            sourceId: 'profile-1',
            sourceQuote: brand,
          },
          {
            claim: 'Бізнес — це сервіс аудиту вебсайтів для невеликих команд.',
            verdict: 'unverified',
            answerQuote: 'сервіс аудиту вебсайтів для невеликих команд',
          },
          {
            claim: `Бренд бізнесу називається Northwind Digital, а не ${brand}.`,
            verdict: 'contradicted',
            answerQuote: `його бренд називається Northwind Digital, а не ${brand}`,
            sourceId: 'profile-1',
            sourceQuote: brand,
          },
          {
            claim: 'Компанія розташована в Берліні.',
            verdict: 'unverified',
            answerQuote: 'компанія розташована в Берліні',
          },
          {
            claim: 'Обсяг модулів залежить від тарифу.',
            verdict: 'unverified',
            answerQuote: "обʼєм модулів пов'язані з тарифами",
          },
        ],
        overall: 'contradicts-evidence',
      }),
    },
    {
      questionIncludes: 'Що вам відомо про бізнес, повʼязаний із',
      response: {
        status: 'completed',
        output_text: answers.unknownDomain,
        usage: { input_tokens: 110, output_tokens: 60 },
      },
    },
    {
      questionIncludes: 'Що вам відомо про',
      response: {
        status: 'completed',
        output_text: answers.knownBrand,
        citations: [`https://${siteHostname}/`],
        usage: { input_tokens: 140, output_tokens: 90 },
      },
    },
  ];
}
