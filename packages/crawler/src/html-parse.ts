// The one place the scanner turns a page's HTML into a DOM.
//
// WHY A WRAPPER AROUND node-html-parser
//
// node-html-parser treats `script`, `noscript`, `style` and `pre` as *block
// text* elements: whatever stands between the open tag and the close tag is one
// raw text node, never markup. It finds that close tag by literal string
// search — `data.indexOf('</' + tagName + '>')`, with `tagName` spelled exactly
// as the opening tag spelled it (dist/nodes/html.js, `base_parse`). The HTML
// spec is wider: a raw text element ends at `</name` (ASCII case-insensitive)
// followed by tab, LF, FF, CR, space, `/` or `>`, and the tag then runs on to
// the next `>`
// (https://html.spec.whatwg.org/multipage/parsing.html#script-data-end-tag-name-state).
//
// So `</noscript\n    >` — exactly what Prettier produces when it wraps a long
// line — and `</script >`, `</style\t>`, `</script/>`, `<Script>…</script>` are
// all invisible to that literal search, and EVERYTHING after the opening tag
// becomes raw text of the element. A production scan of fluxradar.net's own
// blog read h1 = 0, main = 0, h2 = 0 and no `[role]` on pages that serve one
// `<h1>`, one `<main id="blog-main">` and nine `<h2>`: three rules reported
// landmarks and headings missing that the page has. The same silent truncation
// hits every rule, crawl link discovery and profile parsing on any customer
// site written this way.
//
// The fix is a pre-pass that rewrites exactly those end tags into the literal
// form node-html-parser looks for, and changes nothing else. Patching the
// dependency or swapping parsers is a bigger decision than one false positive;
// this keeps the parser's behaviour and only stops it from losing the document.
//
// WHY THE PRE-PASS BORROWS THE PARSER'S OWN TOKENISER
//
// To find the opening tag of a raw text element, the pass has to answer three
// questions the parser also answers: is this `<…>` a comment, is it a tag, and
// where does it end. A first version answered them with hand-written rules — a
// tag ends at the first `>`, `<!--` opens a comment — and those are not the
// parser's rules:
//
//   `<img alt="1 > 0 <style>">` ended at the `>` inside the quoted value, so
//     the leftover `<style>` looked like an opened raw text element with no end
//     tag and the pass stopped reading there. The parser honours the quotes.
//   `<p>x<!-- oops` made the pass wait for a `-->` that never comes and give
//     up. An unterminated comment is not a comment to the parser: its pattern
//     matches `<!--…-->` only, so it goes on matching tags inside the `<!--`.
//   `<p>if a<b, c<script>` read `<b, c<script>` as one tag. The parser's
//     pattern accepts a tag only when the name is followed by whitespace, `/`
//     or `>`, so it rejects `<b,` and matches the `<script>`.
//
// Every disagreement had one consequence: the pass walked past the `<script>`
// it was there to fix, the end tag kept its spec-only spelling, and the page
// truncated exactly as it did before the pre-pass existed. So the walk below is
// node-html-parser's own — its `kMarkupPattern`, iterated the way `base_parse`
// iterates it, with the same jump over raw text — and the only question this
// module answers for itself is the one it exists for: which string ends a raw
// text element.

import { parse, type HTMLElement, type Options } from 'node-html-parser';

/**
 * node-html-parser's markup pattern, copied verbatim from its `kMarkupPattern`
 * (dist/nodes/html.js), which the package does not export.
 *
 * Only ever read for `.source` and `.flags`: each walk gets its own instance,
 * so no `lastIndex` is shared between calls. Exported for the drift guard in
 * html-parse.test.ts, which re-reads the installed dependency and fails if this
 * copy stops being the pattern the parser uses — a copied regex that silently
 * stops matching the original is how the pass and the parser drift apart again.
 */
