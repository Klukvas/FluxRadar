// Per-engine visibility summary (T6): pure computation over GeoModuleResult's
// outcomes and mention signals — no provider call, so every case here is a
// fixture assembled by hand or through geoMentionSignals.

import { describe, expect, it } from 'vitest';

import {
  computeGeoMentionContexts,
  computeGeoVisibilitySummaries,
  GEO_MENTION_CONTEXT_MAX_CHARS,
} from './geo-visibility-summary.js';
import { geoMentionSignals } from './geo-rules.js';
import type { GeoRuleInput } from './geo-rules.js';
import {
  BRAND,
  DOMAIN,
  makeRequest,
  makeResponse,
  makeResponseOutcome,
  makeUnavailableOutcome,
  ORIGIN,
} from './testing/harness.js';
import type { AiRequestOutcome } from './run-request.js';

function ruleInput(outcomes: readonly AiRequestOutcome[]): GeoRuleInput {
  return { domain: DOMAIN, siteUrl: ORIGIN, brand: BRAND, outcomes };
}

function summarize(outcomes: readonly AiRequestOutcome[]) {
  const mentions = geoMentionSignals(ruleInput(outcomes));
  return computeGeoVisibilitySummaries({ outcomes, mentions, siteDomain: DOMAIN });
}

const closedBookMentioned = makeResponseOutcome({
  request: makeRequest({
    provider: 'openai',
    sequence: 1,
    promptVersion: 'geo-questions-v5-closed-book',
    question: 'What do you know about this business?',
  }),
  response: makeResponse({
    rawText: `${BRAND} is a solid option — see https://${DOMAIN}/pricing for details.`,
    citations: [`https://${DOMAIN}/pricing`],
  }),
});

const closedBookNotMentioned = makeResponseOutcome({
  request: makeRequest({
    provider: 'openai',
    sequence: 2,
    promptVersion: 'geo-questions-v5-closed-book',
    question: 'What are alternatives to manual audits?',
  }),
  response: makeResponse({
    rawText: 'Popular vendors include Acme Audit and Globex Scanner, see https://acme.example/.',
    citations: ['https://acme.example/'],
  }),
});

const discoveryMentioned = makeResponseOutcome({
  request: makeRequest({
    provider: 'openai',
    sequence: 3,
    promptVersion: 'geo-questions-v5-discovery',
    question: 'Which providers match this audience?',
  }),
  response: makeResponse({
    rawText: `${BRAND} could be relevant — https://${DOMAIN}/.`,
    citations: [`https://${DOMAIN}/`],
  }),
});

