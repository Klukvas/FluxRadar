import { describe, expect, it } from 'vitest';

import {
  countSentences,
  countWords,
  estimateCyrillicSyllables,
  estimateEnglishSyllables,
  measureReadability,
} from './readability.js';

describe('countWords', () => {
  it('splits on whitespace', () => {
    expect(countWords('The quick brown fox')).toBe(4);
  });

  it('empty text has zero words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });

  it('one word', () => {
    expect(countWords('Hello')).toBe(1);
  });
});

describe('countSentences', () => {
  it('counts terminators', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
  });

  it('empty text has zero sentences', () => {
    expect(countSentences('')).toBe(0);
  });

  it('text with words but no terminator counts as one sentence', () => {
    expect(countSentences('No terminator here')).toBe(1);
  });

  it('a lone terminator-heavy fragment still counts what it finds', () => {
    expect(countSentences('Wait... really?!')).toBe(2);
  });
});

describe('estimateEnglishSyllables', () => {
  it('single-syllable words', () => {
    expect(estimateEnglishSyllables('cat')).toBe(1);
    expect(estimateEnglishSyllables('the')).toBe(1);
  });

  it('multi-syllable words', () => {
    expect(estimateEnglishSyllables('syllable')).toBeGreaterThanOrEqual(2);
    expect(estimateEnglishSyllables('readability')).toBeGreaterThanOrEqual(4);
  });

  it('a word with no vowels still counts as one syllable', () => {
    expect(estimateEnglishSyllables('rhythm')).toBeGreaterThanOrEqual(1);
    expect(estimateEnglishSyllables('123')).toBe(1);
  });

  it('trailing silent e is dropped', () => {
    expect(estimateEnglishSyllables('like')).toBe(1);
  });
});

describe('estimateCyrillicSyllables', () => {
  it('counts vowel runs', () => {
    expect(estimateCyrillicSyllables('привіт')).toBe(2);
    expect(estimateCyrillicSyllables('і')).toBe(1);
  });

  it('a token with no Cyrillic letters still counts as one syllable', () => {
    expect(estimateCyrillicSyllables('123')).toBe(1);
  });
});

describe('measureReadability', () => {
  it('reports not measurable for an unsupported language', () => {
    expect(measureReadability('Bonjour le monde.', 'fr')).toEqual({
      measurable: false,
      reason: 'unsupported-language',
    });
    expect(measureReadability('Bonjour le monde.', null)).toEqual({
      measurable: false,
      reason: 'unsupported-language',
    });
  });

  it('reports not measurable for empty text even in a supported language', () => {
    expect(measureReadability('', 'en')).toEqual({
      measurable: false,
      reason: 'no-words',
    });
    expect(measureReadability('   ', 'en')).toEqual({
      measurable: false,
      reason: 'no-words',
    });
  });

  it('scores simple English text as easy to read', () => {
    const result = measureReadability(
      'The cat sat on the mat. The dog ran to the park. It was a sunny day.',
      'en',
    );
    expect(result.measurable).toBe(true);
    if (result.measurable) {
      expect(result.scale).toBe('flesch-reading-ease-en');
      expect(result.score).toBeGreaterThan(70);
      expect(result.sentences).toBe(3);
      expect(result.words).toBe(17);
    }
  });

  it('scores dense multi-clause English text as hard to read', () => {
    const hard =
      'Notwithstanding the aforementioned considerations, the multifaceted implementation ' +
      'necessitates comprehensive interdisciplinary collaboration among heterogeneous ' +
      'stakeholders possessing substantially divergent institutional prerequisites.';
    const result = measureReadability(hard, 'en');
    expect(result.measurable).toBe(true);
    if (result.measurable) {
      expect(result.score).toBeLessThan(30);
    }
  });

  it('scores simple Ukrainian text on the Cyrillic scale', () => {
    const result = measureReadability('Кіт спить. Пес біжить. День теплий.', 'uk');
    expect(result.measurable).toBe(true);
    if (result.measurable) {
      expect(result.scale).toBe('flesch-oborneva-uk');
      expect(result.words).toBe(6);
      expect(result.sentences).toBe(3);
    }
  });

  it('one word with no terminator is still measurable (one sentence, one word)', () => {
    const result = measureReadability('Hello', 'en');
    expect(result.measurable).toBe(true);
    if (result.measurable) {
      expect(result.sentences).toBe(1);
      expect(result.words).toBe(1);
    }
  });

  it('numbers and abbreviations count as words without throwing', () => {
    const result = measureReadability('U.S. GDP grew 3.5% in Q1 2026.', 'en');
    expect(result.measurable).toBe(true);
  });
});
