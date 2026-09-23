// Which characters the report's fonts can actually draw, and what happens to
// the ones they cannot.
//
// THE PROBLEM THIS SOLVES. DejaVu covers Latin, Cyrillic and Greek; it has no
// Han, no Hangul, no Devanagari and no emoji. PDFKit does not complain about a
// character a font has no glyph for — it lays out `.notdef` and carries on — so a
// Japanese `<title>` in an evidence excerpt used to leave the document as a run
// of blank boxes, with nothing in the file, the logs or the page saying that
// anything was dropped. A paid deliverable that silently loses the very text it
// is quoting is worse than one that admits the limit.
//
// WHAT IT DOES INSTEAD. Every character the chosen face cannot draw is written
// out as its own Unicode escape — `頁` becomes `\u{9801}` — so the reader (and
// anyone diffing the PDF against the JSON export) can reconstruct the original
// text exactly, character for character. A run that had to be escaped also has
// its literal backslashes doubled, which is what makes the encoding reversible
// rather than merely suggestive: in an escaped run `\\` is one backslash and
// `\u{…}` is one escaped character, and no third reading exists. Runs that need
// no escaping are left exactly as they were, so an ordinary report is unchanged.
//
// The document states the convention once, in its own language, whenever it had
// to use it (render.ts, `unsupportedGlyphNotice`).
//
// WHY NOT SHIP A FONT THAT COVERS EVERYTHING. There isn't one. Full CJK coverage
// is tens of megabytes per weight, colour emoji is a different rasteriser
// altogether, and fetching either at render time would make a customer's download
// depend on a third-party host — the one thing fonts.ts exists to prevent.

import { openSync, type Font } from 'fontkit';

import { REPORT_FONTS, resolveReportFonts, type ReportFontName } from './fonts.ts';

export interface EscapedText {
  /** The text as it may be drawn: every character has a glyph in the face. */
  readonly text: string;
  /** How many characters had to be escaped. Zero means `text` is the original. */
  readonly escaped: number;
}

/** Characters every face draws, checked before the font is consulted at all. */
function isPlainAscii(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x7e;
}

/**
 * A line break is not a missing glyph.
 *
 * PDFKit handles these itself, and a font is not required to carry them. Passing
 * them through unescaped keeps a multi-line evidence excerpt readable.
 */
function isLayoutCharacter(codePoint: number): boolean {
  return codePoint === 0x0a || codePoint === 0x0d || codePoint === 0x09;
}

function escapeOf(codePoint: number): string {
  return `\\u{${codePoint.toString(16).toUpperCase()}}`;
}

function asFont(opened: ReturnType<typeof openSync>, path: string): Font {
  // `openSync` also answers a collection (.ttc), which has no glyph table of its
  // own. The report's faces are plain TTFs; anything else is a packaging error
  // and is refused here rather than silently covering nothing.
  if (!('hasGlyphForCodePoint' in opened)) {
    throw new Error(`PDF report font ${path} is a font collection, not a single face`);
  }
  return opened;
}

export interface GlyphGuard {
  /** The text `fontName` can draw, with everything else escaped losslessly. */
  readonly escapeUnsupported: (fontName: ReportFontName, value: string) => EscapedText;
}

/**
 * A guard over the three registered faces.
 *
 * The fonts are opened once and the answers cached per face: a report with four
 * thousand findings asks about millions of characters, and `hasGlyphForCodePoint`
 * walks the cmap on every call.
 */
export function createGlyphGuard(
  fontPaths: Readonly<Record<ReportFontName, string>> = resolveReportFonts(),
): GlyphGuard {
  const faces = new Map<ReportFontName, Font>();
  const answers = new Map<ReportFontName, Map<number, boolean>>();

  const supports = (fontName: ReportFontName, codePoint: number): boolean => {
    if (isPlainAscii(codePoint) || isLayoutCharacter(codePoint)) return true;
    let cache = answers.get(fontName);
    if (cache === undefined) {
      cache = new Map<number, boolean>();
      answers.set(fontName, cache);
    }
    const cached = cache.get(codePoint);
    if (cached !== undefined) return cached;
    let face = faces.get(fontName);
    if (face === undefined) {
      const path = fontPaths[fontName] ?? REPORT_FONTS[fontName];
      face = asFont(openSync(path), path);
      faces.set(fontName, face);
    }
    const answer = face.hasGlyphForCodePoint(codePoint);
    cache.set(codePoint, answer);
    return answer;
  };

  return {
    escapeUnsupported(fontName, value) {
      // Iterating the string yields whole code points, so an astral character
      // (every emoji) is one unit rather than two lone surrogates.
      const characters = [...value];
      const unsupported = characters.filter(
        (character) => !supports(fontName, character.codePointAt(0) ?? 0),
      ).length;
      if (unsupported === 0) return { text: value, escaped: 0 };
      const text = characters
        .map((character) => {
          if (character === '\\') return '\\\\';
          const codePoint = character.codePointAt(0) ?? 0;
          return supports(fontName, codePoint) ? character : escapeOf(codePoint);
        })
        .join('');
      return { text, escaped: unsupported };
    },
  };
}