describe('computeGeoVisibilitySummaries', () => {
  it('splits counts and shares by purpose, and scores a provider with enough answers', () => {
    const outcomes = [closedBookMentioned, closedBookNotMentioned, discoveryMentioned];
    const [summary] = summarize(outcomes);
    expect(summary?.provider).toBe('openai');
    expect(summary?.questionsAsked).toBe(3);
    expect(summary?.questionsAnswered).toBe(3);
    expect(summary?.questionsUnavailable).toBe(0);
    expect(summary?.brandMentionedCount).toBe(2);
    expect(summary?.domainCitedCount).toBe(2);
    expect(summary?.brandMentionedShare).toBeCloseTo(2 / 3);
    expect(summary?.domainCitedShare).toBeCloseTo(2 / 3);
    // fewer than GEO_VISIBILITY_MIN_ANSWERED_FOR_SCORE (3) answered → still scored at exactly 3.
    expect(summary?.visibilityScore).toBe(Math.round(100 * (0.6 * (2 / 3) + 0.4 * (2 / 3))));
    expect(summary?.byPurpose['closed-book']).toEqual({
      asked: 2,
      answered: 2,
      brandMentioned: 1,
      domainMentioned: 1,
    });
    expect(summary?.byPurpose.discovery).toEqual({
      asked: 1,
      answered: 1,
      brandMentioned: 1,
      domainMentioned: 1,
    });
  });

  it('gives no score with fewer than 3 answered questions, but keeps the counts', () => {
    const [summary] = summarize([closedBookMentioned]);
    expect(summary?.questionsAnswered).toBe(1);
    expect(summary?.visibilityScore).toBeNull();
    expect(summary?.brandMentionedCount).toBe(1);
  });

  it('excludes a provider that never answered', () => {
    const summaries = summarize([
      makeUnavailableOutcome({ request: makeRequest({ provider: 'google' }) }),
    ]);
    expect(summaries).toEqual([]);
  });

  it('counts an unavailable request against the provider that did answer elsewhere', () => {
    const unavailable = makeUnavailableOutcome({
      request: makeRequest({ provider: 'openai', sequence: 4 }),
    });
    const [summary] = summarize([closedBookMentioned, unavailable]);
    expect(summary?.questionsAsked).toBe(2);
    expect(summary?.questionsAnswered).toBe(1);
    expect(summary?.questionsUnavailable).toBe(1);
  });

  it('orders providers deterministically (AI_PROVIDER_NAMES order), regardless of outcome order', () => {
    const openai = closedBookMentioned;
    const anthropic = makeResponseOutcome({
      request: makeRequest({ provider: 'anthropic', sequence: 1 }),
    });
    const summaries = summarize([openai, anthropic]);
    expect(summaries.map((summary) => summary.provider)).toEqual(['anthropic', 'openai']);
  });

  describe('cited instead', () => {
    it('ranks hostnames by distinct answers citing them', () => {
      const firstAnswer = makeResponseOutcome({
        request: makeRequest({ provider: 'openai', sequence: 1, question: 'alt1' }),
        response: makeResponse({
          rawText: 'See acme.example and beta.example.',
          citations: ['https://acme.example/', 'https://beta.example/'],
        }),
      });
      const secondMentionOfAcme = makeResponseOutcome({
        request: makeRequest({ provider: 'openai', sequence: 2, question: 'alt2' }),
        response: makeResponse({
          rawText: 'Consider acme.example again.',
          citations: ['https://acme.example/'],
        }),
      });
      const thirdAnswered = makeResponseOutcome({
        request: makeRequest({ provider: 'openai', sequence: 3, question: 'alt3' }),
        response: makeResponse({ rawText: 'No alternatives found.', citations: [] }),
      });
      const [summary] = summarize([firstAnswer, secondMentionOfAcme, thirdAnswered]);
      expect(summary?.citedInstead).toEqual([
        { hostname: 'acme.example', answerCount: 2 },
        { hostname: 'beta.example', answerCount: 1 },
      ]);
    });

    it('excludes our own hostname and its subdomains from what could ever be listed', () => {
      // A citation matching our own domain already makes the domain signal
      // `mentioned` (geo-rules.ts), so such an answer never reaches "cited
      // instead" at all — this pins that invariant rather than a reachable branch.
      const ownDomainCited = makeResponseOutcome({
        request: makeRequest({ provider: 'openai', sequence: 1, question: 'alt1' }),
        response: makeResponse({
          rawText: `See docs.${DOMAIN} for details.`,
          citations: [`https://docs.${DOMAIN}/`],
        }),
      });
      const [summary] = summarize([ownDomainCited]);
      expect(summary?.citedInstead).toEqual([]);
    });

    it('excludes answers where the domain was cited', () => {
      const [summary] = summarize([closedBookMentioned]);
      expect(summary?.citedInstead).toEqual([]);
    });

    it('excludes answers where the domain signal was not measurable', () => {
      const namedInQuestion = makeResponseOutcome({
        request: makeRequest({
          provider: 'openai',
          sequence: 1,
          question: `Tell me about ${DOMAIN}.`,
        }),
        response: makeResponse({
          rawText: 'It cites https://acme.example/ instead.',
          citations: ['https://acme.example/'],
        }),
      });
      const [summary] = summarize([namedInQuestion]);
      expect(summary?.citedInstead).toEqual([]);
    });

    it('deduplicates a hostname cited twice within the same answer to one answer-count', () => {
      const repeated = makeResponseOutcome({
        request: makeRequest({ provider: 'openai', sequence: 1, question: 'alt' }),
        response: makeResponse({
          rawText: 'Try acme.example, or again acme.example.',
          citations: ['https://acme.example/', 'https://acme.example/pricing'],
        }),
      });
      const [summary] = summarize([repeated]);
      expect(summary?.citedInstead).toEqual([{ hostname: 'acme.example', answerCount: 1 }]);
    });

    it('caps at 10 hostnames', () => {
      const outcomes = Array.from({ length: 12 }, (_, index) =>
        makeResponseOutcome({
          request: makeRequest({
            provider: 'openai',
            sequence: index + 1,
            question: `alt${index}`,
          }),
          response: makeResponse({
            rawText: `See vendor${index}.example.`,
            citations: [`https://vendor${index}.example/`],
          }),
        }),
      );
      const [summary] = summarize(outcomes);
      expect(summary?.citedInstead).toHaveLength(10);
    });
  });

  it('is deterministic: the same input computed twice gives the same output', () => {
    const outcomes = [closedBookMentioned, closedBookNotMentioned, discoveryMentioned];
    expect(summarize(outcomes)).toEqual(summarize(outcomes));
  });
});

