// Reads text back out of a produced PDF, so a test can assert on what the
// customer will actually see.
//
// WHY THIS EXISTS. `bytes.startsWith('%PDF-')` is not a test of a report. It
// passed while the document was three times longer than its content, while every
// content page was missing its footer, while evidence was being cut at four
// thousand characters, and while every Chinese character in the file was being
// laid out as `.notdef`. Each of those is visible in the extracted text, and none
// of them is visible in the header.
//
// WHAT IT UNDERSTANDS. Exactly what PDFKit writes for an embedded TrueType
// subset: uncompressed object dictionaries, Flate-compressed content streams,
// `Identity-H` two-byte glyph codes, and the `/ToUnicode` CMap that maps them
// back (`bfchar` and both `bfrange` forms). It is a test utility, not a PDF
// library: anything outside that shape is not decoded rather than guessed at.
//
// The page texts it returns were cross-checked against `pdftotext` on the same
// artifacts.

import { inflateSync } from 'node:zlib';

interface PdfObject {
  readonly number: number;
  readonly dictionary: string;
  readonly stream: Buffer | null;
}

const OBJECT_HEADER = /(?:^|[\r\n])(\d+) 0 obj/g;
const STREAM_START = /stream\r?\n/;

/** Every `N 0 obj … endobj` in the file, keyed by its object number. */
function readObjects(bytes: Buffer): Map<number, PdfObject> {
  const text = bytes.toString('latin1');
  const objects = new Map<number, PdfObject>();
  for (const match of text.matchAll(OBJECT_HEADER)) {
    const number = Number(match[1]);
    const start = match.index + match[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) continue;
    const body = text.slice(start, end);
    const streamAt = STREAM_START.exec(body);
    if (streamAt === null) {
      objects.set(number, { number, dictionary: body, stream: null });
      continue;
    }
    const dictionary = body.slice(0, streamAt.index);
    const streamStart = start + streamAt.index + streamAt[0].length;
    const length = /\/Length (\d+)/.exec(dictionary);
    const streamEnd =
      length === null ? text.indexOf('endstream', streamStart) : streamStart + Number(length[1]);
    const raw = bytes.subarray(streamStart, streamEnd);
    const inflate = dictionary.includes('/FlateDecode');
    objects.set(number, {
      number,
      dictionary,
      stream: inflate ? tryInflate(raw) : raw,
    });
  }
  return objects;
}

function tryInflate(raw: Buffer): Buffer | null {
  try {
    return inflateSync(raw);
  } catch {
    // A stream this reader cannot decode contributes nothing rather than
    // failing the whole extraction: font programs are also Flate streams.
    return null;
  }
}

function referenceIn(dictionary: string, key: string): number | null {
  const match = new RegExp(`${key} (\\d+) 0 R`).exec(dictionary);
  return match === null ? null : Number(match[1]);
}

/** The pages in the order the catalogue lists them. */
function pageNumbersOf(objects: Map<number, PdfObject>): readonly number[] {
  for (const object of objects.values()) {
    if (!object.dictionary.includes('/Type /Pages')) continue;
    const kids = /\/Kids \[([^\]]*)\]/.exec(object.dictionary)?.[1];
    if (kids === undefined) continue;
    return [...kids.matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1] ?? 0));
  }
  return [...objects.values()]
    .filter((object) => /\/Type \/Page[^s]/.test(object.dictionary))
    .map((object) => object.number);
}

/** Unicode for one glyph code, per the font's `/ToUnicode` CMap. */
type CodeMap = Map<number, string>;

/**
 * One destination of a CMap, as the string it stands for.
 *
 * The words are UTF-16BE and may be separated by spaces — PDFKit writes an
 * astral character as its two surrogates, `<d83d de80>`. An empty destination
 * (`<>`) is a glyph with no code point at all, and counts as one entry: dropping
 * it would shift every mapping after it.
 */
function decodeUtf16(hex: string): string {
  const packed = hex.replaceAll(/\s+/g, '');
  let out = '';
  for (let index = 0; index + 4 <= packed.length; index += 4) {
    out += String.fromCharCode(Number.parseInt(packed.slice(index, index + 4), 16));
  }
  return out;
}