export const PARSER_MARKUP_PATTERN =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][-.:0-9_a-zA-Z@\xB7\xC0-\xD6\xD8-\xF6\u00F8-\u03A1\u03A3-\u03D9\u03DB-\u03EF\u03F7-\u03FF\u0400-\u04FF\u0500-\u052F\u1D00-\u1D2B\u1D6B-\u1D77\u1D79-\u1D9A\u1E00-\u1E9B\u1F00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2126\u212A-\u212B\u2132\u214E\u2160-\u2188\u2C60-\u2C7F\uA722-\uA787\uA78B-\uA78E\uA790-\uA7AD\uA7B0-\uA7B7\uA7F7-\uA7FF\uAB30-\uAB5A\uAB5C-\uAB5F\uAB64-\uAB65\uFB00-\uFB06\uFB13-\uFB17\uFF21-\uFF3A\uFF41-\uFF5A\x37F-\u1FFF\u200C-\u200D\u203F-\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]*)((?:\s+[^>]*?(?:(?:'[^']*')|(?:"[^"]*"))?)*)\s*(\/?)>/gu;

/**
 * node-html-parser's own default `blockTextElements` (`base_parse`), which the
 * package does not export either.
 *
 * It is handed to `parse` explicitly on every call, so the list this module
 * rewrites end tags for and the list the parser treats as raw text are the same
 * value and cannot drift apart. Covered by the same drift guard.
 */
export const PARSER_DEFAULT_BLOCK_TEXT_ELEMENTS: Options['blockTextElements'] = {
  script: true,
  noscript: true,
  style: true,
  pre: true,
};

/**
 * Characters that may follow the tag name of a raw text end tag.
 *
 * Anything else means it is not an end tag at all: `</scripts>` is text inside
 * the script, not the close of it.
 */
const END_TAG_TERMINATORS = new Set(['\t', '\n', '\f', '\r', ' ', '/', '>']);

const UPPER_A = 'A'.charCodeAt(0);
const UPPER_Z = 'Z'.charCodeAt(0);
const LOWER_A = 'a'.charCodeAt(0);

/**
 * Parses a page's HTML into a DOM.
 *
 * The scanner's single parse entry point: it normalises the end tags of raw
 * text elements that node-html-parser would otherwise miss (see the file
 * header) and then hands the document to node-html-parser with the caller's
 * own options. On markup that already writes those end tags in the literal
 * `</tag>` form the result is identical to calling `parse` directly.
 */
export function parseHtml(html: string, options: Partial<Options> = {}): HTMLElement {
  const blockTextElements = options.blockTextElements ?? PARSER_DEFAULT_BLOCK_TEXT_ELEMENTS;
  return parse(normalizeRawTextEndTags(html, Object.keys(blockTextElements)), {
    ...options,
    blockTextElements,
  });
}

/**
 * Rewrites every spec-valid raw text end tag into `</` + the opening tag's own
 * spelling + `>`.
 *
 * The opening tag's spelling rather than lower case, because that is the string
 * node-html-parser will search for, and because leaving the opening tag
 * untouched keeps `rawTagName` — and with it every selector and every
 * serialisation — exactly as it is today.
 *
 * The walk is the parser's: `kMarkupPattern` from one `exec` to the next, and
 * on an opened raw text element the jump `base_parse` makes, straight past the
 * end tag, so inner markup is never read as markup here either. node-html-parser
 * wraps the document in a `<documentfragmentcontainer>` before matching, which
 * only shifts positions — except at the very end of the document, where the
 * appended `>` can complete a tag the raw HTML leaves open. Behind such a tag
 * the parser reads attribute text where this pass, walking the unwrapped HTML,
 * read markup, so the pass may rewrite an end tag inside it:
 *
 *   `<a t="x>y<script>z</script\n>w" ` — the wrapper's `>` completes the
 *     `<a …`, so the rewritten document carries `</script>` inside its
 *     attributes where a bare `parse` carries `</script\n>`.
 *
 * That is the whole effect: one whitespace character inside an attribute of an
 * element the document never closed, same tree and same text, nothing
 * truncated and no selector answered differently. It is deliberately not
 * mirrored — the wrapper is the parser's own padding rather than part of the
 * page, and reproducing it here would tie this pass to an implementation
 * detail of the dependency it works around.
 */
function normalizeRawTextEndTags(html: string, blockTextTags: readonly string[]): string {
  // No `</` means no end tag to rewrite, so the walk could not change a
  // character: on degenerate markup (`<a ` a million times over, not one `>` in
  // it) one scan for `</` replaces it and measures 2-3x cheaper.
  if (!html.includes('</')) return html;
  const isBlockTextTag = blockTextElementMatcher(blockTextTags);
  const markup = new RegExp(PARSER_MARKUP_PATTERN.source, PARSER_MARKUP_PATTERN.flags);
  // Local accumulation: the rewritten pieces of one input string that is never
  // itself modified.
  const pieces: string[] = [];
  let copiedUpTo = 0;
  for (let match = markup.exec(html); match !== null; match = markup.exec(html)) {
    const openedTag = blockTextTagOpenedBy(match, isBlockTextTag);
    if (openedTag === null) continue;
    const endTag = findSpecEndTag(html, markup.lastIndex, openedTag);
    // No end tag at all: node-html-parser takes the rest of the document as this
    // element's raw text, and so does this pass — today's behaviour, unchanged.
    if (endTag === null) break;
    const literal = `</${openedTag}>`;
    if (html.slice(endTag.start, endTag.end) !== literal) {
      pieces.push(html.slice(copiedUpTo, endTag.start), literal);
      copiedUpTo = endTag.end;
    }
    markup.lastIndex = endTag.end;
  }
  if (pieces.length === 0) return html;
  return [...pieces, html.slice(copiedUpTo)].join('');
}

/**
 * The tag name whose raw text begins after this match, or null for every other
 * match.
 *
 * The tests are `base_parse`'s own, in its order: `matchText[1] === '!'` is a
 * comment, group 1 holds the leading slash of an end tag, group 2 the tag name.
 * A closing slash is deliberately not consulted — node-html-parser starts raw
 * text on `<script/>` too and only treats the element as self-closed once the
 * end tag has been found.
 */
function blockTextTagOpenedBy(
  match: RegExpExecArray,
  isBlockTextTag: (tagName: string) => boolean,
): string | null {
  const matchText = match[0] ?? '';
  const leadingSlash = match[1] ?? '';
  const tagName = match[2] ?? '';
  if (matchText[1] === '!' || leadingSlash !== '') return null;
  return isBlockTextTag(tagName) ? tagName : null;
}

/**
 * `is_block_text_element` from `base_parse`, built the same way: every key of
 * `blockTextElements` becomes `^key$` with the `i` flag, whatever the key's
 * value — the parser skips the raw text of a falsy key as well, and only the
 * text node it keeps depends on the value.
 */
function blockTextElementMatcher(tags: readonly string[]): (tagName: string) => boolean {
  const patterns = tags.map((tag) => new RegExp(`^${tag}$`, 'i'));
  return (tagName) => patterns.some((pattern) => pattern.test(tagName));
}

interface EndTagRange {
  /** Index of the `<` of `</name…>`. */
  readonly start: number;
  /** Index just past its `>`. */
  readonly end: number;
}

/**
 * First spec-valid `</name…>` at or after `from`, or null if there is none.
 *
 * The name is matched ASCII case-insensitively, as the spec matches it, and the
 * tag then runs to the next `>`: attributes on an end tag are a parse error the
 * spec discards, and discarding them here is what makes `</script foo>`
 * findable. A `>` inside a quoted attribute value of such an end tag ends it
 * early and leaves the remainder as text — a parse error inside a parse error,
 * and the same text in the rewritten document as in the original.
 */
function findSpecEndTag(html: string, from: number, name: string): EndTagRange | null {
  let cursor = from;
  for (;;) {
    const start = html.indexOf('</', cursor);
    if (start < 0) return null;
    const nameStart = start + 2;
    if (isAsciiTagNameAt(html, nameStart, name)) {
      const tagEnd = html.indexOf('>', nameStart + name.length);
      return tagEnd < 0 ? null : { start, end: tagEnd + 1 };
    }
    cursor = nameStart;
  }
}

/** `name` stands at `offset` (ASCII case-insensitive) and a terminator follows. */
function isAsciiTagNameAt(html: string, offset: number, name: string): boolean {
  for (let index = 0; index < name.length; index += 1) {
    if (
      toAsciiLowerCode(html.charCodeAt(offset + index)) !== toAsciiLowerCode(name.charCodeAt(index))
    ) {
      return false;
    }
  }
  const after = html[offset + name.length];
  return after !== undefined && END_TAG_TERMINATORS.has(after);
}

function toAsciiLowerCode(code: number): number {
  return code >= UPPER_A && code <= UPPER_Z ? code + (LOWER_A - UPPER_A) : code;
}
