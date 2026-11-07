import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  AiQuotaTracker,
  AnthropicProvider,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  runGeoModule,
  buildPrompt,
  aiRequestKey,
  buildGeoEvaluationRequest,
  mockRoutingProvider,
} from '@fluxradar/ai';
import type { GeoEvidenceSnapshot } from '@fluxradar/ai';
import { storedExecutionConfig } from '../profiles/execution-config.ts';
import { freeGeoRequests } from './free-geo.ts';
import { buildGeoRequests, generateGeoDiscoveryQuestions } from './geo.ts';

const TEXT = {
  en: {
    name: 'English',
    first: 'What do you know',
    answer: 'Smile Clinic is a dental clinic.',
    claim: 'The answer names Smile Clinic.',
    discovery: ['Which dental clinics offer implants?', 'Where can families find dental care?'],
  },
  uk: {
    name: 'Ukrainian',
    first: 'Що вам відомо',
    answer: 'Smile Clinic — стоматологічна клініка.',
    claim: 'Відповідь називає Smile Clinic.',
    discovery: [
      'Які стоматологічні клініки пропонують імпланти?',
      'Де сімʼям знайти стоматологічну допомогу?',
    ],
  },
  ru: {
    name: 'Russian',
    first: 'Что вам известно',
    answer: 'Smile Clinic — стоматологическая клиника.',
    claim: 'В ответе названа Smile Clinic.',
    discovery: [
      'Какие стоматологические клиники предлагают импланты?',
      'Где семьям найти стоматологическую помощь?',
    ],
  },
} as const;
const EVIDENCE: GeoEvidenceSnapshot = {
  siteDomain: 'smile.example',
  sufficiency: 'profile-only',
  limits: [],
  sources: [
    {
      id: 'profile-1',
      kind: 'profile',
      label: 'Brand name',
      url: null,
      excerpt: 'Smile Clinic',
      provenance: 'owner-entered',
    },
  ],
};

describe.each(['Free', 'Basic', 'Complete'] as const)(
  '%s actual provider language payload',
  (plan) => {
    it.each(['en', 'uk', 'ru'] as const)(
      'freezes %s for questions, answers, generator and claims',
      async (language) => {
        const t = TEXT[language];
        const payloads: Record<string, unknown>[] = [];
        const fetcher = vi.fn<typeof fetch>((_url, init) => {
          const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
          payloads.push(payload);
          const isGenerator = JSON.stringify(payload.messages).includes(
            'Generate neutral discovery questions',
          );
          const isJudge = String(payload.system).includes('You verify one AI answer');
          const text = isGenerator
            ? JSON.stringify({ questions: t.discovery })
            : isJudge
              ? JSON.stringify({
                  answerDescribesSubject: true,
                  overall: 'matches-evidence',
                  claims: [
                    {
                      claim: t.claim,
                      verdict: 'matched',
                      answerQuote: 'Smile Clinic',
                      sourceId: 'profile-1',
                      sourceQuote: 'Smile Clinic',
                    },
                  ],
                })
              : t.answer;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: `msg_${payloads.length}`,
                model: 'claude-sonnet-5',
                stop_reason: 'end_turn',
                content: [{ type: 'text', text }],
                usage: { input_tokens: 90, output_tokens: 60 },
              }),
              { status: 200 },
            ),
          );
        });
        const provider = new AnthropicProvider({ apiKey: 'local-test-only', fetcher });
        const scanId = `language-${plan}-${language}`;
        const consent = {
          scanId,
          providers: ['anthropic' as const],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        };
        let quota = AiQuotaTracker.withLimit(30);
        let discovery: readonly string[] = [];
        if (plan !== 'Free') {
          const generated = await generateGeoDiscoveryQuestions({
            scanId,
            brand: 'Smile Clinic',
            siteHostname: 'smile.example',
            context: {
              industry: 'Dental clinic',
              targetLanguages: 'Polish, German',
              language: 'pl',
            },
            language,
            provider,
            consent,
            quota,
          });
          expect(generated.status).toBe('Completed');
          discovery = generated.questions;
          quota = generated.quota;
          expect(payloads[0]?.system).toContain(`Write every question in ${t.name} only`);
          expect(JSON.stringify(payloads[0]?.messages)).not.toContain('Target languages:');
        }
        const requests =
          plan === 'Free'
            ? freeGeoRequests(scanId, 'Smile Clinic', 'smile.example', language, true)
            : buildGeoRequests(
                scanId,
                'Smile Clinic',
                'smile.example',
                discovery,
                ['anthropic'],
                language,
              );
        expect(requests[0]?.question).toContain(t.first);
        const result = await runGeoModule(
          {
            scanId,
            plan,
            brand: 'Smile Clinic',
            siteDomain: 'smile.example',
            siteOrigin: 'https://smile.example',
            consent,
            requests,
            language,
            evidence: EVIDENCE,
          },
          { provider, quota },
        );
        expect(result.responses).toHaveLength(requests.length);
        expect(result.responses.every((response) => response.response.rawText === t.answer)).toBe(
          true,
        );
        const answers = payloads.filter((payload) => String(payload.system).includes('Answer in '));
        expect(answers).toHaveLength(requests.length);
        for (const payload of answers) expect(payload.system).toContain(`Answer in ${t.name}.`);
        const judges = payloads.filter((payload) =>
          String(payload.system).includes('You verify one AI answer'),
        );
        expect(judges).toHaveLength(requests.length);
        for (const payload of judges) {
          expect(payload.system).toContain(`Write each \`claim\` in ${t.name}.`);
          expect(payload.system).toContain('verbatim');
          if (language !== 'en') expect(payload.max_tokens).toBe(4000);
        }
        for (const evaluation of result.answerEvaluations.values()) {
          expect(evaluation.status).toBe('Completed');
          if (evaluation.status === 'Completed')
            expect(evaluation.payload?.claims[0]).toMatchObject({
              claim: t.claim,
              answerQuote: 'Smile Clinic',
              sourceQuote: 'Smile Clinic',
            });
        }
      },
    );
  },
);

