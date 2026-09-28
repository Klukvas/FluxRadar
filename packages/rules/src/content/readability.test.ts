import { describe, expect, it } from 'vitest';

import { htmlContext } from '../testing/fixture-harness.js';
import {
  countSentences,
  countWords,
  declaredLanguage,
  estimateCyrillicSyllables,
  estimateEnglishSyllables,
  measureReadability,
  resolveReadabilityLanguage,
} from './readability.js';
import { proseText } from './visible-text.js';

/** The single page of a one-page `htmlContext`, as a `PageSnapshot`. */
function firstPage(ctx: ReturnType<typeof htmlContext>) {
  const page = ctx.crawl.pages[0];
  if (page === undefined) {
    throw new Error('ожидалась ровно одна страница');
  }
  return page;
}

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

  it('a closing quote or guillemet right after the terminator still ends the sentence', () => {
    expect(countSentences('"Stop." he said. "Now."')).toBe(3);
    expect(countSentences('Він запитав: «Досить?» Ми зупинились.')).toBe(2);
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

  // Known, documented bias (readability.ts header): vowel-group counting
  // undercounts words where English spelling does not mark a diphthong split
  // with an extra vowel group. Pinned so a future change to the estimator
  // has to look at this table rather than silently shift the bias.
  it('known bias: undercounts words with an unmarked diphthong split', () => {
    const table: ReadonlyArray<readonly [string, number]> = [
      ['people', 2],
      ['simple', 2],
      ['table', 2],
      ['created', 3],
      ['area', 3],
      ['idea', 3],
    ];
    for (const [word, actual] of table) {
      expect(estimateEnglishSyllables(word)).toBe(actual - 1);
    }
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

describe('declaredLanguage', () => {
  it('normalizes a hyphenated regional subtag', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en-GB"><head><title>T</title></head><body><p>Hi</p></body></html>',
    );
    expect(declaredLanguage(firstPage(ctx))).toBe('en');
  });

  it('normalizes an underscored locale (en_US), not just the BCP 47 hyphen', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en_US"><head><title>T</title></head><body><p>Hi</p></body></html>',
    );
    expect(declaredLanguage(firstPage(ctx))).toBe('en');
  });

  it('no lang attribute → null', () => {
    const ctx = htmlContext(
      '<!doctype html><html><head><title>T</title></head><body><p>Hi</p></body></html>',
    );
    expect(declaredLanguage(firstPage(ctx))).toBeNull();
  });
});

