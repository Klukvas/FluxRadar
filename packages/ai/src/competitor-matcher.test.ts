import { describe, expect, it } from 'vitest';

import { competitorMentioned, foldForMatching, textNames } from './competitor-matcher.js';

describe('foldForMatching', () => {
  it('folds an NFD string to the same value as its NFC spelling', () => {
    expect(foldForMatching('Café Dental'.normalize('NFD'))).toBe(
      foldForMatching('Café Dental'.normalize('NFC')),
    );
  });

  it('folds a Turkish dotted capital İ to plain "i", not "i" + a combining dot', () => {
    expect(foldForMatching('İmplant')).toBe('implant');
  });

  it('folds Cyrillic case the same way as Latin', () => {
    expect(foldForMatching('СТОМАТОЛОГІЯ ЛЮКС')).toBe('стоматологія люкс');
  });
});

describe('textNames', () => {
  it('finds a needle on a word boundary, case-insensitively', () => {
    expect(textNames('What is FluxRadar?', 'fluxradar')).toBe(true);
  });

  it('does not find a needle inside a longer word', () => {
    expect(textNames('A large practice managing many patients.', 'GE')).toBe(false);
  });

  it('finds a needle at the very start or end of the text', () => {
    expect(textNames('GE also makes equipment.', 'GE')).toBe(true);
    expect(textNames('Ask about GE', 'GE')).toBe(true);
  });

  it('treats an empty needle as naming nothing', () => {
    expect(textNames('What is FluxRadar?', '  ')).toBe(false);
  });
});

describe('competitorMentioned', () => {
  it('does not count a competitor name that is only a substring of the brand', () => {
    expect(
      competitorMentioned({
        answer: 'Acme Dental is good.',
        competitor: 'Acme',
        brand: 'Acme Dental',
      }),
    ).toBe(false);
  });

  it('does not count a two-letter competitor inside an ordinary word', () => {
    expect(
      competitorMentioned({ answer: 'A large practice.', competitor: 'GE', brand: 'Acme Dental' }),
    ).toBe(false);
  });

  it('does not count a competitor name inside an unrelated word', () => {
    expect(
      competitorMentioned({
        answer: 'The dentist said so.',
        competitor: 'AI',
        brand: 'Acme Dental',
      }),
    ).toBe(false);
  });

  it('counts the competitor when it appears outside the brand span', () => {
    expect(
      competitorMentioned({
        answer: 'Acme Dental and Globex Clinic both offer implants.',
        competitor: 'Globex Clinic',
        brand: 'Acme Dental',
      }),
    ).toBe(true);
  });

  it('counts a competitor mention when there is no brand in the answer at all', () => {
    expect(
      competitorMentioned({
        answer: 'Globex Clinic is well reviewed.',
        competitor: 'Globex Clinic',
        brand: 'Acme Dental',
      }),
    ).toBe(true);
  });

  it('matches an NFC competitor name against an NFD answer', () => {
    expect(
      competitorMentioned({
        answer: 'Visit Café Dental today.'.normalize('NFD'),
        competitor: 'Café Dental'.normalize('NFC'),
        brand: 'Acme Dental',
      }),
    ).toBe(true);
  });

  it('matches a Turkish dotted capital İ against a plain lowercase i', () => {
    expect(
      competitorMentioned({
        answer: 'implant klinik iyi.',
        competitor: 'İmplant Klinik',
        brand: 'Acme Dental',
      }),
    ).toBe(true);
  });

  it('matches Cyrillic names case-insensitively', () => {
    expect(
      competitorMentioned({
        answer: 'СТОМАТОЛОГІЯ ЛЮКС лікує добре.',
        competitor: 'Стоматологія Люкс',
        brand: 'Acme Dental',
      }),
    ).toBe(true);
  });

  it('treats an empty competitor name as never mentioned', () => {
    expect(
      competitorMentioned({ answer: 'Anything at all.', competitor: '  ', brand: 'Acme Dental' }),
    ).toBe(false);
  });
});