// Literal expectations derived from read-only f3986480 builders, including its
// own geo-evaluation-language dependency. Never regenerated by these tests.
type Golden = { systemDigest: string; requestDigest: string; promptDigest: string; key: string };
const LEGACY = JSON.parse(
  readFileSync(new URL('./geo-language.legacy.json', import.meta.url), 'utf8'),
) as { base: string; records: Readonly<Record<string, Golden>> };
const LEGACY_PAID =
  '{"schemaVersion":1,"source":"launch","profileConfigVersion":1,"profile":{"name":"Smile Clinic","domain":"https://smile.example","industry":"Dental clinic","targetLanguages":"Polish, German","language":"pl"},"plan":"Basic","scope":{"includeSubdomains":false}}';
const LEGACY_FREE_EN =
  '{"schemaVersion":1,"source":"launch","profileConfigVersion":1,"profile":{"name":"Smile Clinic","domain":"https://smile.example"},"plan":"Free","scope":{"includeSubdomains":false},"language":"en"}';
const LEGACY_FREE_UK =
  '{"schemaVersion":1,"source":"launch","profileConfigVersion":1,"profile":{"name":"Smile Clinic","domain":"https://smile.example"},"plan":"Free","scope":{"includeSubdomains":false},"language":"uk"}';
const LEGACY_ID = 'legacy-language-proof';
function goldenOf(request: import('@fluxradar/ai').AiRequest): Golden {
  const prompt = buildPrompt(request).promptText;
  return {
    systemDigest: createHash('sha256').update(request.systemInstructions).digest('hex'),
    requestDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    promptDigest: createHash('sha256').update(prompt).digest('hex'),
    key: aiRequestKey(
      request.scanId,
      request.provider,
      prompt,
      request.sequence,
      request.keyIdentity,
    ),
  };
}
it.each([
  ['en', LEGACY_FREE_EN],
  ['uk', LEGACY_FREE_UK],
] as const)(
  'pins historical Free %s question and judge bytes and keys to f3986480',
  (language, snapshot) => {
    const config = storedExecutionConfig(snapshot);
    expect(config?.aiLanguage).toBeUndefined();
    const request = freeGeoRequests(
      LEGACY_ID,
      'Smile Clinic',
      'smile.example',
      config?.aiLanguage ?? config?.language ?? 'en',
    )[0];
    if (request === undefined) throw new Error('missing historical Free request');
    expect(goldenOf(request)).toEqual(LEGACY.records[`free-${language}`]);
    const judge = buildGeoEvaluationRequest({
      scanId: LEGACY_ID,
      parentAiRequestKey: 'legacy-parent',
      purpose: 'closed-book',
      question: request.question,
      answer: TEXT[language].answer,
      evidence: EVIDENCE,
      index: 1,
      judgeTone: true,
      ...(language === 'en' ? {} : { language }),
    });
    expect(goldenOf(judge)).toEqual(LEGACY.records[`free-${language}-judge`]);
  },
);
it('pins historical paid generator, all questions and judge bytes and keys to f3986480', async () => {
  const config = storedExecutionConfig(LEGACY_PAID);
  if (config === null) throw new Error('invalid historical snapshot');
  expect(config.aiLanguage).toBeUndefined();
  const provider = mockRoutingProvider(
    [
      {
        questionIncludes: 'Generate neutral discovery questions',
        response: {
          status: 'completed',
          output_text: JSON.stringify({ questions: TEXT.en.discovery }),
        },
      },
    ],
    ['anthropic'],
  );
  const send = vi.spyOn(provider, 'send');
  const generation = await generateGeoDiscoveryQuestions({
    scanId: LEGACY_ID,
    brand: config.profile.name,
    siteHostname: 'smile.example',
    context: config.profile,
    language: config.aiLanguage,
    consent: {
      scanId: LEGACY_ID,
      providers: ['anthropic'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    },
    provider,
    quota: AiQuotaTracker.withLimit(30),
  });
  const generator = send.mock.calls[0]?.[0];
  if (generator === undefined) throw new Error('historical generator was not called');
  expect(goldenOf(generator)).toEqual(LEGACY.records['paid-generator']);
  const requests = buildGeoRequests(
    LEGACY_ID,
    config.profile.name,
    'smile.example',
    generation.questions,
    ['anthropic'],
    config.aiLanguage,
  );
  expect(requests).toHaveLength(4);
  requests.forEach((request, index) =>
    expect(goldenOf(request)).toEqual(LEGACY.records[`paid-${index + 1}`]),
  );
  const first = requests[0];
  if (first === undefined) throw new Error('missing historical paid question');
  expect(
    goldenOf(
      buildGeoEvaluationRequest({
        scanId: LEGACY_ID,
        parentAiRequestKey: 'legacy-parent',
        purpose: 'closed-book',
        question: first.question,
        answer: TEXT.en.answer,
        evidence: EVIDENCE,
        index: 1,
        judgeTone: true,
      }),
    ),
  ).toEqual(LEGACY.records['paid-judge']);
});