describe('computeGeoMentionContexts', () => {
  function contexts(outcomes: readonly AiRequestOutcome[]) {
    const mentions = geoMentionSignals(ruleInput(outcomes));
    return computeGeoMentionContexts({ outcomes, mentions, brand: BRAND });
  }

  it('quotes the sentence containing the first brand mention', () => {
    const outcome = makeResponseOutcome({
      request: makeRequest({ sequence: 1 }),
      response: makeResponse({
        rawText: `First, some setup. ${BRAND} is a solid option for small teams. Then more text.`,
        citations: [],
      }),
    });
    const result = contexts([outcome]);
    expect(result.get(outcome.aiRequestKey)).toBe(`${BRAND} is a solid option for small teams.`);
  });

  it('has no entry for an answer that never mentions the brand', () => {
    const result = contexts([closedBookNotMentioned]);
    expect(result.has(closedBookNotMentioned.aiRequestKey)).toBe(false);
  });

  it('has no entry when the question already named the brand', () => {
    const namedInQuestion = makeResponseOutcome({
      request: makeRequest({ sequence: 1, question: `What do you know about ${BRAND}?` }),
      response: makeResponse({ rawText: `${BRAND} is well known.`, citations: [] }),
    });
    const result = contexts([namedInQuestion]);
    expect(result.has(namedInQuestion.aiRequestKey)).toBe(false);
  });

  it('bounds the quote to GEO_MENTION_CONTEXT_MAX_CHARS', () => {
    const longSentence = `${BRAND} ${'is a very thorough audit platform '.repeat(20)}done.`;
    const outcome = makeResponseOutcome({
      request: makeRequest({ sequence: 1 }),
      response: makeResponse({ rawText: longSentence, citations: [] }),
    });
    const result = contexts([outcome]);
    expect([...(result.get(outcome.aiRequestKey) ?? '')].length).toBeLessThanOrEqual(
      GEO_MENTION_CONTEXT_MAX_CHARS,
    );
  });

  it('redacts the quote the same way evidence is redacted', () => {
    const outcome = makeResponseOutcome({
      request: makeRequest({ sequence: 1 }),
      response: makeResponse({
        rawText: `${BRAND} was reached at owner@example.com for verification.`,
        citations: [],
      }),
    });
    const result = contexts([outcome]);
    expect(result.get(outcome.aiRequestKey)).toContain('[REDACTED:email]');
    expect(result.get(outcome.aiRequestKey)).not.toContain('owner@example.com');
  });
});
