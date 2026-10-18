// Reading a problem's sample findings off the summary, and turning each into a
// page address and one plain line about what was found there.
//
// Everything here is untrusted: the summary comes from the network (and from
// test mocks that answer unknown paths with whatever they have), and the values
// inside it are text copied off the owner's pages — a title can hold anything,
// including markup and line breaks. So the samples are shape-checked one by one,
// page text is stripped of control characters and shortened, and the result is
// only ever rendered as React text.

import type { FindingMessageRef, IssueRuleGroup, IssueSample } from './api';
import { evidenceCopy, type EvidenceValues } from './finding-evidence-copy';
import type { Language } from './i18n';

/** How many findings a row names; the summary carries at most this many. */
export const EVIDENCE_SAMPLE_LIMIT = 3;
/** Page text inside a line: enough to recognise a title, short enough for a row. */
export const EVIDENCE_VALUE_MAX_CHARS = 80;
/** A recorded sentence shown as it was, when no plain line exists for its code. */
export const EVIDENCE_SENTENCE_MAX_CHARS = 160;
export const EVIDENCE_ADDRESS_MAX_CHARS = 60;

// Characters that break a line or control the terminal: they become a space,
// so "Home\nPrices" stays two words.
const BREAKING_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x2028, 0x2029],
];

// Characters that draw nothing: the soft hyphen, the Arabic, Mongolian and
// word-joining format marks, zero-width spaces, bidirectional controls, the
// BOM, interlinear annotation marks and the tag block. They are removed, not
// spaced, so a soft hyphen inside a word leaves the word whole; the bidi ones
// could otherwise make an excerpt read differently from what it holds. U+200D
// (zero-width joiner) is deliberately kept: it glues emoji sequences together.
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];

function inRanges(character: string, ranges: readonly (readonly [number, number])[]): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return ranges.some(([first, last]) => codePoint >= first && codePoint <= last);
}

function visibleCharacter(character: string): string {
  if (inRanges(character, BREAKING_RANGES)) return ' ';
  return inRanges(character, INVISIBLE_RANGES) ? '' : character;
}

/** One line of page text: no control characters, single spaces, at most `max` characters. */
export function cleanEvidenceText(value: string, max: number = EVIDENCE_VALUE_MAX_CHARS): string {
  const flattened = [...value].map(visibleCharacter).join('').replace(/\s+/g, ' ').trim();
  const codePoints = [...flattened];
  if (codePoints.length <= max) return flattened;
  return `${codePoints
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * An address as a row shows it: host and path, no scheme or fragment —
 * `mysalon.com.ua/prices`. Kept as recorded otherwise, so a row never shows an
 * address the scan did not visit.
 */
export function shortAddress(url: string): string {
  const shown = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/#.*$/, '');
  return cleanEvidenceText(shown, EVIDENCE_ADDRESS_MAX_CHARS);
}

function isParamValue(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function readMessageRef(value: unknown): FindingMessageRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const { code, params } = value as { code?: unknown; params?: unknown };
  if (typeof code !== 'string' || typeof params !== 'object' || params === null) return null;
  const entries = Object.entries(params);
  return entries.every(([, param]) => isParamValue(param))
    ? { code, params: Object.fromEntries(entries) as Record<string, string | number> }
    : null;
}

function readMessages(value: unknown): IssueSample['messages'] {
  if (typeof value !== 'object' || value === null) return null;
  const { evidence, recommendation } = value as { evidence?: unknown; recommendation?: unknown };
  const evidenceRef = readMessageRef(evidence);
  const recommendationRef = readMessageRef(recommendation);
  return evidenceRef === null || recommendationRef === null
    ? null
    : { evidence: evidenceRef, recommendation: recommendationRef };
}

function readSentences(value: unknown): IssueSample['evidence'] {
  if (typeof value !== 'object' || value === null) return null;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function readSample(value: unknown): IssueSample | null {
  if (typeof value !== 'object' || value === null) return null;
  const { targetUrl, messages, evidence } = value as Record<string, unknown>;
  if (typeof targetUrl !== 'string' || targetUrl.trim() === '') return null;
  return { targetUrl, messages: readMessages(messages), evidence: readSentences(evidence) };
}

/** A group's samples that can be read; none for an older API, the example, or a stray mock. */
export function readIssueSamples(group: IssueRuleGroup): readonly IssueSample[] {
  const samples: unknown = (group as { samples?: unknown }).samples;
  if (!Array.isArray(samples)) return [];
  return samples
    .map(readSample)
    .filter((sample): sample is IssueSample => sample !== null)
    .slice(0, EVIDENCE_SAMPLE_LIMIT);
}

/** Thrown by a line that needs a value the finding did not record; the line is then not shown. */
class MissingEvidenceValue extends Error {}

function evidenceValues(params: Readonly<Record<string, string | number>>): EvidenceValues {
  const text = (name: string): string => {
    const value = params[name];
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new MissingEvidenceValue(name);
    const cleaned = cleanEvidenceText(String(value));
    if (cleaned === '') throw new MissingEvidenceValue(name);
    return cleaned;
  };
  const optionalCount = (name: string): number | null => {
    const value = params[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  return {
    text,
    optionalCount,
    count: (name) => {
      const value = optionalCount(name);
      if (value === null) throw new MissingEvidenceValue(name);
      return value;
    },
  };
}

function plainLine(messages: NonNullable<IssueSample['messages']>, language: Language) {
  const { lines } = evidenceCopy[language];
  // Own keys only: a code such as "constructor" must not reach Object.prototype.
  const line = Object.hasOwn(lines, messages.evidence.code)
    ? lines[messages.evidence.code]
    : undefined;
  if (line === undefined) return null;
  // The recommendation's values carry the recommended range (min–max) that the
  // evidence of a too-short or too-long value names only one end of.
  const values = evidenceValues({ ...messages.recommendation.params, ...messages.evidence.params });
  try {
    return line(values);
  } catch (caught) {
    if (caught instanceof MissingEvidenceValue) return null;
    throw caught;
  }
}

/**
 * What one finding recorded, in one line for a row; null when it recorded
 * nothing the row can say (the row then reads as it always did).
 *
 * A plain line where the code has one, else the recorded sentence in the
 * reader's language, shortened.
 */
export function evidenceLine(sample: IssueSample, language: Language): string | null {
  const plain = sample.messages === null ? null : plainLine(sample.messages, language);
  if (plain !== null) return plain;
  const sentence = sample.evidence?.[language];
  if (typeof sentence !== 'string') return null;
  const cleaned = cleanEvidenceText(sentence, EVIDENCE_SENTENCE_MAX_CHARS);
  return cleaned === '' ? null : cleaned;
}
