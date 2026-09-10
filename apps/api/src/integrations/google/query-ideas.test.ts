// The prompt, and what is allowed out of the model's answer.
//
// A block of AI-written queries sitting under a table of measured ones is one
// careless step away from looking like more of the same data, so most of this
// file is about what gets thrown away: invented metrics, ideas that repeat rows
// Search Console already measured, duplicates, unbounded lists and anything
// that is not the agreed JSON shape.

import type { AiProvider, NormalizedAiResponse } from '@fluxradar/ai';
import { describe, expect, it } from 'vitest';

import {
  MAX_CONTEXT_ROWS,
  MAX_IDEAS_PER_LANGUAGE,
  QUERY_IDEAS_PROMPT_VERSION,
  QUERY_IDEAS_SYSTEM_INSTRUCTIONS,
  buildQueryIdeasRequest,
  createQueryIdeasProvider,
  generateQueryIdeas,
  parseQueryIdeas,
} from './query-ideas.ts';
import type { SearchConsoleRow } from './types.ts';

function row(key: string, clicks = 10): SearchConsoleRow {
  return { key, clicks, impressions: clicks * 20, ctr: 0.05, position: 8.4 };
}

const INPUT = {
  scanId: 'scan-1',
  siteUrl: 'https://example.com',
  brand: 'Example',
  measuredQueries: [row('site audit'), row('website checker')],
  measuredPages: [row('https://example.com/pricing')],
};

function answer(ideas: unknown): string {
  return JSON.stringify({ ideas });
}

/** A provider that returns exactly the text it was built with. */
function providerReturning(rawText: string): AiProvider {
  return {
    config: {
      provider: 'anthropic',
      apiVersion: '2023-06-01',
      modelId: 'claude-sonnet-5',
      timeoutMs: 1000,
      maxRetries: 1,
    },
    send: (): Promise<NormalizedAiResponse> =>
      Promise.resolve({
        provider: 'anthropic',
        apiVersion: '2023-06-01',
        modelId: 'claude-sonnet-5',
        requestId: 'req-1',
        requestIdSource: 'provider',
        createdAt: '2026-09-08T00:00:00.000Z',
        rawText,
        citations: [],
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        usageSource: 'provider',
        finishReason: 'stop',
      }),
  };
}

const now = (): Date => new Date('2026-09-08T12:00:00.000Z');

describe('the prompt', () => {
  it('asks for all three languages and pins its own version', () => {
    const request = buildQueryIdeasRequest(INPUT);

    expect(request.promptVersion).toBe(QUERY_IDEAS_PROMPT_VERSION);
    expect(request.provider).toBe('anthropic');
    expect(request.scanId).toBe('scan-1');
    expect(request.question).toMatch(/Russian, Ukrainian and English/);
    expect(request.systemInstructions).toBe(QUERY_IDEAS_SYSTEM_INSTRUCTIONS);
  });

  it('forbids the model from returning anything that looks like a measurement', () => {
    expect(QUERY_IDEAS_SYSTEM_INSTRUCTIONS).toMatch(/Never include click counts/);
    expect(QUERY_IDEAS_SYSTEM_INSTRUCTIONS).toMatch(/Never repeat a query that already appears/);
    expect(QUERY_IDEAS_SYSTEM_INSTRUCTIONS).toMatch(/single JSON object and nothing else/);
  });

  it('shows the measured rows as context, clearly labelled as already measured', () => {
    const request = buildQueryIdeasRequest(INPUT);

    expect(request.brandFacts).toContain('The site is https://example.com');
    expect(
      request.brandFacts.some((fact) => fact.includes('Already measured query: "site audit"')),
    ).toBe(true);
    expect(request.pageTitles).toEqual(['https://example.com/pricing']);
  });

  it('adds saved profile context so ideas are domain-specific', () => {
    const request = buildQueryIdeasRequest({
      ...INPUT,
      profileContext: {
        industry: 'Dental clinic',
        region: 'Kyiv',
        offerings: 'implants and emergency appointments',
        targetAudience: 'families',
        targetLanguages: 'Ukrainian, English',
      },
    });

    expect(request.brandFacts).toContain('Business/site type: Dental clinic');
    expect(request.brandFacts).toContain('Operating region: Kyiv');
    expect(request.brandFacts).toContain(
      'Services or products: implants and emergency appointments',
    );
    expect(request.systemInstructions).toContain("specific to the site's domain");
  });

  it('bounds the context so a large property cannot build an unbounded prompt', () => {
    const many = Array.from({ length: 100 }, (_unused, index) => row(`query ${index}`));
    const request = buildQueryIdeasRequest({
      ...INPUT,
      measuredQueries: many,
      measuredPages: many,
    });

    // Two site facts plus the capped rows.
    expect(request.brandFacts).toHaveLength(MAX_CONTEXT_ROWS + 2);
    expect(request.pageTitles).toHaveLength(MAX_CONTEXT_ROWS);
  });
});

