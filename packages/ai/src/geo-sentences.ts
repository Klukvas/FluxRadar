// Where a model's answer breaks into sentences.
//
// Shared by the mention context (the sentence quoted around the first brand
// mention) and the mention position (which sentence the brand first appears
// in), so the two never disagree about where one sentence ends and the next
// begins.

/**
 * What separates two sentences in a model's answer.
 *
 * Group 1 is terminal punctuation together with any closing quote or bracket
 * that trails it, so `said "hi."` is not cut between the dot and the quote.
 * Group 3 is a line break, which model answers use as a sentence end far more
 * often than a full stop — they are list-heavy. Both sides of the quote read
 * the same pattern, so a break that starts a sentence also ends one.
 */
const SENTENCE_BREAK = String.raw`([.!?]["'”’»)\]]*)(\s+|$)|(\n+)`;

/**
 * Words whose full stop does not end a sentence. A short, fixed list on
 * purpose: a longer one starts guessing, and a wrong guess here only ever
 * shows a customer a quote that begins mid-clause.
 *
 * Ukrainian answers abbreviate addresses and names the same way — «вул.»,
 * «м.», «просп.» — and splitting there put a brand named in the next words
 * into a later sentence than the one it is in. «грн» is deliberately NOT here:
 * in answers about prices «650 грн.» ends a sentence far more often than it
 * sits inside one, and treating it as an abbreviation would glue two sentences
 * together. «р.» (рік) is left out for the same reason: «відкрито у 2015 р.»
 * ends a sentence as often as it sits inside one.
 */
const ABBREVIATIONS: readonly string[] = [
  'dr',
  'mr',
  'mrs',
  'ms',
  'st',
  'vs',
  'e.g',
  'i.e',
  'etc',
  'вул',
  'м',
  'просп',
  'пров',
  'бул',
  'пл',
  'буд',
  'кв',
  'обл',
  'тел',
  'ім',
  'св',
  'напр',
  'т.д',
  'т.п',
];

/** Whether the text ending at a candidate break ends with one of those words, in any script. */
function endsWithAbbreviation(textThroughBreak: string): boolean {
  const word = /([\p{L}.]+)\.$/u.exec(textThroughBreak)?.[1];
  return word !== undefined && ABBREVIATIONS.includes(word.toLowerCase());
}

/** A break is real unless the dot belongs to an abbreviation; a line break always is. */
function isSentenceBreak(text: string, match: RegExpExecArray): boolean {
  if (match[3] !== undefined) return true;
  return !endsWithAbbreviation(text.slice(0, match.index + (match[1]?.length ?? 0)));
}

/** Where the sentence containing `index` starts — after the last break before it. */
function sentenceStart(text: string, index: number): number {
  const pattern = new RegExp(SENTENCE_BREAK, 'g');
  let start = 0;
  let match = pattern.exec(text);
  while (match !== null && match.index < index) {
    const breakEnd = match.index + match[0].length;
    if (breakEnd > index) break;
    if (isSentenceBreak(text, match)) start = breakEnd;
    match = pattern.exec(text);
  }
  return start;
}

/** Where it ends — at the first real break from `index` on, punctuation included. */
function sentenceEnd(text: string, index: number): number {
  const pattern = new RegExp(SENTENCE_BREAK, 'g');
  pattern.lastIndex = index;
  let match = pattern.exec(text);
  while (match !== null) {
    if (isSentenceBreak(text, match)) {
      // A line break is not part of the sentence; terminal punctuation is.
      return match[3] === undefined ? match.index + (match[1]?.length ?? 0) : match.index;
    }
    match = pattern.exec(text);
  }
  return text.length;
}

/**
 * The list marker a bullet line opens with — never part of the sentence quoted.
 * The en and em dashes count as markers only at the start of a line: a
 * sentence that merely begins with « – » after a full stop keeps its dash.
 */
const LEADING_LIST_MARKER = /^(?:[-*•‣–—]|\d+[.)])\s+/;

/** Whether the sentence starting at `start` is also the start of a line. */
function startsLine(text: string, start: number): boolean {
  return start === 0 || text[start - 1] === '\n';
}

/** The sentence around `index` in `text` — bounded by the nearest sentence break. */
export function sentenceAround(text: string, index: number): string {
  const start = sentenceStart(text, index);
  const sentence = text.slice(start, sentenceEnd(text, index)).trim();
  return startsLine(text, start) ? sentence.replace(LEADING_LIST_MARKER, '') : sentence;
}

/** Whether a span of text has anything in it besides whitespace and list markers. */
function hasContent(text: string): boolean {
  return text.replace(LEADING_LIST_MARKER, '').trim() !== '';
}

/**
 * Where every sentence with content begins, in order.
 *
 * The same breaks `sentenceAround` honours: terminal punctuation that is not an
 * abbreviation's full stop, and every line break.
 */
export function sentenceStarts(text: string): readonly number[] {
  const pattern = new RegExp(SENTENCE_BREAK, 'g');
  const breaks: number[] = [0];
  let match = pattern.exec(text);
  while (match !== null) {
    if (isSentenceBreak(text, match)) breaks.push(match.index + match[0].length);
    match = pattern.exec(text);
  }
  return breaks.filter((start, index) =>
    hasContent(text.slice(start, breaks[index + 1] ?? text.length)),
  );
}
