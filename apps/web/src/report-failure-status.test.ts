// What a site's answer meant, for a report whose crawl read nothing.
//
// The block had a sentence for 410 and a handful of others and nothing at all
// for 400, 405, 408, every redirect and — the most common case of the lot — no
// answer arriving. An owner's whole record of what happened was then "HTTP 405"
// in the small technical line, which is not a sentence anybody can act on.
//
// Every class is pinned here in both languages, because the sentence has to be
// true of the status as well as readable: "the site refused us" and "the page
// is gone" are different jobs, and neither may blame the owner or promise money.

import { describe, expect, it } from 'vitest';

import {
  reportFailureCopy,
  statusClassOf,
  statusMeaningClassOf,
  type SiteReadFailure,
  type SiteReadFailureKind,
  type StatusClass,
} from './report-failure-copy';
import type { Language } from './i18n';

const LANGUAGES: readonly Language[] = ['en', 'uk'];

/** One answer the start page can give, and the class its sentence comes from. */
interface AnswerCase {
  readonly status: number | null;
  readonly expected: StatusClass;
  /** A word the sentence has to carry, so a wrong-but-present sentence fails. */
  readonly en: RegExp;
  readonly uk: RegExp;
}

const ANSWERS: readonly AnswerCase[] = [
  // No answer at all. The crawler stores a throw as status 0, which is why the
  // block is handed null rather than a number here.
  { status: null, expected: 'noAnswer', en: /No answer came back/i, uk: /не надійшло жодної/i },
  // 1xx: acknowledged, never delivered.
  { status: 100, expected: 'startedButStopped', en: /began to answer/i, uk: /почав відповідати/i },
  // 2xx: a real answer that was not a page.
  { status: 200, expected: 'answeredNotAPage', en: /not a web page/i, uk: /не було вебсторінкою/i },
  { status: 204, expected: 'answeredNotAPage', en: /not a web page/i, uk: /не було вебсторінкою/i },
  // 3xx: sent somewhere else, and the somewhere else was not readable either.
  { status: 301, expected: 'pointedElsewhere', en: /another address/i, uk: /іншу адресу/i },
  { status: 302, expected: 'pointedElsewhere', en: /another address/i, uk: /іншу адресу/i },
  { status: 399, expected: 'pointedElsewhere', en: /another address/i, uk: /іншу адресу/i },
  // 4xx, each with its own job for the owner.
  { status: 400, expected: 'notUnderstood', en: /make sense of our request/i, uk: /не зрозумів/i },
  { status: 401, expected: 'needsLogin', en: /login or a password/i, uk: /вхід або пароль/i },
  { status: 403, expected: 'refused', en: /refused to show/i, uk: /відмовився показати/i },
  { status: 404, expected: 'notFound', en: /no such page/i, uk: /немає такої сторінки/i },
  { status: 405, expected: 'notAllowed', en: /this kind of request/i, uk: /таких запитів/i },
  { status: 406, expected: 'refused', en: /refused to show/i, uk: /відмовився показати/i },
  { status: 407, expected: 'needsLogin', en: /login or a password/i, uk: /вхід або пароль/i },
  { status: 408, expected: 'timedOut', en: /stopped waiting/i, uk: /перестав чекати/i },
  { status: 410, expected: 'gone', en: /no longer exists/i, uk: /більше немає/i },
  { status: 429, expected: 'tooManyRequests', en: /too often/i, uk: /надто часто/i },
  { status: 451, expected: 'legal', en: /legal reasons/i, uk: /юридичних причин/i },
  // The rest of 4xx: turned away without naming which of the above it was.
  { status: 402, expected: 'refused', en: /refused to show/i, uk: /відмовився показати/i },
  { status: 418, expected: 'refused', en: /refused to show/i, uk: /відмовився показати/i },
  // 5xx: the site's own side.
  { status: 500, expected: 'serverError', en: /on the site’s own side/i, uk: /на боці сайту/i },
  { status: 503, expected: 'serverError', en: /on the site’s own side/i, uk: /на боці сайту/i },
  { status: 599, expected: 'serverError', en: /on the site’s own side/i, uk: /на боці сайту/i },
];

