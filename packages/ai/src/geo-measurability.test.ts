import { describe, expect, it } from 'vitest';

import { competitorMentioned, textNames } from './competitor-matcher.js';
import {
  brandIsHostname,
  brandSignal,
  domainSignal,
  isMeasured,
  questionNames,
  type MentionSignal,
} from './geo-measurability.js';

/**
 * The competitor signal for one answer (T7-fix F1).
 *
 * Same question/answer check as `brandSignal`, minus the hostname special
 * case: a competitor is never "the same as the site" the way a brand can be,
 * so there is nothing to mirror `brandIsHostname` for. Unlike the brand and
 * domain signals, this is deliberately *not* built on `questionNames`: the
 * brand only ever spends `includes`'s laxity on itself, but a competitor is a
 * different string the profile owner picked, and bare substring matching
 * false-hits it inside ordinary words ("GE" inside "managing") and inside the
 * brand's own name ("Acme" inside "Acme Dental") — corrupting the brand's own
 * reported share, since the two are mentions in the same denominator.
 * `textNames`/`competitorMentioned` match on a Unicode word boundary instead,
 * and the answer check also excludes any competitor match that falls inside a
 * span where the brand itself matched.
 *
 * Kept here rather than in `geo-measurability.ts` (T7-fix3 N-1): production
 * code now computes share of voice through `shareOfVoiceMentions`, which
 * resolves the brand/competitor overlap for every name in an answer at once
 * — this per-competitor, `questionNames`-shaped signal has no remaining
 * caller. The cases below are still worth pinning as their own unit, so the
 * function moved with them instead of being deleted.
 */
function competitorSignal(input: {
  readonly question: string;
  readonly answer: string;
  readonly competitor: string;
  readonly brand: string;
}): MentionSignal {
  if (textNames(input.question, input.competitor)) return 'named-in-question';
  return competitorMentioned({
    answer: input.answer,
    competitor: input.competitor,
    brand: input.brand,
  })
    ? 'mentioned'
    : 'not-mentioned';
}

// The bug these exist for: the awareness question read
//
//   "What is example.com, what does its official website https://example.com
//    offer, and who is it for?"
//
// and the answer was then checked for "example.com" — twice, once as the brand
// and once as the domain. A model repeating the subject of a question scored
// "brand mentioned" and "official domain cited" on every scan we ever ran.

describe('questionNames', () => {
  it('finds the needle however it is cased', () => {
    expect(questionNames('What is FluxRadar?', 'fluxradar')).toBe(true);
  });

  it('is false for a question that did not name it', () => {
    expect(questionNames('What are the best audit tools?', 'fluxradar')).toBe(false);
  });

  it('treats an empty needle as naming nothing', () => {
    expect(questionNames('What is FluxRadar?', '  ')).toBe(false);
  });
});

describe('brandIsHostname', () => {
  it('recognises an auto-created profile, whose brand is its domain', () => {
    expect(brandIsHostname('ukrdentclub.ua', 'ukrdentclub.ua')).toBe(true);
    expect(brandIsHostname('www.ukrdentclub.ua', 'ukrdentclub.ua')).toBe(true);
  });

  it('leaves a real brand that shares a label with its domain alone', () => {
    // "Nike" on nike.com is a name a model may or may not know, which is the
    // whole point of measuring brand awareness.
    expect(brandIsHostname('Nike', 'nike.com')).toBe(false);
    expect(brandIsHostname('FluxRadar', 'fluxradar.test')).toBe(false);
  });

  it('is false for an empty brand', () => {
    expect(brandIsHostname('', 'example.com')).toBe(false);
  });
});

describe('brandSignal', () => {
  it('does not count a brand the question already named', () => {
    const signal = brandSignal({
      question: 'What is Smile Clinic? What is its official website?',
      answer: 'Smile Clinic is a dental practice in Kyiv.',
      brand: 'Smile Clinic',
      hostname: 'smile.example',
    });

    expect(signal).toBe('named-in-question');
    expect(isMeasured(signal)).toBe(false);
  });

  it('counts a brand a neutral question did not name', () => {
    expect(
      brandSignal({
        question: 'Which dental clinics in Kyiv offer implants?',
        answer: 'Smile Clinic offers implants in Kyiv.',
        brand: 'Smile Clinic',
        hostname: 'smile.example',
      }),
    ).toBe('mentioned');
  });

  it('reports a neutral question the brand is missing from', () => {
    expect(
      brandSignal({
        question: 'Which dental clinics in Kyiv offer implants?',
        answer: 'Several clinics do, including Acme Dental.',
        brand: 'Smile Clinic',
        hostname: 'smile.example',
      }),
    ).toBe('not-mentioned');
  });

  it('has nothing to measure when the brand is only the domain', () => {
    // Even on a neutral question: "did it mention ukrdentclub.ua" is the domain
    // question, and answering it twice does not make it two measurements.
    const signal = brandSignal({
      question: 'Which dental clinics in Kyiv offer implants?',
      answer: 'Try ukrdentclub.ua.',
      brand: 'ukrdentclub.ua',
      hostname: 'ukrdentclub.ua',
    });

    expect(signal).toBe('brand-is-hostname');
    expect(isMeasured(signal)).toBe(false);
  });
});

