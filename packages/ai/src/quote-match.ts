// Whether a quote a model handed back really occurs in the text it claims to
// quote.
//
// Shared by the claim checks and the tone check of the GEO evaluator: both rest
// on the same rule — a model's quote is accepted only when a reader could find
// it in the answer (or the evidence) they are shown, whatever punctuation style
// the model chose.
//
// Ukrainian text (W1) writes its apostrophe as ʼ (U+02BC), and a model quoting
// it routinely re-types it as ' or ’ — so every apostrophe look-alike folds to
// one, and the guillemets «» fold to a straight double quote. Only punctuation
// folds: a quote whose words are not in the text is still rejected.
//
// Spacing and layout do not count either. Page evidence is text pulled out of
// the DOM, where one block runs into the next ("make this website work.We’d
// like", "Benefits · Births, deaths"), and answers carry markdown ("**GOV.UK**").
// A judge quoting that text the way a person reads it was losing the whole
// verdict. So whitespace beside punctuation is optional and block separators
// count as whitespace — but between two letters the quote must break words
// exactly where the text does, so "the rapist" never matches "therapist".
//
// A judge may elide the middle of a quote with "…", within limits that keep it
// from stitching a sentence out of fragments: a few long parts, close together.

const APOSTROPHE_LIKE = /[‘’‛′ʼʹ`´']/g;
const DOUBLE_QUOTE_LIKE = /[“”‟″«»]/g;
/** The separators a DOM excerpt joins blocks with; read as whitespace. */
const BLOCK_SEPARATOR = /[·•|]/g;
/** Markdown emphasis: formatting, not text. */
const MARKDOWN_EMPHASIS = /\*+/g;
/** An elision the judge marked inside a quote. */
const ELLIPSIS = /\.{3,}|…/;
const MAX_ELIDED_PARTS = 3;
/** Each part of an elided quote must be a phrase, not a word that occurs anywhere. */
const MIN_ELIDED_PART_CHARS = 12;
/** How far apart, in characters without spaces, two parts of one quote may be. */
const MAX_ELISION_GAP_CHARS = 200;

export interface QuoteMatchOptions {
  /** False for a quote that must be one contiguous phrase, such as a tone quote. */
  readonly allowElision?: boolean;
}

function foldPunctuation(text: string): string {
  return text.replace(APOSTROPHE_LIKE, "'").replace(DOUBLE_QUOTE_LIKE, '"');
}

/** Folded text with single spaces, the form word boundaries are read from. */
function normalizeForQuoteMatch(text: string): string {
  // Folded before NFKC as well as after: NFKC decomposes ´ into a space plus a
  // combining accent, and turns full-width look-alikes into ASCII ones.
  return foldPunctuation(foldPunctuation(text).normalize('NFKC'))
    .replace(/[‐-―−]/g, '-')
    .replace(MARKDOWN_EMPHASIS, '')
    .replace(BLOCK_SEPARATOR, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

interface SearchableText {
  /** The normalized text with every space removed. */
  readonly compact: string;
  /** For each compact index, its index in the spaced text. */
  readonly spacedIndex: readonly number[];
  readonly spaced: string;
}

function searchable(text: string): SearchableText {
  const spaced = normalizeForQuoteMatch(text);
  const spacedIndex: number[] = [];
  let compact = '';
  for (let index = 0; index < spaced.length; index += 1) {
    if (spaced[index] === ' ') continue;
    compact += spaced[index];
    spacedIndex.push(index);
  }
  return { compact, spacedIndex, spaced };
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

interface QuotePart {
  /** The part with its spaces removed. */
  readonly compact: string;
  /** Offsets in `compact` where the quote had a space between two letters. */
  readonly breaks: readonly number[];
}

function quotePart(spaced: string): QuotePart {
  const breaks: number[] = [];
  let compact = '';
  for (let index = 0; index < spaced.length; index += 1) {
    const char = spaced[index] ?? '';
    if (char !== ' ') {
      compact += char;
    } else if (WORD_CHAR.test(spaced[index - 1] ?? '') && WORD_CHAR.test(spaced[index + 1] ?? '')) {
      breaks.push(compact.length);
    }
  }
  return { compact, breaks };
}

/**
 * Whether the quote breaks words exactly where the text does. Between two
 * letters, a space in one and none in the other is a different phrase: "the
 * rapist" is not "therapist", and "we do not" is not "we do no tax". Beside
 * punctuation a space is layout either way — "work.We’d" in a glued DOM
 * excerpt is "work. We’d" as a reader quotes it.
 */
function keepsWordBreaks(text: SearchableText, at: number, part: QuotePart): boolean {
  const quoteBreaks = new Set(part.breaks);
  for (let offset = 1; offset < part.compact.length; offset += 1) {
    const left = text.spacedIndex[at + offset - 1] ?? 0;
    const right = text.spacedIndex[at + offset] ?? 0;
    const betweenLetters =
      WORD_CHAR.test(text.spaced[left] ?? '') && WORD_CHAR.test(text.spaced[right] ?? '');
    if (betweenLetters && right - left > 1 !== quoteBreaks.has(offset)) return false;
  }
  return true;
}

/** Where `part` next occurs, with the same word breaks, at or after `from`, or -1. */
function findPart(text: SearchableText, part: QuotePart, from: number): number {
  const { compact } = part;
  for (
    let at = text.compact.indexOf(compact, from);
    at !== -1;
    at = text.compact.indexOf(compact, at + 1)
  ) {
    if (keepsWordBreaks(text, at, part)) return at;
  }
  return -1;
}

function quoteParts(quote: string, allowElision: boolean): readonly QuotePart[] | null {
  const raw = allowElision ? quote.split(ELLIPSIS) : [quote];
  const parts = raw
    // A sentence quoted with or without its full stop is the same quote.
    .map((part) => quotePart(normalizeForQuoteMatch(part).replace(/^[.\s]+|[.\s]+$/g, '')))
    .filter((part) => part.compact !== '');
  if (parts.length === 0 || parts.length > MAX_ELIDED_PARTS) return null;
  if (parts.length > 1 && parts.some((part) => part.compact.length < MIN_ELIDED_PART_CHARS)) {
    return null;
  }
  return parts;
}

/**
 * A quote counts only if the text really contains it, breaking words where
 * the text does; punctuation style, spacing and markdown may differ. An elided quote counts
 * when each of its few long parts appears, in order and close together.
 */
export function quoteOccursIn(
  haystack: string,
  quote: string,
  options: QuoteMatchOptions = {},
): boolean {
  const parts = quoteParts(quote, options.allowElision ?? true);
  if (parts === null) return false;
  return partsFrom(searchable(haystack), parts, 0, null);
}

/** Tries each occurrence of a part, so a later, closer match is not missed. */
function partsFrom(
  text: SearchableText,
  parts: readonly QuotePart[],
  from: number,
  previousEnd: number | null,
): boolean {
  const [part, ...rest] = parts;
  if (part === undefined) return true;
  for (let at = findPart(text, part, from); at !== -1; at = findPart(text, part, at + 1)) {
    if (previousEnd !== null && at - previousEnd > MAX_ELISION_GAP_CHARS) return false;
    const end = at + part.compact.length;
    if (partsFrom(text, rest, end, end)) return true;
  }
  return false;
}