describe('every class of answer has a plain sentence', () => {
  for (const answer of ANSWERS) {
    const name = answer.status === null ? 'no answer' : `HTTP ${answer.status}`;
    it(`reads ${name} as ${answer.expected}, in both languages`, () => {
      expect(statusClassOf(answer.status)).toBe(answer.expected);
      for (const language of LANGUAGES) {
        const sentence = reportFailureCopy[language].statusMeanings[answer.expected];
        expect(sentence).toMatch(answer[language]);
        // A sentence, not a token: ends in a full stop and names no status code.
        expect(sentence).toMatch(/[.!]$/);
        expect(sentence).not.toMatch(/\b[1-5]\d\d\b/);
        expect(sentence).not.toMatch(/HTTP/);
      }
    });
  }

  // The defect this replaces: most answers fell through to null and the block
  // printed nothing. Nothing may fall through now.
  it('leaves no answer without a class', () => {
    for (let status = 100; status <= 599; status += 1) {
      expect(statusClassOf(status)).not.toBeNull();
    }
    expect(statusClassOf(null)).toBe('noAnswer');
  });

  it('never blames the owner or mentions money', () => {
    for (const language of LANGUAGES) {
      for (const sentence of Object.values(reportFailureCopy[language].statusMeanings)) {
        expect(sentence).not.toMatch(/you (did|should|must|forgot|need to)/i);
        expect(sentence).not.toMatch(/refund|money|charge|повернення|кошт|оплат/i);
      }
    }
  });

  it('says the same things in Ukrainian as in English', () => {
    expect(Object.keys(reportFailureCopy.uk.statusMeanings).sort()).toEqual(
      Object.keys(reportFailureCopy.en.statusMeanings).sort(),
    );
    for (const [key, sentence] of Object.entries(reportFailureCopy.uk.statusMeanings)) {
      expect(sentence.trim()).not.toBe('');
      expect(sentence).not.toBe(reportFailureCopy.en.statusMeanings[key as StatusClass]);
    }
  });
});

function failure(kind: SiteReadFailureKind, startStatus: number | null): SiteReadFailure {
  return { kind, reasonCode: null, startStatus, accessControlSignals: [] };
}

describe('which answers the block says out loud', () => {
  // Two kinds already open with the answer: "Your site did not answer…" and
  // "Your robots.txt tells our crawler not to read the site". A second sentence
  // saying no answer arrived would read as a second, different reason.
  it('does not repeat “no answer” under a kind that already said it', () => {
    expect(statusMeaningClassOf(failure('unreachable', null))).toBeNull();
    expect(statusMeaningClassOf(failure('blocked-by-robots', null))).toBeNull();
  });

  it('says it for the kinds that do not', () => {
    expect(statusMeaningClassOf(failure('unknown', null))).toBe('noAnswer');
    expect(statusMeaningClassOf(failure('bad-response', null))).toBe('noAnswer');
    expect(statusMeaningClassOf(failure('access-denied', null))).toBe('noAnswer');
  });

  // A status that did arrive is always explained, whatever the kind: it is the
  // one hard fact the run recorded about the site's answer.
  it('explains a status that did arrive, for every kind', () => {
    for (const kind of [
      'access-denied',
      'blocked-by-robots',
      'unreachable',
      'bad-response',
      'unknown',
    ] as const) {
      expect(statusMeaningClassOf(failure(kind, 403))).toBe('refused');
    }
  });

  // Except where the two sentences would contradict each other. A robots
  // refusal opens with "Your robots.txt tells our crawler not to read the
  // site"; "the site answered normally, but what came back was not a web page
  // we could read" under it is a second, different reason for one failure. A
  // refusal or a breakage still speaks — that is a fact about the site nothing
  // else on the block carries.
  it.each([
    [200, null],
    [204, null],
    [301, null],
    [399, null],
    [403, 'refused'],
    [404, 'notFound'],
    [500, 'serverError'],
  ] as const)('reads HTTP %s under a robots refusal as %s', (status, expected) => {
    expect(statusMeaningClassOf(failure('blocked-by-robots', status))).toBe(expected);
    // Every other kind is unchanged by this: it is the robots sentence alone
    // that already accounted for an answer that was not a page.
    expect(statusMeaningClassOf(failure('bad-response', status))).toBe(statusClassOf(status));
  });

  it.each(LANGUAGES)('never prints two reasons for one robots refusal (%s)', (language) => {
    const t = reportFailureCopy[language];
    const silenced = statusMeaningClassOf(failure('blocked-by-robots', 200));
    expect(silenced).toBeNull();
    // The sentences that would have been read together, for the record: the
    // kind's own, and the one the 2xx would have added under it.
    expect(t.kinds['blocked-by-robots'].trim()).not.toBe('');
    expect(t.statusMeanings.answeredNotAPage.trim()).not.toBe('');
    expect(t.kinds['blocked-by-robots']).not.toBe(t.statusMeanings.answeredNotAPage);
  });
});
