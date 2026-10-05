// The Ukrainian page-noun forms the findings copy counts with.
//
// A numeral decides both the case and the number of the noun after it, and the
// two do not move together: 21 takes a singular noun, 11 does not, and the
// accusative after «копіює» is a third form again. One helper reused in every
// sentence is therefore wrong in most of them, which is what these pin.

import { describe, expect, it } from 'vitest';

import { findingsCopy, ukPagesAccusative } from './findings-copy';

const PROBLEM = 'Опис сторінки для пошуку відсутній або неправильної довжини';

describe('the accusative page noun', () => {
  it.each([
    [1, 'сторінку'],
    [2, 'сторінки'],
    [5, 'сторінок'],
    [11, 'сторінок'],
    [12, 'сторінок'],
    [21, 'сторінку'],
    [22, 'сторінки'],
    [25, 'сторінок'],
  ])('counts %i as «%s»', (count, form) => {
    expect(ukPagesAccusative(count)).toBe(form);
  });
});

// «Копіює цю одну проблему — … — і 21 сторінку, де її знайдено»: the pages are
// the second thing the button copies, so they are its direct object and take
// the accusative, not the genitive «з 21 сторінки» form.
describe('what the copy-task button says it copies', () => {
  it.each([
    [1, 'і 1 сторінку, де її знайдено'],
    [2, 'і 2 сторінки, де її знайдено'],
    [5, 'і 5 сторінок, де її знайдено'],
    [11, 'і 11 сторінок, де її знайдено'],
    [12, 'і 12 сторінок, де її знайдено'],
    [21, 'і 21 сторінку, де її знайдено'],
    [22, 'і 22 сторінки, де її знайдено'],
    [25, 'і 25 сторінок, де її знайдено'],
  ])('names %i pages as «%s»', (count, expected) => {
    expect(findingsCopy.uk.task.explains(PROBLEM, count)).toContain(expected);
  });
});

// «На цих 21 сторінці» agreed with nothing: «цих» is plural and a numeral
// ending in 1 takes the singular noun.
describe('the lead-in over one piece of evidence', () => {
  it.each([
    [1, 'На цій сторінці:'],
    [2, 'На цих 2 сторінках:'],
    [5, 'На цих 5 сторінках:'],
    [11, 'На цих 11 сторінках:'],
    [12, 'На цих 12 сторінках:'],
    [21, 'На 21 сторінці:'],
    [22, 'На цих 22 сторінках:'],
    [25, 'На цих 25 сторінках:'],
  ])('reads %i as «%s»', (count, expected) => {
    expect(findingsCopy.uk.issues.variantPages(count)).toBe(expected);
  });

  it('never puts the plural «цих» in front of a singular noun', () => {
    for (let count = 1; count <= 200; count += 1) {
      const line = findingsCopy.uk.issues.variantPages(count);
      if (line.includes('цих')) expect(line).toContain('сторінках');
    }
  });
});
