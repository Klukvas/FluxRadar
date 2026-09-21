import { describe, expect, it } from 'vitest';

import {
  brandIsHostname,
  brandSignal,
  domainSignal,
  isMeasured,
  questionNames,
} from './geo-measurability.js';

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

describe('isMeasured', () => {
  it('admits only the two signals that came from an answer', () => {
    expect(isMeasured('mentioned')).toBe(true);
    expect(isMeasured('not-mentioned')).toBe(true);
    expect(isMeasured('named-in-question')).toBe(false);
    expect(isMeasured('brand-is-hostname')).toBe(false);
  });
});
