import type { MockAiFixture } from '@fluxradar/ai';

/** Local test/runtime responses for the additional GEO languages and paid questions. */
export function localizedGeoFixtures(brand: string): readonly MockAiFixture[] {
  const languages = [
    {
      name: 'Russian',
      first: 'Что вам известно',
      second: 'Какие независимо проверяемые факты',
      unknown: 'Я не располагаю надёжной информацией об этом бизнесе.',
      answer: `${brand} назван в ответе, но его услуги не проверены.`,
      marker: 'назван в ответе, но его услуги не проверены',
      claim: 'Ответ называет бренд',
      questions: [
        'Какие поставщики предлагают описанную услугу в этом регионе?',
        'Где найти подходящие услуги для указанной аудитории?',
      ],
    },
    {
      name: 'Ukrainian',
      first: null,
      second: 'Які незалежно перевірювані факти',
      unknown: 'Я не маю надійної інформації про цей бізнес.',
      answer: `${brand} названо у відповіді, але його послуги не перевірено.`,
      marker: 'названо у відповіді, але його послуги не перевірено',
      claim: 'Відповідь називає бренд',
      questions: [
        'Які постачальники пропонують описану послугу в цьому регіоні?',
        'Де знайти відповідні послуги для зазначеної аудиторії?',
      ],
    },
  ] as const;
  return languages.flatMap((t): readonly MockAiFixture[] => {
    const response = (text: string): MockAiFixture['response'] => ({
      status: 'completed',
      output_text: text,
      usage: { input_tokens: 100, output_tokens: 70 },
    });
    const evaluation = response(
      JSON.stringify({
        answerDescribesSubject: true,
        overall: 'matches-evidence',
        claims: [{ claim: `${t.claim} ${brand}.`, verdict: 'unverified', answerQuote: brand }],
      }),
    );
    return [
      { questionIncludes: t.marker, response: evaluation },
      {
        questionIncludes: t.unknown,
        response: response(
          JSON.stringify({ answerDescribesSubject: false, overall: 'no-description', claims: [] }),
        ),
      },
      {
        questionIncludes: `Write every question in ${t.name}.`,
        response: response(JSON.stringify({ questions: t.questions })),
      },
      ...(t.first === null
        ? []
        : [
            {
              questionIncludes: 'Что вам известно о бизнесе, связанном с',
              response: response(t.unknown),
            },
            { questionIncludes: t.first, response: response(t.answer) },
          ]),
      { questionIncludes: t.second, response: response(t.answer) },
      ...t.questions.map((question) => ({
        questionIncludes: question,
        response: response(t.answer),
      })),
    ];
  });
}