function parseToUnicode(cmap: string): CodeMap {
  const map: CodeMap = new Map();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of (block[1] ?? '').matchAll(/<([0-9a-fA-F ]*)>\s*<([0-9a-fA-F ]*)>/g)) {
      map.set(Number.parseInt(entry[1] ?? '', 16), decodeUtf16(entry[2] ?? ''));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // Walked in order rather than matched by shape: the two forms
    // (`<lo> <hi> <dst>` and `<lo> <hi> [<a> <b> …]`) share a prefix, and a
    // pattern for the first also matches three consecutive entries inside the
    // array of the second.
    const tokens = [...(block[1] ?? '').matchAll(/<([0-9a-fA-F ]*)>|(\[[\s\S]*?\])/g)];
    for (let index = 0; index + 2 < tokens.length; index += 3) {
      const low = tokens[index]?.[1];
      const high = tokens[index + 1]?.[1];
      const destination = tokens[index + 2];
      if (low === undefined || high === undefined || destination === undefined) break;
      const first = Number.parseInt(low, 16);
      const last = Number.parseInt(high, 16);
      const array = destination[2];
      if (array !== undefined) {
        [...array.matchAll(/<([0-9a-fA-F ]*)>/g)].forEach((entry, offset) => {
          map.set(first + offset, decodeUtf16(entry[1] ?? ''));
        });
        continue;
      }
      const start = destination[1];
      if (start === undefined) break;
      for (let code = first; code <= last && code - first < 0x10000; code += 1) {
        map.set(code, decodeUtf16(shiftHex(start, code - first)));
      }
    }
  }
  return map;
}

/** The destination `offset` codes after `hex`, in the same width. */
function shiftHex(hex: string, offset: number): string {
  return (Number.parseInt(hex, 16) + offset).toString(16).padStart(hex.length, '0');
}

/** The `/Fn` → code map table for one page's resources. */
function fontsOf(objects: Map<number, PdfObject>, page: PdfObject): Map<string, CodeMap> {
  const resourcesRef = referenceIn(page.dictionary, '/Resources');
  const resources =
    resourcesRef === null ? page.dictionary : (objects.get(resourcesRef)?.dictionary ?? '');
  const fontBlock = /\/Font <<([\s\S]*?)>>/.exec(resources);
  const fonts = new Map<string, CodeMap>();
  if (fontBlock === null) return fonts;
  for (const entry of (fontBlock[1] ?? '').matchAll(/\/(\w+) (\d+) 0 R/g)) {
    const name = entry[1];
    const font = objects.get(Number(entry[2]));
    if (name === undefined || font === undefined) continue;
    const toUnicode = referenceIn(font.dictionary, '/ToUnicode');
    const stream = toUnicode === null ? null : objects.get(toUnicode)?.stream;
    if (stream === null || stream === undefined) continue;
    fonts.set(name, parseToUnicode(stream.toString('latin1')));
  }
  return fonts;
}

/**
 * One page's text, with a line break wherever the document moved the cursor.
 *
 * Runs are separated rather than concatenated so that two independent `text()`
 * calls do not read as one word, which is what an assertion on a footer or a
 * heading depends on.
 */
function textOfContent(content: string, fonts: Map<string, CodeMap>): string {
  let current: CodeMap | undefined;
  const lines: string[] = [];
  let line = '';
  const token =
    /\/(\w+) [\d.]+ Tf|(BT|ET|Tm|Td|TD|T\*)|<([0-9a-fA-F]*)>\s*(Tj|TJ)?|\[([\s\S]*?)\]\s*TJ/g;
  for (const match of content.matchAll(token)) {
    if (match[1] !== undefined) {
      current = fonts.get(match[1]);
      continue;
    }
    if (match[2] !== undefined) {
      if (line !== '') lines.push(line);
      line = '';
      continue;
    }
    const hex = match[3];
    if (hex !== undefined) {
      line += decodeGlyphs(hex, current);
      continue;
    }
    const array = match[5];
    if (array !== undefined) {
      for (const part of array.matchAll(/<([0-9a-fA-F]*)>/g)) {
        line += decodeGlyphs(part[1] ?? '', current);
      }
    }
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

function decodeGlyphs(hex: string, map: CodeMap | undefined): string {
  if (map === undefined) return '';
  let out = '';
  for (let index = 0; index + 4 <= hex.length; index += 4) {
    out += map.get(Number.parseInt(hex.slice(index, index + 4), 16)) ?? '';
  }
  return out;
}

/** The text of every page, in page order. */
export function extractPdfPages(bytes: Buffer): readonly string[] {
  const objects = readObjects(bytes);
  return pageNumbersOf(objects).map((number) => {
    const page = objects.get(number);
    if (page === undefined) return '';
    const contents = referenceIn(page.dictionary, '/Contents');
    const stream = contents === null ? null : objects.get(contents)?.stream;
    if (stream === null || stream === undefined) return '';
    return textOfContent(stream.toString('latin1'), fontsOf(objects, page));
  });
}

/** How many pages the file has, counted from the page tree. */
export function pdfPageCount(bytes: Buffer): number {
  return pageNumbersOf(readObjects(bytes)).length;
}
