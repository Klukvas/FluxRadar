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

function ruleInput(
  outcomes: readonly AiRequestOutcome[],
  overrides: Partial<GeoRuleInput> = {},
): GeoRuleInput {
  return { domain: DOMAIN, siteUrl: ORIGIN, brand: BRAND, outcomes, ...overrides };
}

/** One answered discovery-style question, spelled out where the wording matters. */
function answer(input: {
  sequence: number;
  question: string;
  rawText: string;
  citations?: readonly string[];
}): AiRequestOutcome {
  return makeResponseOutcome({
    request: makeRequest({
      provider: 'openai',
      sequence: input.sequence,
      promptVersion: 'geo-questions-v5-discovery',
      question: input.question,
    }),
    response: makeResponse({ rawText: input.rawText, citations: [...(input.citations ?? [])] }),
  });
}

function summarize(outcomes: readonly AiRequestOutcome[], competitors?: readonly string[]) {
  const mentions = geoMentionSignals(ruleInput(outcomes));
  return computeGeoVisibilitySummaries({
    outcomes,
    mentions,
    siteDomain: DOMAIN,
    brand: BRAND,
    ...(competitors === undefined ? {} : { competitors }),
  });
}

/** One answered closed-book question — its badges are never shown to the reader. */
function closedBook(question: string, sequence: number, rawText: string): AiRequestOutcome {
  return makeResponseOutcome({
    request: makeRequest({
      provider: 'openai',
      sequence,
      promptVersion: 'geo-questions-v5-closed-book',
      question,
    }),
    response: makeResponse({ rawText, citations: [] }),
  });
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

const discoveryNotMentioned = makeResponseOutcome({
  request: makeRequest({
    provider: 'openai',
    sequence: 4,
    promptVersion: 'geo-questions-v5-discovery',
    question: 'What tools handle audits?',
  }),
  response: makeResponse({
    rawText: 'Acme Audit and Globex are common picks.',
    citations: ['https://acme.example/'],
  }),
});

describe('computeGeoVisibilitySummaries', () => {
  it('splits counts and shares by purpose, and scores a provider with enough answers', () => {
    const outcomes = [
      closedBookMentioned,
      closedBookNotMentioned,
      discoveryMentioned,
      discoveryNotMentioned,
    ];
    const [summary] = summarize(outcomes);
    expect(summary?.provider).toBe('openai');
    expect(summary?.questionsAsked).toBe(4);
    expect(summary?.questionsAnswered).toBe(4);
    expect(summary?.questionsUnavailable).toBe(0);
    // Closed-book answers are excluded from the top-level counts: their badge
    // pair is never shown (GeoObservationCard hides it for that purpose), so
    // they cannot be part of a denominator the reader is shown alongside.
    expect(summary?.brandMentionedCount).toBe(1);
    expect(summary?.domainCitedCount).toBe(1);
    expect(summary?.brandMentionedShare).toBeCloseTo(0.5);
    expect(summary?.domainCitedShare).toBeCloseTo(0.5);
    // Exactly GEO_VISIBILITY_MIN_MEASURED_FOR_SIGNAL (2) measured answers per
    // signal — the query generator's own discovery floor, and the lowest
    // input that earns a score at all.
    expect(summary?.brandMeasuredCount).toBe(2);
    expect(summary?.domainMeasuredCount).toBe(2);
    expect(summary?.scoreUnavailableReason).toBeNull();
    expect(summary?.scoreBasis).toBe('brand-and-domain');
    expect(summary?.visibilityScore).toBe(Math.round(100 * (0.6 * 0.5 + 0.4 * 0.5)));
    expect(summary?.byPurpose['closed-book']).toEqual({
      asked: 2,
      answered: 2,
      brandMeasured: 2,
      domainMeasured: 2,
      brandMentioned: 1,
      domainMentioned: 1,
    });
    expect(summary?.byPurpose.discovery).toEqual({
      asked: 2,
      answered: 2,
      brandMeasured: 2,
      domainMeasured: 2,
      brandMentioned: 1,
      domainMentioned: 1,
    });
  });

  it('excludes closed-book answers from the top-level counts entirely', () => {
    // byPurpose still records what happened on the closed-book question (for
    // the observation cards' own bookkeeping); the summary's own counts, the
    // ones a share divides by, do not, so there is nothing left to score.
    const [summary] = summarize([closedBookMentioned]);
    expect(summary?.questionsAnswered).toBe(1);
    expect(summary?.brandMeasuredCount).toBe(0);
    expect(summary?.domainMeasuredCount).toBe(0);
    expect(summary?.visibilityScore).toBeNull();
    expect(summary?.scoreBasis).toBeNull();
    expect(summary?.scoreUnavailableReason).toBe('not-measurable');
    expect(summary?.byPurpose['closed-book']).toEqual({
      asked: 1,
      answered: 1,
      brandMeasured: 1,
      domainMeasured: 1,
      brandMentioned: 1,
      domainMentioned: 1,
    });
  });

  it('gives no score with fewer than 2 measured answers, but keeps the counts', () => {
    const [summary] = summarize([discoveryMentioned]);
    expect(summary?.questionsAnswered).toBe(1);
    expect(summary?.visibilityScore).toBeNull();
    expect(summary?.scoreBasis).toBeNull();
    expect(summary?.scoreUnavailableReason).toBe('not-enough-measured');
    expect(summary?.brandMentionedCount).toBe(1);
    expect(summary?.brandMeasuredCount).toBe(1);
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

  it('refuses to summarise at all without a site domain', () => {
    const mentions = geoMentionSignals(ruleInput([closedBookMentioned]));
    expect(
      computeGeoVisibilitySummaries({
        outcomes: [closedBookMentioned],
        mentions,
        siteDomain: '   ',
        brand: BRAND,
      }),
    ).toEqual([]);
  });

  it('refuses to summarise at all without a brand', () => {
    // Symmetric with the siteDomain guard: with no brand, "mentioned" and
    // "not mentioned" cannot be told apart from "there was nothing to name",
    // and every answer would score as a miss for a brand that does not exist.
    const mentions = geoMentionSignals(ruleInput([closedBookMentioned]));
    expect(
      computeGeoVisibilitySummaries({
        outcomes: [closedBookMentioned],
        mentions,
        siteDomain: DOMAIN,
        brand: '   ',
      }),
    ).toEqual([]);
  });

  // The measurability contract: a signal the badges call "not measured" may
  // never land in a share's denominator as a miss (geo-measurability.ts).
  describe('measured answers, not answered questions, are the denominator', () => {
    function askedThreeWays(brand: string) {
      const outcomes = [
        answer({
          sequence: 1,
          question: `What do you know about ${brand}?`,
          rawText: `${brand} is a website audit platform.`,
        }),
        answer({
          sequence: 2,
          question: `What can you report about ${brand}?`,
          rawText: `${brand} publishes its methodology.`,
        }),
        answer({
          sequence: 3,
          question: 'Which audit tool would you suggest?',
          rawText: `${brand} is one option.`,
        }),
      ];
      const mentions = geoMentionSignals(ruleInput(outcomes, { brand }));
      return computeGeoVisibilitySummaries({ outcomes, mentions, siteDomain: DOMAIN, brand })[0];
    }

    it('does not deflate the brand share with answers whose question named the brand', () => {
      const summary = askedThreeWays(BRAND);
      // Three mentions, two of them in questions that said the brand first: one
      // measured answer, and it mentioned the brand. Dividing by three answers
      // reported 33/100 for perfect brand presence.
      expect(summary?.brandMeasuredCount).toBe(1);
      expect(summary?.brandMentionedCount).toBe(1);
      expect(summary?.brandMentionedShare).toBe(1);
      // None of the three questions name the domain, so all three measure it
      // (and never mention it) — enough on its own to earn a domain-only
      // score, which is the correct read: the domain genuinely went unfound
      // in every measurable answer.
      expect(summary?.domainMeasuredCount).toBe(3);
      expect(summary?.domainCitedShare).toBe(0);
      expect(summary?.scoreBasis).toBe('domain-only');
      expect(summary?.visibilityScore).toBe(0);
      expect(summary?.scoreUnavailableReason).toBeNull();
    });

    it('gives no score for an auto-named profile whose only other signal falls short too', () => {
      // `siteProfileNameFor` names a profile after its hostname, so brand and
      // domain are the same question asked twice and brand is never measured;
      // the domain fares only slightly better (measured once, in the one
      // question that never restated it), still short of the floor.
      const summary = askedThreeWays(DOMAIN);
      expect(summary?.brandMeasuredCount).toBe(0);
      expect(summary?.brandMentionedCount).toBe(0);
      expect(summary?.brandMentionedShare).toBeNull();
      expect(summary?.domainMeasuredCount).toBe(1);
      expect(summary?.scoreBasis).toBeNull();
      expect(summary?.visibilityScore).toBeNull();
      expect(summary?.scoreUnavailableReason).toBe('not-enough-measured');
    });

    it('reports "not measurable" only when neither signal was measured anywhere', () => {
      const outcomes = [
        answer({
          sequence: 1,
          question: `What do you know about ${DOMAIN}?`,
          rawText: `${DOMAIN} is a website audit platform.`,
        }),
      ];
      const mentions = geoMentionSignals(ruleInput(outcomes, { brand: DOMAIN }));
      const [summary] = computeGeoVisibilitySummaries({
        outcomes,
        mentions,
        siteDomain: DOMAIN,
        brand: DOMAIN,
      });
      expect(summary?.brandMeasuredCount).toBe(0);
      expect(summary?.domainMeasuredCount).toBe(0);
      expect(summary?.scoreBasis).toBeNull();
      expect(summary?.visibilityScore).toBeNull();
      expect(summary?.scoreUnavailableReason).toBe('not-measurable');
    });
  });

  it('computes the score from the exact shares, rounding only at the end', () => {
    // 1 brand mention in 7 measured answers: 60% × 1/7 = 8.57 → 9. Scoring off
    // the 2-decimal share (0.14) gave 8, contradicting the published formula.
    const outcomes = Array.from({ length: 7 }, (_, index) =>
      answer({
        sequence: index + 1,
        question: `Which audit tool would you suggest, option ${index}?`,
        rawText: index === 0 ? `${BRAND} is one option.` : 'Acme Audit is one option.',
      }),
    );
    const mentions = geoMentionSignals(ruleInput(outcomes));
    const [summary] = computeGeoVisibilitySummaries({
      outcomes,
      mentions,
      siteDomain: DOMAIN,
      brand: BRAND,
    });
    expect(summary?.brandMeasuredCount).toBe(7);
    expect(summary?.brandMentionedShare).toBe(0.14);
    expect(summary?.visibilityScore).toBe(Math.round(100 * 0.6 * (1 / 7)));
    expect(summary?.visibilityScore).toBe(9);
  });

  describe('citation hostnames', () => {
    function citedFor(citations: readonly string[]) {
      const outcome = answer({
        sequence: 1,
        question: 'Which audit tool would you suggest?',
        rawText: 'Acme Audit is one option.',
        citations,
      });
      const mentions = geoMentionSignals(ruleInput([outcome]));
      return computeGeoVisibilitySummaries({
        outcomes: [outcome],
        mentions,
        siteDomain: DOMAIN,
        brand: BRAND,
      })[0]?.citedInstead;
    }

    it('reads a trailing-dot hostname as the same entity as the dotless form', () => {
      expect(citedFor(['https://beta.example./a', 'https://beta.example/b'])).toEqual([
        { hostname: 'beta.example', answerCount: 1 },
      ]);
    });

    it('parses a scheme-less citation instead of dropping it', () => {
      expect(citedFor(['acme.example/pricing'])).toEqual([
        { hostname: 'acme.example', answerCount: 1 },
      ]);
    });

    it('still drops a citation that names no host at all', () => {
      expect(citedFor(['', '   '])).toEqual([]);
    });

    // Models sometimes write free text instead of a source, or a link scheme
    // that is not a bare host; the scheme-less fallback that recovers
    // `acme.example/pricing` must not also invent a fake single-label
    // hostname out of `"unknown"` or extract an email's domain from `mailto:`.
    it('drops free-text citations that are not real hostnames', () => {
      expect(
        citedFor([
          'N/A',
          'unknown',
          'localhost',
          'see above',
          'no source',
          'internal knowledge',
          '[1]',
          'Wikipedia',
        ]),
      ).toEqual([]);
    });

    it('drops mailto/tel/data citations rather than extracting an email domain', () => {
      expect(
        citedFor(['mailto:someone@example.com', 'tel:+380441234567', 'data:text/plain,hi']),
      ).toEqual([]);
    });

    it('drops path-only or fragment-only citations', () => {
      expect(citedFor(['/pricing', './docs', '#ref'])).toEqual([]);
    });

    // Third review round: the `@` guard must fire only on the scheme-less
    // fallback candidate. An absolute http(s) URL keeps its hostname even
    // when its path or userinfo contains `@` — that is not the "free text,
    // not a host" case the guard exists for.
    it('keeps an absolute URL whose path is a handle, even though it contains @', () => {
      expect(
        citedFor([
          'https://medium.com/@author',
          'https://threads.net/@x',
          'https://mastodon.social/@user',
        ]),
      ).toEqual([
        { hostname: 'mastodon.social', answerCount: 1 },
        { hostname: 'medium.com', answerCount: 1 },
        { hostname: 'threads.net', answerCount: 1 },
      ]);
    });

    it('keeps an absolute URL with userinfo, reading the host past the @', () => {
      expect(citedFor(['https://user:pass@acme.example/report'])).toEqual([
        { hostname: 'acme.example', answerCount: 1 },
      ]);
    });

    it('still drops a scheme-less mailto-shaped candidate as a bare host', () => {
      expect(citedFor(['someone@example.com'])).toEqual([]);
    });

    it('drops loopback, private, and link-local IPv4 citations, keeping a public one', () => {
      expect(
        citedFor([
          'http://127.0.0.1/x',
          'http://192.168.0.1/x',
          'http://169.254.1.1/x',
          'http://10.0.0.1/x',
          'ftp://acme.example/x',
          'https://acme.example/x',
        ]),
      ).toEqual([{ hostname: 'acme.example', answerCount: 1 }]);
    });

    it('drops 0.0.0.0 and other addresses in the 0.0.0.0/8 range', () => {
      expect(citedFor(['http://0.0.0.0/x', 'http://0.1.2.3/x'])).toEqual([]);
    });
  });

  describe('the per-signal scoring rule', () => {
    it('a realistic scan (2 closed-book + 2 discovery answers) earns a score from the discovery floor alone', () => {
      const outcomes = [
        closedBook(
          `What do you know about ${BRAND}?`,
          1,
          `${BRAND} is an audit tool. Its site is https://${DOMAIN}/.`,
        ),
        closedBook(
          `What independently verifiable facts can you report about ${BRAND}?`,
          2,
          `${BRAND} is an audit tool. Its site is https://${DOMAIN}/.`,
        ),
        answer({
          sequence: 3,
          question: 'Which audit tool is affordable for a small shop?',
          rawText: `${BRAND} and Acme are options.`,
        }),
        answer({
          sequence: 4,
          question: 'What tool finds duplicate content?',
          rawText: 'Acme and Globex are options.',
          citations: ['https://globex.example/'],
        }),
      ];
      const mentions = geoMentionSignals(ruleInput(outcomes));
      const [summary] = computeGeoVisibilitySummaries({
        outcomes,
        mentions,
        siteDomain: DOMAIN,
        brand: BRAND,
      });
      expect(summary?.brandMeasuredCount).toBe(2);
      expect(summary?.domainMeasuredCount).toBe(2);
      expect(summary?.brandMentionedShare).toBe(0.5);
      expect(summary?.domainCitedShare).toBe(0);
      expect(summary?.scoreBasis).toBe('brand-and-domain');
      expect(summary?.visibilityScore).toBe(Math.round(100 * (0.6 * 0.5 + 0.4 * 0)));
      expect(summary?.scoreUnavailableReason).toBeNull();
    });

    it('a third discovery answer keeps the same basis and updates the share', () => {
      const outcomes = [
        closedBook(`What do you know about ${BRAND}?`, 1, `${BRAND} is an audit tool.`),
        answer({
          sequence: 2,
          question: 'discovery question number 2',
          rawText: `${BRAND} and Acme are options.`,
          citations: ['https://acme.example/'],
        }),
        answer({
          sequence: 3,
          question: 'discovery question number 3',
          rawText: 'Acme and Globex are options.',
          citations: ['https://acme.example/'],
        }),
        answer({
          sequence: 4,
          question: 'discovery question number 4',
          rawText: 'Acme and Globex are options.',
          citations: ['https://acme.example/'],
        }),
      ];
      const mentions = geoMentionSignals(ruleInput(outcomes));
      const [summary] = computeGeoVisibilitySummaries({
        outcomes,
        mentions,
        siteDomain: DOMAIN,
        brand: BRAND,
      });
      expect(summary?.brandMeasuredCount).toBe(3);
      expect(summary?.domainMeasuredCount).toBe(3);
      expect(summary?.scoreBasis).toBe('brand-and-domain');
      expect(summary?.scoreUnavailableReason).toBeNull();
    });

    // A brand distinct from the domain, with neither name a substring of the
    // other (unlike BRAND/DOMAIN's "FluxRadar" / "fluxradar.test") — needed so
    // a question naming the domain does not incidentally also name the brand.
    const DISJOINT_BRAND = 'Acme';
    const DISJOINT_DOMAIN = 'other.test';

    function disjointMentions(outcomes: readonly AiRequestOutcome[]) {
      return geoMentionSignals({
        domain: DISJOINT_DOMAIN,
        siteUrl: `https://${DISJOINT_DOMAIN}`,
        brand: DISJOINT_BRAND,
        outcomes,
      });
    }

    it('renormalises to a single signal when only one reaches the minimum', () => {
      const outcomes = [
        ...[1, 2].map((sequence) =>
          answer({
            sequence,
            question: `Is ${DISJOINT_DOMAIN} any good, take ${sequence}?`,
            rawText: `${DISJOINT_BRAND} is fine.`,
          }),
        ),
        answer({
          sequence: 3,
          question: `What about ${DISJOINT_BRAND}?`,
          rawText: `It cites https://${DISJOINT_DOMAIN}/`,
          citations: [`https://${DISJOINT_DOMAIN}/`],
        }),
      ];
      const [summary] = computeGeoVisibilitySummaries({
        outcomes,
        mentions: disjointMentions(outcomes),
        siteDomain: DISJOINT_DOMAIN,
        brand: DISJOINT_BRAND,
      });
      // Brand measured twice (both questions named the domain, not the brand)
      // and mentioned both times; domain measured only once (its one question
      // named the brand instead) — below the floor, so the score is brand
      // alone, not brand blended with a domain signal that was barely asked.
      expect(summary?.brandMeasuredCount).toBe(2);
      expect(summary?.brandMentionedShare).toBe(1);
      expect(summary?.domainMeasuredCount).toBe(1);
      expect(summary?.scoreBasis).toBe('brand-only');
      expect(summary?.visibilityScore).toBe(100);
      expect(summary?.scoreUnavailableReason).toBeNull();
    });

    it('gives no score when neither signal reaches the minimum, and keeps both counts', () => {
      const outcomes = [
        answer({
          sequence: 1,
          question: `Is ${DISJOINT_DOMAIN} any good?`,
          rawText: `${DISJOINT_BRAND} is fine.`,
        }),
        answer({
          sequence: 2,
          question: `What about ${DISJOINT_BRAND}?`,
          rawText: `It cites https://${DISJOINT_DOMAIN}/`,
          citations: [`https://${DISJOINT_DOMAIN}/`],
        }),
      ];
      const [summary] = computeGeoVisibilitySummaries({
        outcomes,
        mentions: disjointMentions(outcomes),
        siteDomain: DISJOINT_DOMAIN,
        brand: DISJOINT_BRAND,
      });
      expect(summary?.brandMeasuredCount).toBe(1);
      expect(summary?.domainMeasuredCount).toBe(1);
      expect(summary?.scoreBasis).toBeNull();
      expect(summary?.visibilityScore).toBeNull();
      expect(summary?.scoreUnavailableReason).toBe('not-enough-measured');
    });
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

  // Model answers are list-heavy, so a newline is a sentence boundary far more
  // often than a full stop — and it has to be one at both ends of the quote.
  describe('sentence boundaries', () => {
    function quoteOf(rawText: string): string | undefined {
      const outcome = makeResponseOutcome({
        request: makeRequest({ sequence: 1 }),
        response: makeResponse({ rawText, citations: [] }),
      });
      return contexts([outcome]).get(outcome.aiRequestKey);
    }

    it('keeps the first character of a sentence that follows a newline', () => {
      expect(quoteOf(`Here are some options:\n${BRAND} is a solid option for small teams.`)).toBe(
        `${BRAND} is a solid option for small teams.`,
      );
    });

    it('stops the quote at the newline that ends a bullet', () => {
      expect(quoteOf(`Options:\n- Acme Audit\n- ${BRAND}, a pay-per-scan platform\n- Globex`)).toBe(
        `${BRAND}, a pay-per-scan platform`,
      );
    });

    it('does not start a sentence inside an abbreviation', () => {
      expect(quoteOf(`The clinic run by Dr. Smith recommends ${BRAND} for audits.`)).toBe(
        `The clinic run by Dr. Smith recommends ${BRAND} for audits.`,
      );
    });

    it('does not end a sentence inside an abbreviation either', () => {
      expect(quoteOf(`${BRAND} runs e.g. duplicate-content checks. Then more text.`)).toBe(
        `${BRAND} runs e.g. duplicate-content checks.`,
      );
    });

    it('keeps a closing quote that follows the full stop', () => {
      expect(quoteOf(`One reviewer wrote "${BRAND} is the best." Another disagreed.`)).toBe(
        `One reviewer wrote "${BRAND} is the best."`,
      );
    });

    // 'no' was dropped from the abbreviation list: a genuine sentence ending
    // in that word ("Some say no.") is common, and treating its full stop as
    // an abbreviation swallowed the entire sentence before it into the quote.
    it('does not treat a sentence ending in "no" as an abbreviation', () => {
      expect(quoteOf(`Some say no. ${BRAND} is cheap and fast. Others disagree.`)).toBe(
        `${BRAND} is cheap and fast.`,
      );
    });
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

  // Bounding before redacting could cut an email in half, leaving a fragment
  // no redaction pattern recognises; redacting first replaces the whole
  // address with its placeholder before the 240-char cut ever applies.
  it('redacts before bounding, so a cut can never leave half of a placeholder', () => {
    const pad = 'word '.repeat(40).slice(0, GEO_MENTION_CONTEXT_MAX_CHARS - 20 - BRAND.length);
    const rawText = `${BRAND} ${pad} reach me at johndoe@examplecorp.example please now and later on.`;
    const outcome = makeResponseOutcome({
      request: makeRequest({ sequence: 1 }),
      response: makeResponse({ rawText, citations: [] }),
    });
    const quote = contexts([outcome]).get(outcome.aiRequestKey) ?? '';
    expect(quote).not.toMatch(/johndoe|examplecorp|@exa/);
  });
});

// T7: share of voice — the brand's mentions against each configured
// competitor's, over the same brand-measurable-answer scope the brand's own
// share already uses.
describe('share of voice (T7)', () => {
  it('is null when no competitors are configured', () => {
    const [summary] = summarize([discoveryMentioned, discoveryNotMentioned]);
    expect(summary?.shareOfVoice).toBeNull();
  });

  it('is null when no competitors are configured, even with an empty array', () => {
    const [summary] = summarize([discoveryMentioned], []);
    expect(summary?.shareOfVoice).toBeNull();
  });

  it('divides brand and competitor mentions by their combined total', () => {
    const brandOnly = answer({
      sequence: 1,
      question: 'Which providers match this audience?',
      rawText: `${BRAND} could be relevant.`,
    });
    const competitorOnly = answer({
      sequence: 2,
      question: 'What tools handle audits?',
      rawText: 'Acme Audit is a common pick.',
    });
    const neither = answer({
      sequence: 3,
      question: 'What tools handle audits?',
      rawText: 'Globex Scanner is a common pick.',
    });
    const [summary] = summarize([brandOnly, competitorOnly, neither], ['Acme Audit']);
    expect(summary?.shareOfVoice).toEqual({
      denominator: 2,
      brandMentionsInScope: 1,
      brandShare: 0.5,
      competitors: [{ name: 'Acme Audit', mentionedCount: 1, share: 0.5 }],
    });
  });

  it('reports null shares (not zero) when nothing in scope was mentioned', () => {
    const neither = answer({
      sequence: 1,
      question: 'What tools handle audits?',
      rawText: 'Globex Scanner is a common pick.',
    });
    const [summary] = summarize([neither], ['Acme Audit']);
    expect(summary?.shareOfVoice).toEqual({
      denominator: 0,
      brandMentionsInScope: 0,
      brandShare: null,
      competitors: [{ name: 'Acme Audit', mentionedCount: 0, share: null }],
    });
  });

  it('excludes closed-book answers from the share-of-voice scope', () => {
    const closedBookBrand = closedBook(
      'What do you know about this business?',
      1,
      `${BRAND} is a solid option.`,
    );
    const [summary] = summarize([closedBookBrand], ['Acme Audit']);
    expect(summary?.shareOfVoice).toEqual({
      denominator: 0,
      brandMentionsInScope: 0,
      brandShare: null,
      competitors: [{ name: 'Acme Audit', mentionedCount: 0, share: null }],
    });
  });

  it('does not count a competitor the question itself already named', () => {
    const namedInQuestion = answer({
      sequence: 1,
      question: 'How does this compare to Acme Audit?',
      rawText: `${BRAND} is a solid option, better than the alternative.`,
    });
    const [summary] = summarize([namedInQuestion], ['Acme Audit']);
    // The brand was mentioned and measurable, so it is the sole entry in scope.
    expect(summary?.shareOfVoice).toEqual({
      denominator: 1,
      brandMentionsInScope: 1,
      brandShare: 1,
      competitors: [{ name: 'Acme Audit', mentionedCount: 0, share: 0 }],
    });
  });

  it('orders competitor rows by share desc, then name asc on a tie', () => {
    const mentionsAll = answer({
      sequence: 1,
      question: 'Which providers match this audience?',
      rawText: `${BRAND}, Beta Tools, and Acme Audit are all worth a look.`,
    });
    const [summary] = summarize([mentionsAll], ['Zeta Suite', 'Beta Tools', 'Acme Audit']);
    expect(summary?.shareOfVoice?.competitors.map((row) => row.name)).toEqual([
      'Acme Audit',
      'Beta Tools',
      'Zeta Suite',
    ]);
  });

  it('never influences visibilityScore', () => {
    const outcomes = [
      closedBookMentioned,
      closedBookNotMentioned,
      discoveryMentioned,
      discoveryNotMentioned,
    ];
    const withoutCompetitors = summarize(outcomes)[0];
    const withCompetitors = summarize(outcomes, ['Acme Audit', 'Globex'])[0];
    expect(withCompetitors?.visibilityScore).toBe(withoutCompetitors?.visibilityScore);
    expect(withCompetitors?.scoreBasis).toBe(withoutCompetitors?.scoreBasis);
    expect(withCompetitors?.brandMentionedShare).toBe(withoutCompetitors?.brandMentionedShare);
  });

  // T7-fix F1: a competitor name that is a substring of the brand ("Acme"
  // inside "Acme Dental") used to be counted as a competitor mention on every
  // answer that named the brand, halving the brand's own reported share.
  it('does not count a competitor name that is only a substring of the brand', () => {
    const brand = 'Acme Dental';
    const outcomes = [
      answer({
        sequence: 1,
        question: 'Which clinics offer implants in this city?',
        rawText: 'Acme Dental is well reviewed.',
      }),
      answer({
        sequence: 2,
        question: 'Which clinics offer implants in this city?',
        rawText: 'Acme Dental has good hygienists.',
      }),
    ];
    const mentions = geoMentionSignals({ domain: DOMAIN, siteUrl: ORIGIN, brand, outcomes });
    const [summary] = computeGeoVisibilitySummaries({
      outcomes,
      mentions,
      siteDomain: DOMAIN,
      brand,
      competitors: ['Acme'],
    });
    expect(summary?.shareOfVoice).toEqual({
      denominator: 2,
      brandMentionsInScope: 2,
      brandShare: 1,
      competitors: [{ name: 'Acme', mentionedCount: 0, share: 0 }],
    });
  });

  function shareOfVoiceFor(
    brand: string,
    competitors: readonly string[],
    outcomes: AiRequestOutcome[],
  ) {
    const mentions = geoMentionSignals({ domain: DOMAIN, siteUrl: ORIGIN, brand, outcomes });
    const [summary] = computeGeoVisibilitySummaries({
      outcomes,
      mentions,
      siteDomain: DOMAIN,
      brand,
      competitors,
    });
    return summary?.shareOfVoice;
  }

  // T7-fix2 N1: the mirror of F1 — a brand name that is a substring of a
  // matched competitor name ("Bolt" inside "Bolt Food") must not be counted
  // as a brand mention just because the competitor was named.
  it('does not count the brand when it only appears as a substring of a matched competitor (Bolt/Bolt Food)', () => {
    const outcomes = [
      answer({
        sequence: 1,
        question: 'Which delivery apps operate here?',
        rawText: 'Bolt Food delivers across the city.',
      }),
      answer({
        sequence: 2,
        question: 'Which delivery apps operate here?',
        rawText: 'Glovo and Bolt Food are the options.',
      }),
    ];
    expect(shareOfVoiceFor('Bolt', ['Bolt Food'], outcomes)).toEqual({
      denominator: 2,
      brandMentionsInScope: 0,
      brandShare: 0,
      competitors: [{ name: 'Bolt Food', mentionedCount: 2, share: 1 }],
    });
  });

  // T7-fix2 N1: the same rule still lets the brand count when it appears on
  // its own, outside any competitor span (Uber/Uber Eats).
  it('still counts the brand when it appears outside the competitor span (Uber/Uber Eats)', () => {
    const outcomes = [
      answer({
        sequence: 1,
        question: 'Which platforms deliver food?',
        rawText: 'Uber Eats delivers quickly.',
      }),
      answer({
        sequence: 2,
        question: 'Which platforms deliver food?',
        rawText: 'Uber is also a rideshare option.',
      }),
    ];
    expect(shareOfVoiceFor('Uber', ['Uber Eats'], outcomes)).toEqual({
      denominator: 2,
      brandMentionsInScope: 1,
      brandShare: 0.5,
      competitors: [{ name: 'Uber Eats', mentionedCount: 1, share: 0.5 }],
    });
  });

  // T7-fix2 N1: a third pin of the same rule (Acme/Acme Corp).
  it('does not count the brand when it only appears as a substring of a matched competitor (Acme/Acme Corp)', () => {
    const outcomes = [
      answer({
        sequence: 1,
        question: 'Which vendors are common here?',
        rawText: 'Acme Corp is a major player.',
      }),
    ];
    expect(shareOfVoiceFor('Acme', ['Acme Corp'], outcomes)).toEqual({
      denominator: 1,
      brandMentionsInScope: 0,
      brandShare: 0,
      competitors: [{ name: 'Acme Corp', mentionedCount: 1, share: 1 }],
    });
  });

  // T7-fix2 N2: overlapping competitor names — the longer match wins, so
  // "Acme" inside "Acme Corp" is not double-counted as a second mention.
  it('counts an overlapping pair of competitor names once, for the longer name (Acme/Acme Corp)', () => {
    const outcomes = [
      answer({
        sequence: 1,
        question: 'How do these compare?',
        rawText: 'Acme Corp is great; Smile Clinic is too.',
      }),
    ];
    expect(shareOfVoiceFor('Smile Clinic', ['Acme', 'Acme Corp'], outcomes)).toEqual({
      denominator: 2,
      brandMentionsInScope: 1,
      brandShare: 0.5,
      competitors: [
        { name: 'Acme Corp', mentionedCount: 1, share: 0.5 },
        { name: 'Acme', mentionedCount: 0, share: 0 },
      ],
    });
  });
});