describe('what survives validation', () => {
  it('keeps well-formed ideas in all three languages', () => {
    const ideas = parseQueryIdeas(
      answer([
        { query: 'аудит сайта', language: 'ru', rationale: 'Russian buyers search this.' },
        { query: 'аудит сайту', language: 'uk', rationale: 'Ukrainian buyers search this.' },
        { query: 'seo audit tool', language: 'en', rationale: 'English buyers search this.' },
      ]),
      INPUT.measuredQueries,
    );

    expect(ideas.map((idea) => idea.language)).toEqual(['ru', 'uk', 'en']);
    expect(ideas[0]?.query).toBe('аудит сайта');
  });

  it('reads the object out of an answer wrapped in prose or a code fence', () => {
    const wrapped = `Sure! Here you go:\n\`\`\`json\n${answer([
      { query: 'site checker', language: 'en', rationale: 'Close to what already ranks.' },
    ])}\n\`\`\`\nHope that helps.`;

    expect(parseQueryIdeas(wrapped)).toHaveLength(1);
  });

  // The rule that keeps hypotheses out of the measured rows: an idea the site
  // already ranks for would be indistinguishable from a Search Console row.
  it('drops an idea that repeats a query Search Console already measured', () => {
    const ideas = parseQueryIdeas(
      answer([
        { query: 'Site Audit', language: 'en', rationale: 'Already measured, differently cased.' },
        { query: 'audit my website', language: 'en', rationale: 'Genuinely new.' },
      ]),
      INPUT.measuredQueries,
    );

    expect(ideas.map((idea) => idea.query)).toEqual(['audit my website']);
  });

  it('drops a duplicate however it is cased or spaced', () => {
    const ideas = parseQueryIdeas(
      answer([
        { query: 'audit my website', language: 'en', rationale: 'First.' },
        { query: '  Audit My Website  ', language: 'en', rationale: 'Same thing again.' },
      ]),
    );

    expect(ideas).toHaveLength(1);
  });

  it('drops a "query" that is only a number, however the model dressed it up', () => {
    const ideas = parseQueryIdeas(
      answer([
        { query: '1,234', language: 'en', rationale: 'Clicks, not a query.' },
        { query: '12.3%', language: 'en', rationale: 'A CTR, not a query.' },
        { query: 'real query', language: 'en', rationale: 'A query.' },
      ]),
    );

    expect(ideas.map((idea) => idea.query)).toEqual(['real query']);
  });

  it('caps each language independently so one cannot fill the block', () => {
    const flood = Array.from({ length: 30 }, (_unused, index) => ({
      query: `english idea ${index}`,
      language: 'en',
      rationale: 'Flood.',
    }));
    const ideas = parseQueryIdeas(
      answer([...flood, { query: 'українська ідея', language: 'uk', rationale: 'Still gets in.' }]),
    );

    expect(ideas.filter((idea) => idea.language === 'en')).toHaveLength(MAX_IDEAS_PER_LANGUAGE);
    expect(ideas.filter((idea) => idea.language === 'uk')).toHaveLength(1);
  });

  it('rejects an unknown language rather than showing it unlabelled', () => {
    expect(
      parseQueryIdeas(answer([{ query: 'idea', language: 'de', rationale: 'German.' }])),
    ).toEqual([]);
  });

  it('rejects an empty rationale, a blank query and an over-long one', () => {
    const ideas = parseQueryIdeas(
      answer([
        { query: 'no reason given', language: 'en', rationale: '   ' },
        { query: ' ', language: 'en', rationale: 'Blank query.' },
        { query: 'x'.repeat(200), language: 'en', rationale: 'Too long to be a query.' },
      ]),
    );

    expect(ideas).toEqual([]);
  });

  it('truncates a rationale that runs on instead of letting it break the row', () => {
    const ideas = parseQueryIdeas(
      answer([{ query: 'idea', language: 'en', rationale: 'y'.repeat(1000) }]),
    );

    expect(ideas[0]?.rationale.length).toBeLessThanOrEqual(220);
  });

  it('collapses a multi-line answer into one line per cell', () => {
    const ideas = parseQueryIdeas(
      answer([{ query: 'two\nline\tquery', language: 'en', rationale: 'a\n\nb' }]),
    );

    expect(ideas[0]?.query).toBe('two line query');
    expect(ideas[0]?.rationale).toBe('a b');
  });

  it('returns nothing at all for an answer that is not the agreed shape', () => {
    expect(parseQueryIdeas('I cannot help with that.')).toEqual([]);
    expect(parseQueryIdeas('{ not json')).toEqual([]);
    expect(parseQueryIdeas(answer('a string, not a list'))).toEqual([]);
    expect(parseQueryIdeas(JSON.stringify({ suggestions: [] }))).toEqual([]);
    expect(parseQueryIdeas('')).toEqual([]);
  });
});

