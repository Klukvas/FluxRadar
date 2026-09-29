// Readability estimate over a page's visible text (CONTENT-005).
//
// Pure functions over a string: sentence/word/syllable counts, and a
// "easier to read at higher values" score. English gets the real Flesch
// Reading Ease formula (206.835 - 1.015*ASL - 84.6*ASW). Its syllable
// coefficients are tuned for English phonology and are wrong for a language
// they were never fit to, so a Cyrillic document gets a different formula
// instead of the English coefficients applied to different letters:
// Oborneva's adaptation (206.835 - 1.3*ASL - 60.1*ASW, counting syllables
// from Cyrillic vowel runs instead of Latin ones). Be honest about what that
// adaptation is: Oborneva fit her coefficients on Russian text, not
// Ukrainian, and this rule applies them to Ukrainian as an approximation —
// the same kind of coefficient-borrowing this file refuses to do for English
// on a document in neither language, one step smaller and undocumented if
// left unsaid.
//
// A document reports "not measurable" rather than guessing:
// `resolveReadabilityLanguage` only trusts a declared `<html lang>` whose
// primary subtag is 'en' or 'uk' (never a silent fallback to English or to a
// majority-script guess), and only once the visible text's dominant script
// actually agrees with that declaration — a `lang="en"` page whose text is
// mostly Cyrillic is not English text scored badly, it is a mislabeled page
// this estimate refuses to score at all.
//
// English syllable estimate, known bias: `estimateEnglishSyllables` counts
// vowel-letter groups and drops one for a silent trailing `e`. That undercounts
// the diphthong-as-two-syllables cases English spelling does not mark
// (`science`, `create`, `idea`, `area` — one vowel-group where the word has
// two syllables), so the score this rule reports skews a few points easier
// than the text actually is. See the hand-counted table in readability.test.ts.

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

/** Why a page's declared language and visible text cannot be matched to a scale. */
export type ReadabilityLanguageReason =
  | 'no-declared-language'
  | 'unsupported-language'
  | 'script-mismatch'
  | 'unsupported-script'
  | 'mixed-script';

export type ReadabilityLanguageResult =
  | { readonly usable: true; readonly language: SupportedReadabilityLanguage }
  | { readonly usable: false; readonly reason: ReadabilityLanguageReason };

// A quote or guillemet immediately after the terminator still ends the
// sentence: `"Stop." he said.` ends its first sentence at `."`, not at the
// next terminator two words later.
const SENTENCE_TERMINATOR = /[.!?]+["'»]?(?=\s|$)/g;
const WORD_SPLIT = /\s+/;
const ENGLISH_VOWEL_GROUP = /[aeiouy]+/gi;
const SILENT_TRAILING_E = /[^aeiouy]e$/i;
const CYRILLIC_VOWEL_GROUP = /[аеєиіїоуюя]+/gi;
const LATIN_LETTER = /[a-z]/gi;
const CYRILLIC_LETTER = /[а-яіїєґ]/gi;
const ANY_LETTER = /\p{L}/gu;

/**
 * A declared language's script must make up at least this share of *all* the
 * page's letters (Latin, Cyrillic, or otherwise) for its scale to apply.
 * Below it, the `lang` attribute and the text disagree about what language
 * this is, and neither scale's coefficients were fit for that.
 */
export const SCRIPT_DOMINANCE_THRESHOLD = 0.7;

/** Word count: whitespace-separated tokens, empty string counts as zero words. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(WORD_SPLIT).length;
}

/**
 * Sentence count: runs of `.`/`!`/`?` (optionally followed by a closing
 * quote or guillemet) followed by whitespace or end-of-text. Text with words
 * but no terminator (a heading, a fragment) counts as one sentence rather
 * than zero — dividing words by zero sentences would not. This is a
 * punctuation heuristic, not NLP: "Mr. Smith arrived." counts as two
 * sentences, the same trade-off every readability formula in production use
 * makes rather than parsing abbreviations.
 */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 0;
  }
  const matches = trimmed.match(SENTENCE_TERMINATOR);
  return matches === null || matches.length === 0 ? 1 : matches.length;
}

/**
 * English syllable estimate: vowel-group count, silent trailing `e` dropped,
 * minimum 1. Known bias: undercounts words where English spelling does not
 * mark an extra syllable with an extra vowel group (`science`, `create`,
 * `idea`) — see the hand-counted table in readability.test.ts.
 */
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

function isSupportedLanguage(language: string | null): language is SupportedReadabilityLanguage {
  return (SUPPORTED_READABILITY_LANGUAGES as readonly string[]).includes(language ?? '');
}

/**
 * Whether `text` can be matched to `language`'s scale: `language` must be
 * one this estimate supports, and its script must be the dominant one in
 * `text` (`SCRIPT_DOMINANCE_THRESHOLD`). Three distinct ways this can fail,
 * each naming a different mismatch to the reader:
 *  - `unsupported-script`: the text's letters are mostly neither Latin nor
 *    Cyrillic (or there are none at all) — the declared language names a
 *    script the page barely uses.
 *  - `script-mismatch`: the *other* supported script is the page's actual
 *    majority — a `lang="en"` page whose text is mostly Cyrillic, or the
 *    reverse.
 *  - `mixed-script`: the declared language's script is the largest of the
 *    three, but still short of `SCRIPT_DOMINANCE_THRESHOLD` — too even a mix
 *    to trust the label.
 */
export function resolveReadabilityLanguage(
  declaredLanguage: string | null,
  text: string,
): ReadabilityLanguageResult {
  if (declaredLanguage === null || declaredLanguage === '') {
    return { usable: false, reason: 'no-declared-language' };
  }
  const primary = declaredLanguage.split('-')[0]?.toLowerCase() ?? '';
  if (!isSupportedLanguage(primary)) {
    return { usable: false, reason: 'unsupported-language' };
  }
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  const cyrillic = text.match(CYRILLIC_LETTER)?.length ?? 0;
  const allLetters = text.match(ANY_LETTER)?.length ?? 0;
  const otherLetters = allLetters - latin - cyrillic;
  const matching = primary === 'en' ? latin : cyrillic;
  const otherSupported = primary === 'en' ? cyrillic : latin;
  if (allLetters === 0 || (otherLetters >= matching && otherLetters >= otherSupported)) {
    return { usable: false, reason: 'unsupported-script' };
  }
  if (otherSupported > matching) {
    return { usable: false, reason: 'script-mismatch' };
  }
  if (matching / allLetters < SCRIPT_DOMINANCE_THRESHOLD) {
    return { usable: false, reason: 'mixed-script' };
  }
  return { usable: true, language: primary };
}

/**
 * The page's declared `<html lang>`, normalized to a primary subtag ('en',
 * 'fr', 'uk-UA' → 'uk', 'en_US' → 'en', ...), or null when the attribute is
 * absent or empty. Both `-` and `_` split off the region: browsers only
 * recognize the BCP 47 hyphen, but hand-written HTML uses the POSIX-locale
 * underscore often enough that treating it as "unsupported" would be wrong.
 * This is the raw declaration only — whether it is one this rule can score,
 * and whether the visible text's script agrees with it, is
 * `resolveReadabilityLanguage`'s question, not this one.
 */
export function declaredLanguage(page: PageSnapshot): string | null {
  const declared = parsePage(page).querySelector('html')?.getAttribute('lang')?.trim();
  if (declared === undefined || declared === '') {
    return null;
  }
  return declared.split(/[-_]/)[0]?.toLowerCase() ?? null;
}

/** Readability of `text`, scored on `language`'s scale (already resolved as supported). */
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