describe('domainSignal', () => {
  it('does not count a domain the question spelled out', () => {
    // The exact shape of the old awareness question.
    const signal = domainSignal({
      question: 'What is Smile Clinic, what does https://smile.example offer, and who is it for?',
      domain: 'smile.example',
      mentionsDomain: true,
    });

    expect(signal).toBe('named-in-question');
    expect(isMeasured(signal)).toBe(false);
  });

  it('counts a domain the model supplied itself', () => {
    expect(
      domainSignal({
        question: 'What is Smile Clinic? What is its official website?',
        domain: 'smile.example',
        mentionsDomain: true,
      }),
    ).toBe('mentioned');
  });

  it('reports a domain the model did not supply', () => {
    expect(
      domainSignal({
        question: 'What is Smile Clinic? What is its official website?',
        domain: 'smile.example',
        mentionsDomain: false,
      }),
    ).toBe('not-mentioned');
  });
});

describe('competitorSignal (T7)', () => {
  it('does not count a competitor the question already named', () => {
    const signal = competitorSignal({
      question: 'How does Smile Clinic compare to Acme Dental?',
      answer: 'Smile Clinic offers similar services to Acme Dental.',
      competitor: 'Acme Dental',
      brand: 'Smile Clinic',
    });

    expect(signal).toBe('named-in-question');
    expect(isMeasured(signal)).toBe(false);
  });

  it('counts a competitor a neutral question did not name', () => {
    expect(
      competitorSignal({
        question: 'Which dental clinics in Kyiv offer implants?',
        answer: 'Both Smile Clinic and Acme Dental do.',
        competitor: 'Acme Dental',
        brand: 'Smile Clinic',
      }),
    ).toBe('mentioned');
  });

  it('reports a neutral question the competitor is missing from', () => {
    expect(
      competitorSignal({
        question: 'Which dental clinics in Kyiv offer implants?',
        answer: 'Smile Clinic does.',
        competitor: 'Acme Dental',
        brand: 'Smile Clinic',
      }),
    ).toBe('not-mentioned');
  });

  it('finds the competitor case-insensitively, the same as the brand', () => {
    expect(
      competitorSignal({
        question: 'Which dental clinics in Kyiv offer implants?',
        answer: 'acme dental does.',
        competitor: 'Acme Dental',
        brand: 'Smile Clinic',
      }),
    ).toBe('mentioned');
  });

  // T7-fix F1: `questionNames`'s bare `includes` false-matched a competitor
  // name inside ordinary words and inside the brand's own name, which then
  // fabricated part of the brand's own share (the two are mentions in the
  // same denominator). These pin the reviewer's probes.
  it('does not count a competitor name that is only a substring of the brand', () => {
    expect(
      competitorSignal({
        question: 'Which clinics offer implants in this city?',
        answer: 'Acme Dental is well reviewed.',
        competitor: 'Acme',
        brand: 'Acme Dental',
      }),
    ).toBe('not-mentioned');
  });

  it('does not count a two-letter competitor name inside an ordinary word', () => {
    expect(
      competitorSignal({
        question: 'Which clinics offer implants in this city?',
        answer: 'A large practice.',
        competitor: 'GE',
        brand: 'Acme Dental',
      }),
    ).toBe('not-mentioned');
  });

  it('does not count a competitor name inside an unrelated word', () => {
    expect(
      competitorSignal({
        question: 'Which clinics offer implants in this city?',
        answer: 'The dentist said so.',
        competitor: 'AI',
        brand: 'Acme Dental',
      }),
    ).toBe('not-mentioned');
  });

  it('still counts a short competitor name on its own word boundary', () => {
    expect(
      competitorSignal({
        question: 'Which manufacturers were mentioned?',
        answer: 'GE also makes similar equipment.',
        competitor: 'GE',
        brand: 'Acme Dental',
      }),
    ).toBe('mentioned');
  });

  it('matches an NFC competitor name against an NFD answer', () => {
    expect(
      competitorSignal({
        question: 'Which clinics offer implants in this city?',
        answer: 'Visit Café Dental today.'.normalize('NFD'),
        competitor: 'Café Dental'.normalize('NFC'),
        brand: 'Acme Dental',
      }),
    ).toBe('mentioned');
  });

  it('matches a Turkish dotted capital İ against a plain lowercase i', () => {
    expect(
      competitorSignal({
        question: 'Which clinics offer implants in this city?',
        answer: 'implant klinik iyi.',
        competitor: 'İmplant Klinik',
        brand: 'Acme Dental',
      }),
    ).toBe('mentioned');
  });

  it('matches Cyrillic names case-insensitively', () => {
    expect(
      competitorSignal({
        question: 'Які клініки пропонують імплантацію?',
        answer: 'СТОМАТОЛОГІЯ ЛЮКС лікує добре.',
        competitor: 'Стоматологія Люкс',
        brand: 'Acme Dental',
      }),
    ).toBe('mentioned');
  });
});

describe('isMeasured', () => {
  it('admits only the two signals that came from an answer', () => {
    expect(isMeasured('mentioned')).toBe(true);
    expect(isMeasured('not-mentioned')).toBe(true);
    expect(isMeasured('named-in-question')).toBe(false);
    expect(isMeasured('brand-is-hostname')).toBe(false);
  });
});