describe('resolveReadabilityLanguage', () => {
  const englishText = 'The cat sat on the mat and the dog ran to the park.';
  const ukrainianText = 'Кіт спить, а пес біжить у парк дуже швидко сьогодні.';

  it('no declared language → not usable, never falls back to a script guess (H1)', () => {
    expect(resolveReadabilityLanguage(null, englishText)).toEqual({
      usable: false,
      reason: 'no-declared-language',
    });
    expect(resolveReadabilityLanguage('', englishText)).toEqual({
      usable: false,
      reason: 'no-declared-language',
    });
  });

  it('a declared language outside en/uk is not usable', () => {
    expect(resolveReadabilityLanguage('fr', englishText)).toEqual({
      usable: false,
      reason: 'unsupported-language',
    });
  });

  it('regional subtags resolve to their primary subtag', () => {
    expect(resolveReadabilityLanguage('en-GB', englishText)).toEqual({
      usable: true,
      language: 'en',
    });
    expect(resolveReadabilityLanguage('uk-UA', ukrainianText)).toEqual({
      usable: true,
      language: 'uk',
    });
  });

  it('the other supported script being the actual majority is a script mismatch, not a score (H2)', () => {
    expect(resolveReadabilityLanguage('en', ukrainianText)).toEqual({
      usable: false,
      reason: 'script-mismatch',
    });
    expect(resolveReadabilityLanguage('uk', englishText)).toEqual({
      usable: false,
      reason: 'script-mismatch',
    });
  });

  // L6 (T9 second review): the old single `script-mismatch` branch covered
  // three different situations with one copy sentence that only described
  // one of them. Each now names distinct.
  it('text mostly in neither Latin nor Cyrillic is an unsupported script, not a mismatch with the other supported language', () => {
    const chinese =
      '这是一段用于测试的中文文本，它包含了两百多个字符，足够超过可见文本的最小长度要求。'.repeat(
        3,
      );
    expect(resolveReadabilityLanguage('en', chinese)).toEqual({
      usable: false,
      reason: 'unsupported-script',
    });
  });

  it('no letters at all is an unsupported script', () => {
    expect(resolveReadabilityLanguage('en', '')).toEqual({
      usable: false,
      reason: 'unsupported-script',
    });
    expect(resolveReadabilityLanguage('en', '123 456 789')).toEqual({
      usable: false,
      reason: 'unsupported-script',
    });
  });

  it('the declared script is the largest share but short of the 70% dominance threshold is a mixed script, not a mismatch', () => {
    // 60% Latin letters, 40% Cyrillic: Latin is the majority of the two
    // supported scripts, but not the required 70% of all letters.
    const mixed = 'aaaaaa'.repeat(10) + 'бббб'.repeat(10);
    expect(resolveReadabilityLanguage('en', mixed)).toEqual({
      usable: false,
      reason: 'mixed-script',
    });
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

// H5 (T9 third review): proseText reads only `<p>`, `<blockquote>` and
// `<dd>` text — a heading, a list item, and a table cell contribute nothing,
// not even as a boundary, so a page built entirely of those (a nav list, a
// pricing table) measures as 0 sentences and 0 words, not as prose the gate
// can be satisfied by punctuation-free markup alone.
describe('proseText', () => {
  it('a paragraph boundary with no source whitespace or punctuation still ends a sentence', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Minified</title></head>' +
        '<body><p>We keep our plans</p><p>We keep our pricing simple</p></body></html>',
    );
    const text = proseText(firstPage(ctx));
    expect(text).toBe('We keep our plans. We keep our pricing simple.');
    expect(countSentences(text)).toBe(2);
  });

  it('a block that already ends with its own terminator is not double-counted', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Terminated</title></head>' +
        '<body><p>We keep our plans.</p><p>We keep our pricing simple.</p></body></html>',
    );
    expect(countSentences(proseText(firstPage(ctx)))).toBe(2);
  });

  it('blockquote and dd read as prose too, alongside p', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Mixed prose</title></head>' +
        '<body><blockquote>We keep our plans simple</blockquote>' +
        '<dl><dd>We keep our pricing honest</dd></dl></body></html>',
    );
    const text = proseText(firstPage(ctx));
    expect(text).toBe('We keep our plans simple. We keep our pricing honest.');
    expect(countSentences(text)).toBe(2);
  });

  it('headings, list items and table cells contribute nothing — not even a boundary (H5)', () => {
    const listCtx = htmlContext(
      '<!doctype html><html lang="en"><head><title>List</title></head>' +
        '<body><h1>Updates</h1><ul><li>First item here</li><li>Second item here</li></ul></body></html>',
    );
    expect(proseText(firstPage(listCtx))).toBe('');

    const tableCtx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Table</title></head>' +
        '<body><table><tr><td>First cell here</td><td>Second cell here</td></tr></table></body></html>',
    );
    expect(proseText(firstPage(tableCtx))).toBe('');
  });

  it('nav, header, footer, aside and form are excluded even when they wrap a <p>', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Chrome</title></head>' +
        '<body>' +
        '<nav><p>Skip to content now</p></nav>' +
        '<header><p>Site header blurb here</p></header>' +
        '<p>Real article body copy</p>' +
        '<aside><p>Related links blurb</p></aside>' +
        '<form><p>Newsletter signup blurb</p></form>' +
        '<footer><p>Copyright footer blurb</p></footer>' +
        '</body></html>',
    );
    expect(proseText(firstPage(ctx))).toBe('Real article body copy.');
  });

  it('minified <p> wrappers with no whitespace between them do not glue across paragraphs (L11)', () => {
    const ctx = htmlContext(
      '<!doctype html><html lang="en"><head><title>Minified wrapper</title></head>' +
        '<body><p>We keep our plans</p><p>We keep our pricing simple</p><p>We keep support fast</p></body></html>',
    );
    const text = proseText(firstPage(ctx));
    expect(text).not.toContain('plansWe');
    expect(text).not.toContain('simpleWe');
    expect(countSentences(text)).toBe(3);
  });
});
