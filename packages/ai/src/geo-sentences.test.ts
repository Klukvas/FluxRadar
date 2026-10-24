// Where an answer breaks into sentences, in English and in Ukrainian.

import { describe, expect, it } from 'vitest';

import { sentenceAround, sentenceStarts } from './geo-sentences.js';

describe('sentence breaks', () => {
  it('does not end a sentence at a Ukrainian address abbreviation', () => {
    const text = 'Дент Про на вул. Хрещатик 1. Smile Clinic поруч.';

    expect(sentenceStarts(text)).toEqual([0, text.indexOf('Smile Clinic')]);
    expect(sentenceAround(text, text.indexOf('Хрещатик'))).toBe('Дент Про на вул. Хрещатик 1.');
  });

  it('keeps «м.» and «просп.» inside the sentence they abbreviate in', () => {
    const text = 'Салон працює в м. Київ на просп. Перемоги. Запис онлайн.';

    expect(sentenceAround(text, text.indexOf('Перемоги'))).toBe(
      'Салон працює в м. Київ на просп. Перемоги.',
    );
  });

  // «грн.» usually ends a price sentence; it is not on the abbreviation list.
  it('still ends a sentence after a price in hryvnias', () => {
    const text = 'Манікюр коштує 650 грн. Педикюр дорожчий.';

    expect(sentenceStarts(text)).toEqual([0, text.indexOf('Педикюр')]);
  });

  // «р.» (рік) ends a sentence as often as «грн.» does; it is not on the list.
  it('still ends a sentence after a year abbreviated «р.»', () => {
    const text = 'Відкрито у 2015 р. Smile Clinic поруч.';

    expect(sentenceStarts(text)).toEqual([0, text.indexOf('Smile Clinic')]);
  });

  it('drops a dash bullet from the quote only where it opens a line', () => {
    const text = 'Варіанти:\n– Smile Clinic поруч. – Це жарт.';

    expect(sentenceAround(text, text.indexOf('Smile'))).toBe('Smile Clinic поруч.');
    expect(sentenceAround(text, text.indexOf('Це'))).toBe('– Це жарт.');
  });

  it('keeps the English abbreviations it had', () => {
    const text = 'See Dr. Smith at Smile Clinic. Others exist.';

    expect(sentenceAround(text, text.indexOf('Smile'))).toBe('See Dr. Smith at Smile Clinic.');
  });
});