describe('generating', () => {
  it('reports the ideas, the model that wrote them and when', async () => {
    const result = await generateQueryIdeas(INPUT, {
      provider: providerReturning(
        answer([
          { query: 'аудит сайта', language: 'ru', rationale: 'Russian buyers search this.' },
        ]),
      ),
      now,
    });

    expect(result).toEqual({
      state: 'generated',
      ideas: [{ query: 'аудит сайта', language: 'ru', rationale: 'Russian buyers search this.' }],
      model: 'claude-sonnet-5',
      generatedAt: '2026-09-08T12:00:00.000Z',
    });
  });

  it('says the deployment has no provider rather than pretending it failed', async () => {
    expect(await generateQueryIdeas(INPUT, { provider: null, now })).toEqual({
      state: 'not_configured',
    });
  });

  it('does not ask the model when there is no measured data to work from', async () => {
    let asked = false;
    const provider = providerReturning(answer([]));
    const spy: AiProvider = {
      config: provider.config,
      send: (request, promptText) => {
        asked = true;
        return provider.send(request, promptText);
      },
    };

    const result = await generateQueryIdeas(
      { ...INPUT, measuredQueries: [] },
      { provider: spy, now },
    );

    expect(result).toEqual({ state: 'unavailable' });
    expect(asked).toBe(false);
  });

  it('can generate profile-based ideas even when Search Console has no rows', async () => {
    const result = await generateQueryIdeas(
      {
        ...INPUT,
        measuredQueries: [],
        measuredPages: [],
        profileContext: { industry: 'Dental clinic', region: 'Kyiv' },
      },
      {
        provider: providerReturning(
          answer([
            {
              query: 'best dentist in Kyiv',
              language: 'en',
              rationale: 'Matches the saved industry and region.',
            },
          ]),
        ),
        now,
      },
    );

    expect(result).toMatchObject({ state: 'generated' });
  });

  it('reports an answer that produced nothing usable as empty, not as ideas', async () => {
    const result = await generateQueryIdeas(INPUT, {
      provider: providerReturning('I would rather not.'),
      now,
    });

    expect(result).toEqual({ state: 'empty' });
  });

  it('degrades to failed without leaking what the provider said', async () => {
    const exploding: AiProvider = {
      config: providerReturning('').config,
      send: () => Promise.reject(new Error('Anthropic HTTP 429 for org_secret_12345')),
    };

    const result = await generateQueryIdeas(INPUT, { provider: exploding, now });

    expect(result).toEqual({ state: 'failed' });
    expect(JSON.stringify(result)).not.toMatch(/org_secret|429/);
  });

  it('sends the redacted prompt, never the raw one', async () => {
    let sent = '';
    const capture: AiProvider = {
      config: providerReturning('').config,
      send: (_request, promptText) => {
        sent = promptText;
        return providerReturning(answer([])).send(_request, promptText);
      },
    };

    await generateQueryIdeas(
      { ...INPUT, measuredQueries: [row('contact owner@example.com')] },
      { provider: capture, now },
    );

    expect(sent).not.toContain('owner@example.com');
    expect(sent).toContain('[REDACTED:email]');
  });
});

describe('provider configuration', () => {
  it('is absent when this deployment has no API key', () => {
    expect(createQueryIdeasProvider({} as NodeJS.ProcessEnv)).toBeNull();
  });

  // Production refuses to boot on a retired model; if one ever reached here the
  // honest answer is still "no provider", not a request that cannot succeed.
  it('is absent when the configured model is one this release will not use', () => {
    expect(
      createQueryIdeasProvider({
        ANTHROPIC_API_KEY: 'sk-test',
        ANTHROPIC_MODEL: 'claude-2.1',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('is present, on the configured model, when a key is set', () => {
    const provider = createQueryIdeasProvider({
      ANTHROPIC_API_KEY: 'sk-test',
    } as NodeJS.ProcessEnv);

    expect(provider?.config.provider).toBe('anthropic');
    expect(provider?.config.modelId).toBe('claude-sonnet-5');
  });
});
