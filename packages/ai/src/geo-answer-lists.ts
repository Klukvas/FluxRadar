// Where an AI answer is a list, and where each of its items begins and ends.
//
// Models answer "who should I go to?" in a handful of layouts: numbered lists
// (plain, bold-titled, under `###` headings, with keycap emoji), bullets
// (hyphens, dashes, emoji), Markdown tables, and paragraphs that each open with
// a bold business name. The brand's place in the answer is its place in such a
// list, so each layout is read here into the same shape — the character spans
// of the top-level items — and the position code never needs to know which
// layout it was. Everything here works on text already folded for matching.
//
// Deliberately NOT read as lists, because nothing in the text tells the reading
// apart from a field label or a heading:
//   * `Name: text` lines — "Address: …" and "Price: …" look exactly the same;
//   * paragraphs whose first line is ONLY a bold name — "**Summary**" is a
//     heading as often as "**Dent Pro**" is a business.

export interface ItemSpan {
  readonly start: number;
  readonly end: number;
  /** The indentation of the item's own line. */
  readonly indent: number;
}

export type AnswerList = readonly ItemSpan[];

interface Line {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * A numbered item, also the forms models write in Markdown: `1.`, `1)`,
 * `**1.** Name`, `**1. Name**`, `### 1. Name`, and the keycap `1️⃣ Name`.
 */
const NUMBERED_ITEM =
  /^([ \t]*)(?:#{1,6}[ \t]+)?(?:\*\*|__)?(\d{1,3})(?:[.)]|️?⃣)(?:\*\*|__)?[ \t]+\S/u;
/**
 * A numbered item written as a title — `### 3. Name` or `**3. Name**` — whose
 * description models put on the next, unindented line. Only such an item keeps
 * that paragraph; a plain `3. Name` item ends where unindented text begins.
 */
const TITLE_ITEM = /^[ \t]*(?:#{1,6}[ \t]+.*|(?:\*\*|__)\d{1,3}[.)][ \t]+.*(?:\*\*|__)[ \t]*)$/;
/**
 * A line that opens a block of its own: a Markdown heading, or a line that is
 * nothing but a bold title (`**Conclusion**`). In Markdown a heading starts a
 * new block with or without a blank line before it.
 */
const BLOCK_START = /^[ \t]*(?:#{1,6}[ \t]|(?:\*\*|__)[^*_].*(?:\*\*|__)[ \t]*$)/;
/**
 * A bulleted item. `**Bold**` is not one: a marker needs whitespace after it.
 * The en and em dashes Ukrainian text uses as bullets, and emoji bullets
 * (`🔹 Name`), count only at the start of a line, so a dash inside a sentence
 * is never read as a marker.
 */
const BULLET_ITEM = /^([ \t]*)(?:[-*•‣–—]|\p{Extended_Pictographic}️?)[ \t]+\S/u;
/** A Markdown table row, and the `|---|:--:|` row under a table's header. */
const TABLE_ROW = /^[ \t]*\|/;
const TABLE_SEPARATOR = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** The fewest consecutive `|` lines read as a table: a header, its separator and a row. */
const MIN_TABLE_LINES = 3;
/**
 * A paragraph that opens with a bold name and goes on on the same line —
 * `**Dent Pro** – central…` or `**Dent Pro**: …`. Two or more such paragraphs
 * in a row, with or without blank lines between them, are a list of names.
 */
const BOLD_LEAD = /^(?:\*\*|__)[^*_\n]+(?:\*\*|__)[ \t]*[:–—-]?[ \t]*\S/u;
/** A wrapped line that goes on with the sentence above it, not a new paragraph. */
const LOWERCASE_START = /^[ \t]*\p{Ll}/u;
const MIN_LIST_ITEMS = 2;

function linesOf(text: string): readonly Line[] {
  return text.split('\n').reduce<Line[]>((lines, lineText) => {
    const start = lines.length === 0 ? 0 : (lines[lines.length - 1]?.end ?? 0) + 1;
    return [...lines, { start, end: start + lineText.length, text: lineText }];
  }, []);
}

function indentOf(text: string): number {
  return /^[ \t]*/.exec(text)?.[0].length ?? 0;
}

function isBlank(line: Line): boolean {
  return line.text.trim() === '';
}

/** The folded lines item extents are read from, and which of them wrap a sentence. */
interface ListText {
  readonly lines: readonly Line[];
  /** Whether the line at this index starts in lower case in the unfolded answer. */
  readonly wraps: (lineIndex: number) => boolean;
}

/** A line that cannot be part of the item above it: a heading, a title, a new numbered item. */
function startsOwnBlock(text: string): boolean {
  return BLOCK_START.test(text) || NUMBERED_ITEM.test(text) || TABLE_ROW.test(text);
}

/**
 * Where the last item of a list ends.
 *
 * Indented lines belong to it, and so does an unindented line that carries on
 * the item's sentence (it starts in lower case, with no blank line between). A
 * title item (`### 3. Name`, or a bold-led paragraph) also keeps the
 * description written directly under it. Otherwise unindented text ends the
 * item — the closing paragraph after a list is prose — and an unindented
 * heading, bold-only title, numbered line or table always does.
 */
function lastItemEnd(source: ListText, itemLine: number, keepAttached: boolean): number {
  const { lines } = source;
  const base = indentOf(lines[itemLine]?.text ?? '');
  let end = lines[itemLine]?.end ?? 0;
  let sawBlank = false;
  for (let index = itemLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) break;
    if (isBlank(line)) {
      sawBlank = true;
      continue;
    }
    const unindented = indentOf(line.text) <= base;
    if (unindented && startsOwnBlock(line.text)) break;
    const continues = !sawBlank && (keepAttached || source.wraps(index));
    if (unindented && !continues) break;
    end = line.end;
  }
  return end;
}

function itemSpans(
  source: ListText,
  itemLines: readonly number[],
  keepAttached: (text: string) => boolean,
): AnswerList {
  const { lines } = source;
  return itemLines.map((lineIndex, position) => {
    const next = itemLines[position + 1];
    const start = lines[lineIndex]?.start ?? 0;
    const text = lines[lineIndex]?.text ?? '';
    const indent = indentOf(text);
    return next === undefined
      ? { start, end: lastItemEnd(source, lineIndex, keepAttached(text)), indent }
      : { start, end: (lines[next]?.start ?? start) - 1, indent };
  });
}

/**
 * Numbered lists: items whose numbers run on by one — or that are all numbered
 * 1, which Markdown renders as 1, 2, 3. Text between two items is
 * part of the first one, so a description under each numbered heading does not
 * break the list; a deeper-indented number is a nested item, and a number that
 * does not continue the count starts a new list.
 */
interface NumberedRun {
  readonly base: number;
  readonly next: number;
  /** Every item so far was numbered 1 — Markdown's way of letting the renderer count. */
  readonly allOnes: boolean;
  readonly items: readonly number[];
}

function nextNumberedRun(
  runs: readonly NumberedRun[],
  line: Line,
  index: number,
): readonly NumberedRun[] {
  const match = NUMBERED_ITEM.exec(line.text);
  if (match === null) return runs;
  const indent = match[1]?.length ?? 0;
  const value = Number(match[2]);
  const current = runs[runs.length - 1];
  if (current !== undefined && indent > current.base + 1) return runs;
  const continues =
    current !== undefined && (value === current.next || (current.allOnes && value === 1));
  if (current !== undefined && continues) {
    const extended = {
      base: current.base,
      next: value + 1,
      allOnes: current.allOnes && value === 1,
      items: [...current.items, index],
    };
    return [...runs.slice(0, -1), extended];
  }
  return [...runs, { base: indent, next: value + 1, allOnes: value === 1, items: [index] }];
}

function numberedItemLines(lines: readonly Line[]): readonly (readonly number[])[] {
  return lines
    .reduce<readonly NumberedRun[]>((runs, line, index) => nextNumberedRun(runs, line, index), [])
    .map((run) => run.items)
    .filter((items) => items.length >= MIN_LIST_ITEMS);
}

/** The next line with text after `index`, or undefined at the end of the answer. */
function nextNonBlank(lines: readonly Line[], index: number): Line | undefined {
  return lines.slice(index + 1).find((line) => !isBlank(line));
}

/**
 * An unindented line inside a bulleted list that the list keeps: CommonMark's
 * lazy continuation — a description written under a bullet, with the next
 * bullet still to come at the list's own indentation. Under the LAST bullet
 * the same line is the closing paragraph, and ends the list.
 */
function continuesBullets(lines: readonly Line[], index: number, base: number): boolean {
  const line = lines[index];
  if (line === undefined || startsOwnBlock(line.text)) return false;
  const next = nextNonBlank(lines, index);
  return next !== undefined && BULLET_ITEM.test(next.text) && indentOf(next.text) === base;
}

interface BulletRun {
  readonly base: number;
  readonly items: readonly number[];
}

interface BulletState {
  readonly runs: readonly BulletRun[];
  /** Whether the last run is still being read. */
  readonly open: boolean;
}

function nextBulletState(
  lines: readonly Line[],
  masked: (lineIndex: number) => boolean,
  { runs, open }: BulletState,
  index: number,
): BulletState {
  const line = lines[index];
  if (line === undefined || masked(index)) return { runs, open: false };
  if (isBlank(line)) return { runs, open };
  const indent = indentOf(line.text);
  const isBullet = BULLET_ITEM.test(line.text);
  const current = open ? runs[runs.length - 1] : undefined;
  if (current !== undefined && indent > current.base + (isBullet ? 1 : 0)) return { runs, open };
  if (!isBullet) {
    const keeps = current !== undefined && continuesBullets(lines, index, current.base);
    return { runs, open: keeps };
  }
  if (current === undefined)
    return { runs: [...runs, { base: indent, items: [index] }], open: true };
  const extended = { base: current.base, items: [...current.items, index] };
  return { runs: [...runs.slice(0, -1), extended], open: true };
}

/**
 * Bulleted lists: bullet lines next to each other, with blank, indented and
 * lazily continued lines allowed between them. A bullet indented under a
 * numbered item belongs to that item and is skipped; one at the item's own
 * indentation is a list of its own, as in Markdown — the bullets under a
 * `## 1. Top picks` heading are the picks.
 */
function bulletItemLines(
  lines: readonly Line[],
  masked: (lineIndex: number) => boolean,
): readonly (readonly number[])[] {
  return lines
    .reduce<BulletState>((state, _line, index) => nextBulletState(lines, masked, state, index), {
      runs: [],
      open: false,
    })
    .runs.map((run) => run.items)
    .filter((items) => items.length >= MIN_LIST_ITEMS);
}

/**
 * Markdown tables: a run of `|` lines. The header row (when a separator row
 * follows it) and the separator are skipped; every other row is an item.
 */
function tableLists(lines: readonly Line[]): readonly AnswerList[] {
  const runs = lines.reduce<readonly (readonly number[])[]>((found, line, index) => {
    if (!TABLE_ROW.test(line.text)) return found;
    const last = found[found.length - 1];
    const previous = last?.[last.length - 1];
    return previous === index - 1 && last !== undefined
      ? [...found.slice(0, -1), [...last, index]]
      : [...found, [index]];
  }, []);
  return runs
    .filter((run) => run.length >= MIN_TABLE_LINES)
    .map((run) => {
      const hasHeader = TABLE_SEPARATOR.test(lines[run[1] ?? -1]?.text ?? '');
      return run
        .slice(hasHeader ? 1 : 0)
        .filter((index) => !TABLE_SEPARATOR.test(lines[index]?.text ?? ''))
        .map((index) => ({
          start: lines[index]?.start ?? 0,
          end: lines[index]?.end ?? 0,
          indent: indentOf(lines[index]?.text ?? ''),
        }));
    })
    .filter((items) => items.length >= MIN_LIST_ITEMS);
}

interface BoldLeadState {
  readonly runs: readonly (readonly number[])[];
  readonly open: boolean;
  /** The next text line opens a paragraph. */
  readonly paragraphStart: boolean;
}

function nextBoldLeadState(
  lines: readonly Line[],
  masked: (lineIndex: number) => boolean,
  state: BoldLeadState,
  index: number,
): BoldLeadState {
  const line = lines[index];
  if (line === undefined) return state;
  if (isBlank(line)) return { ...state, paragraphStart: true };
  const lead =
    !masked(index) &&
    indentOf(line.text) === 0 &&
    BOLD_LEAD.test(line.text) &&
    !startsOwnBlock(line.text) &&
    !BULLET_ITEM.test(line.text);
  if (lead) {
    const last = state.open ? state.runs[state.runs.length - 1] : undefined;
    const runs =
      last === undefined
        ? [...state.runs, [index]]
        : [...state.runs.slice(0, -1), [...last, index]];
    return { runs, open: true, paragraphStart: false };
  }
  // A body line of an item's paragraph keeps the run; a paragraph, heading or
  // list item that is not bold-led ends it.
  const ends = state.paragraphStart || startsOwnBlock(line.text) || BULLET_ITEM.test(line.text);
  return { runs: state.runs, open: state.open && !ends, paragraphStart: false };
}

/** Paragraphs that each open with a bold name and text after it, two or more in a row. */
function boldLeadItemLines(
  lines: readonly Line[],
  masked: (lineIndex: number) => boolean,
): readonly (readonly number[])[] {
  return lines
    .reduce<BoldLeadState>(
      (state, _line, index) => nextBoldLeadState(lines, masked, state, index),
      { runs: [], open: false, paragraphStart: true },
    )
    .runs.filter((items) => items.length >= MIN_LIST_ITEMS);
}

/** Whether a line sits inside one of these items, below the item's own line. */
function insideItem(line: Line, lists: readonly AnswerList[], deeperOnly: boolean): boolean {
  const indent = indentOf(line.text);
  return lists.some((items) =>
    items.some(
      (item) =>
        line.start > item.start && line.start <= item.end && (!deeperOnly || indent > item.indent),
    ),
  );
}

/**
 * Every list in the text, each as the spans of its top-level items.
 *
 * `text` is the answer folded for matching; `original` is the same answer
 * before case folding, read only to tell a line that wraps the item's sentence
 * (it starts in lower case) from a new paragraph. Folding lowercases every
 * line, so the folded text cannot tell them apart. When a fold changed the
 * text's length the lines no longer line up, and wrapping is not inferred.
 */
export function listsOf(text: string, original: string): readonly AnswerList[] {
  const lines = linesOf(text);
  const originalLines = original.length === text.length ? linesOf(original) : null;
  const source: ListText = {
    lines,
    wraps: (index) =>
      originalLines !== null && LOWERCASE_START.test(originalLines[index]?.text ?? ''),
  };
  const numbered = numberedItemLines(lines).map((items) =>
    itemSpans(source, items, (line) => TITLE_ITEM.test(line)),
  );
  const nestedInNumbered = (index: number): boolean => {
    const line = lines[index];
    return line !== undefined && insideItem(line, numbered, true);
  };
  const bulleted = bulletItemLines(lines, nestedInNumbered).map((items) =>
    itemSpans(source, items, () => false),
  );
  // A bold-led line inside a numbered or bulleted item is that item's detail
  // ("**Address**: …"), not a list of names of its own.
  const insideAnyItem = (index: number): boolean => {
    const line = lines[index];
    return line !== undefined && insideItem(line, [...numbered, ...bulleted], false);
  };
  const boldLed = boldLeadItemLines(lines, insideAnyItem).map((items) =>
    itemSpans(source, items, () => true),
  );
  return [...numbered, ...bulleted, ...tableLists(lines), ...boldLed];
}

/** Whether the line holding `offset` is a table row — table syntax, not a sentence. */
export function isTableLineAt(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset);
  return TABLE_ROW.test(text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd));
}
