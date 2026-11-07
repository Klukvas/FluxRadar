import { describe, expect, it } from 'vitest';

import { quoteOccursIn } from './quote-match.js';

// Ukrainian answers and evidence (W1): the apostrophe ʼ and the guillemets «»
// may be re-typed by the judge, but the words of a quote must still be there.

const ANSWER_UK =
  'Smile Clinic — стоматологічна клініка в Києві. Компанія повʼязана з мережею «Усмішка» ' +
  'і працює для всієї сімʼї.';

describe('quoteOccursIn for Ukrainian text', () => {
  it('finds a verbatim quote that carries ʼ', () => {
    expect(quoteOccursIn(ANSWER_UK, 'Компанія повʼязана з мережею')).toBe(true);
  });

  it.each([
    ["the ASCII apostrophe '", "Компанія пов'язана з мережею"],
    ['the right single quote ’', 'Компанія пов’язана з мережею'],
    ['the modifier prime ʹ', 'Компанія повʹязана з мережею'],
    ['the backtick `', 'Компанія пов`язана з мережею'],
    ['the acute accent ´', 'Компанія пов´язана з мережею'],
  ])('accepts ʼ re-typed as %s', (_label, quote) => {
    expect(quoteOccursIn(ANSWER_UK, quote)).toBe(true);
  });

  it('accepts an answer typed with an ASCII apostrophe quoted back with ʼ', () => {
    expect(quoteOccursIn("для всієї сім'ї", 'для всієї сімʼї')).toBe(true);
    expect(quoteOccursIn('для всієї сім’ї', "для всієї сім'ї")).toBe(true);
  });

  it('folds guillemets to straight and curly double quotes', () => {
    expect(quoteOccursIn(ANSWER_UK, 'з мережею "Усмішка"')).toBe(true);
    expect(quoteOccursIn(ANSWER_UK, 'з мережею “Усмішка”')).toBe(true);
    expect(quoteOccursIn('мережа "Усмішка"', 'мережа «Усмішка»')).toBe(true);
  });

  it('matches Cyrillic case-insensitively, as it does Latin', () => {
    expect(quoteOccursIn(ANSWER_UK, 'КОМПАНІЯ повʼязана')).toBe(true);
  });

  it('still rejects a quote whose words are not in the answer', () => {
    expect(quoteOccursIn(ANSWER_UK, "Компанія пов'язана з банком")).toBe(false);
    expect(quoteOccursIn(ANSWER_UK, 'клініка у Львові')).toBe(false);
    // A translated quote is not verbatim.
    expect(quoteOccursIn(ANSWER_UK, 'a dental clinic in Kyiv')).toBe(false);
  });

  it('does not let an apostrophe stand in for a letter', () => {
    expect(quoteOccursIn(ANSWER_UK, "пов'язана з мер'жею")).toBe(false);
  });
});
