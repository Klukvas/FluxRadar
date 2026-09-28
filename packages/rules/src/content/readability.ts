// Readability estimate over a page's visible text (CONTENT-005).
//
// Pure functions over a string: sentence/word/syllable counts, and a 0-100
// "easier to read at higher values" score. English gets the real Flesch
// Reading Ease formula (206.835 - 1.015*ASL - 84.6*ASW). Its syllable
// coefficients are tuned for English phonology and are wrong for a language
// they were never fit to, so a Cyrillic document gets a different formula
// (Oborneva's adaptation for Cyrillic text: 206.835 - 1.3*ASL - 60.1*ASW,
// counting syllables from Cyrillic vowel runs instead of Latin ones) rather
// than the English coefficients applied to different letters. A document in
// neither language reports "not measurable" — a Flesch-shaped number for text
// the formula was never validated on would be fabricated, not measured.

import type { PageSnapshot } from '@fluxradar/crawler';

import { parsePage } from '../seo/dom.js';

/** Languages this estimate can score; every other `lang` reports "not measurable". */
export const SUPPORTED_READABILITY_LANGUAGES = ['en', 'uk'] as const;
export type SupportedReadabilityLanguage = (typeof SUPPORTED_READABILITY_LANGUAGES)[number];

export type ReadabilityScale = 'flesch-reading-ease-en' | 'flesch-oborneva-uk';

const SCALE_BY_LANGUAGE: Readonly<Record<SupportedReadabilityLanguage, ReadabilityScale>> = {
  en: 'flesch-reading-ease-en',
  uk: 'flesch-oborneva-uk',
};

export interface ReadabilityMeasurement {
  readonly measurable: true;
  readonly language: SupportedReadabilityLanguage;
  readonly scale: ReadabilityScale;
  readonly score: number;
  readonly sentences: number;
  readonly words: number;
  readonly syllables: number;
}

export interface ReadabilityNotMeasurable {
  readonly measurable: false;
  readonly reason: 'unsupported-language' | 'no-words';
}

export type ReadabilityResult = ReadabilityMeasurement | ReadabilityNotMeasurable;

const SENTENCE_TERMINATOR = /[.!?]+(?=\s|$)/g;
const WORD_SPLIT = /\s+/;
const ENGLISH_VOWEL_GROUP = /[aeiouy]+/gi;
const SILENT_TRAILING_E = /[^aeiouy]e$/i;
const CYRILLIC_VOWEL_GROUP = /[аеєиіїоуюя]+/gi;

/** Word count: whitespace-separated tokens, empty string counts as zero words. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(WORD_SPLIT).length;
}

/**
 * Sentence count: runs of `.`/`!`/`?` followed by whitespace or end-of-text.
 * Text with words but no terminator (a heading, a fragment) counts as one
 * sentence rather than zero — dividing words by zero sentences would not.
 * This is a punctuation heuristic, not NLP: "Mr. Smith arrived." counts as
 * two sentences, the same trade-off every readability formula in production
 * use makes rather than parsing abbreviations.
 */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 0;
  }
  const matches = trimmed.match(SENTENCE_TERMINATOR);
  return matches === null || matches.length === 0 ? 1 : matches.length;
}

/** English syllable estimate: vowel-group count, silent trailing `e` dropped, minimum 1. */
export function estimateEnglishSyllables(word: string): number {
  const letters = word.replace(/[^a-z]/gi, '');
  if (letters === '') {
    return 1;
  }
  const groups = letters.match(ENGLISH_VOWEL_GROUP)?.length ?? 0;
  const silentE = SILENT_TRAILING_E.test(letters) ? 1 : 0;
  return Math.max(1, groups - silentE);
}

/** Cyrillic syllable estimate: one syllable per vowel-letter run, minimum 1. */
export function estimateCyrillicSyllables(word: string): number {
  const letters = word.replace(/[^а-яіїєґ]/gi, '');
  if (letters === '') {
    return 1;
  }
  const groups = letters.match(CYRILLIC_VOWEL_GROUP)?.length ?? 0;
  return Math.max(1, groups);
}

function totalSyllables(words: readonly string[], language: SupportedReadabilityLanguage): number {
  const estimate = language === 'en' ? estimateEnglishSyllables : estimateCyrillicSyllables;
  return words.reduce((sum, word) => sum + estimate(word), 0);
}

/**
 * The document's declared or detected language, normalized to a primary
 * subtag ('en', 'uk', ...), or null when neither is available.
 *
 * `<html lang>` wins when present. Its absence does not make the language
 * unknown — most of the fixture and live web still omits it — so a Cyrillic
 * vs. Latin letter majority in the visible text stands in as the detected
 * fallback the task calls for. A document with no letters of either script
 * reports null, same as one this heuristic simply cannot place.
 */
export function documentLanguage(page: PageSnapshot, visibleText: string): string | null {
  const declared = parsePage(page).querySelector('html')?.getAttribute('lang')?.trim();
  if (declared !== undefined && declared !== '') {
    return declared.split('-')[0]?.toLowerCase() ?? null;
  }
  const cyrillic = visibleText.match(/[а-яіїєґ]/gi)?.length ?? 0;
  const latin = visibleText.match(/[a-z]/gi)?.length ?? 0;
  if (cyrillic === 0 && latin === 0) {
    return null;
  }
  return cyrillic > latin ? 'uk' : 'en';
}

function isSupportedLanguage(language: string | null): language is SupportedReadabilityLanguage {
  return (SUPPORTED_READABILITY_LANGUAGES as readonly string[]).includes(language ?? '');
}

/** Readability of `text`, scored on the scale for `language` (`html lang` or detected). */
export function measureReadability(text: string, language: string | null): ReadabilityResult {
  if (!isSupportedLanguage(language)) {
    return { measurable: false, reason: 'unsupported-language' };
  }
  const words = text.trim() === '' ? [] : text.trim().split(WORD_SPLIT);
  if (words.length === 0) {
    return { measurable: false, reason: 'no-words' };
  }
  const sentences = countSentences(text);
  const syllables = totalSyllables(words, language);
  const averageSentenceLength = words.length / sentences;
  const averageSyllablesPerWord = syllables / words.length;
  const score =
    language === 'en'
      ? 206.835 - 1.015 * averageSentenceLength - 84.6 * averageSyllablesPerWord
      : 206.835 - 1.3 * averageSentenceLength - 60.1 * averageSyllablesPerWord;
  return {
    measurable: true,
    language,
    scale: SCALE_BY_LANGUAGE[language],
    score,
    sentences,
    words: words.length,
    syllables,
  };
}
