// What `parseHtml` has to see that a bare node-html-parser `parse` does not.
//
// Most cases here are markup node-html-parser answers with "the document ends
// inside this script/noscript/style/pre": it looks for the literal `</tag>` the
// opening tag spelled, while the HTML spec ends a raw text element at `</tag`
// plus one of tab, LF, FF, CR, space, `/` or `>`. What the scanner lost was
// everything after that end tag — on fluxradar.net's own blog, the `<main>`
// and the `<h1>`.
//
// The rest guard the pre-pass against the way it first went wrong: its own idea
// of where a tag or a comment starts and ends. Where it disagreed with
// node-html-parser it walked past the very element it was there to fix, and the
// page truncated as if there were no pre-pass at all. Hence the parity suite
// (nothing to fix must mean nothing changed) and the drift guard (the copied
// `kMarkupPattern` must still be the parser's).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { parse } from 'node-html-parser';
import { describe, expect, it } from 'vitest';

import {
  PARSER_DEFAULT_BLOCK_TEXT_ELEMENTS,
  PARSER_MARKUP_PATTERN,
  parseHtml,
} from './html-parse.js';

/**
 * The production blog page the bug was found on, kept as a rules fixture
 * (`loadFixtureContext` reads it there) and read from here because it is the
 * one real page in the repository that writes a raw text end tag this way.
 */
function blogPage(): string {
  return readFileSync(
    new URL('../../rules/fixtures/fx-raw-text-end-tag-negative.html', import.meta.url),
    'utf8',
  );
}

/** The installed node-html-parser's parse source, read the way the crawler imports it. */
function parserSource(): string {
  const require = createRequire(import.meta.url);
  return readFileSync(
    join(dirname(require.resolve('node-html-parser')), 'nodes', 'html.js'),
    'utf8',
  );
}

describe('parseHtml raw text end tags', () => {
  it.each([
    ['a newline before `>`, as Prettier wraps it', '<noscript><style>a{}</style></noscript\n    >'],
    ['a space before `>`', '<script>var a = 1;</script >'],
    ['a tab before `>`', '<style>a{}</style\t>'],
    ['a slash before `>`', '<script>var a = 1;</script/>'],
    ['attributes on the end tag', '<script>var a = 1;</script foo>'],
    ['an upper-case end tag', '<script>var a = 1;</SCRIPT>'],
    ['a mixed-case opening tag', '<Script>var a = 1;</script>'],
    ['a mixed-case pre block', '<PRE>text</pre\n>'],
  ])('sees the content after %s', (_case, rawText) => {
    const root = parseHtml(`<html><body>${rawText}<main><h1>Hi</h1></main></body></html>`);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('main')).toHaveLength(1);
  });

  // Markup where the pre-pass only finds the `<script>` it has to fix if it
  // tokenises exactly as node-html-parser does. Each of these truncated the
  // document while the pass recognised tags and comments by its own rules.
  it.each([
    [
      'a quoted `>` and a `<style>` inside an attribute value',
      '<img alt="1 > 0 <style>"><script>a</script\n>',
    ],
    ['a comment that is never terminated', '<p>x<!-- oops<p>y</p><noscript>z</noscript\n>'],
    ['`<b,`, which is not a tag at all', '<p>if a<b, c<script>var a=1;</script\n>'],
    ['`<scriptx`, which is not a `<script>`', '<p><scriptx<script>var a=1;</script\n>'],
  ])('reads the document past %s', (_case, head) => {
    const root = parseHtml(`${head}<main><h1>Hi</h1></main>`);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('main')).toHaveLength(1);
  });

  it('leaves markup inside a raw text element as text', () => {
    const root = parseHtml('<body><script>var s = "<h1>";</script\n><h1>x</h1></body>');
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('script')?.text).toBe('var s = "<h1>";');
  });

  it('does not treat `</scripts>` as an end tag', () => {
    const root = parseHtml('<body><script>a</scripts><h1>x</h1></script></body>');
    expect(root.querySelectorAll('h1')).toHaveLength(0);
    expect(root.querySelector('script')?.text).toBe('a</scripts><h1>x</h1>');
  });

  it('does not treat `</noscripted>` as an end tag', () => {
    const root = parseHtml('<body><noscript>a</noscripted><h1>x</h1></noscript></body>');
    expect(root.querySelectorAll('h1')).toHaveLength(0);
  });

  // A raw text element with no end tag at all swallows the rest of the document
  // (node-html-parser drops the element and keeps the text): its own behaviour,
  // and the pre-pass must not invent an end tag to change it.
  it('leaves a raw text element that is never closed exactly as it was', () => {
    const root = parseHtml('<body><script>var a = 1;<main><h1>Hi</h1></main></body>');
    expect(root.querySelectorAll('h1')).toHaveLength(0);
    expect(root.text).toContain('<h1>Hi</h1>');
  });

  // A commented-out `<script>` opens nothing, so the real content after the
  // comment stays markup rather than becoming that element's raw text.
  it('does not open a raw text element from an HTML comment', () => {
    const root = parseHtml('<body><!-- <script> --><main><h1>Hi</h1></main></body>');
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('main')).toHaveLength(1);
  });

  it('normalises several end tag spellings in one document', () => {
    const root = parseHtml(
      '<head><style>a{}</style\n><noscript><p>js off</p></noscript ></head>' +
        '<body><main><h1>Hi</h1></main></body>',
    );
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('style')?.text).toBe('a{}');
    expect(root.querySelector('noscript')?.text).toBe('<p>js off</p>');
  });

  // `<script>` written inside an attribute value is not an element to
  // node-html-parser either, so the pre-pass must not stop reading there.
  it('keeps reading when a raw text tag name only appears inside an attribute', () => {
    const root = parseHtml('<body><div title="a<script>">t</div><h1>x</h1></body>');
    expect(root.querySelectorAll('h1')).toHaveLength(1);
  });

  it('rewrites the end tags of a caller-supplied blockTextElements list', () => {
    const root = parseHtml('<body><template>t</template\n><main><h1>Hi</h1></main></body>', {
      blockTextElements: { template: true },
    });
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('template')?.text).toBe('t');
  });

  it('returns an empty document for empty HTML', () => {
    expect(parseHtml('').querySelectorAll('*')).toHaveLength(0);
  });

  // Reads the blog page as production serves it: three rules reported the
  // landmarks and headings below as missing because the document ended at the
  // `</noscript\n    >` in its <head>.
  it('reads the whole production blog page, not just its <head>', () => {
    const root = parseHtml(blogPage());
    expect(root.querySelectorAll('main').map((main) => main.getAttribute('id'))).toEqual([
      'blog-main',
    ]);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelectorAll('h2')).toHaveLength(9);
  });
});

// Where the end tags are already the literal `</tag>` node-html-parser looks
// for, the pre-pass has nothing to do and must be invisible — not "close
// enough", but the same DOM character for character.
describe('parseHtml parses a document with literal end tags exactly as parse does', () => {
  it.each([
    '<html><head><style>a{}</style></head><body><main><h1>Hi</h1></main>' +
      '<script>var a=1;</script></body></html>',
    '<img alt="1 > 0 <style>"><script>a</script><main><h1>Hi</h1></main>',
    '<p>x<!-- oops<p>y</p><noscript>z</noscript><main><h1>Hi</h1></main>',
    '<p>if a<b, c<script>var a=1;</script><main><h1>Hi</h1></main>',
    '<p><scriptx<script>var a=1;</script><main><h1>Hi</h1></main>',
    '<body><script>a</scripts><h1>x</h1></script></body>',
    // The parser's attribute pattern honours a quote only where the `>` it
    // hides still leads to a tag the pattern can finish, so here the tag is
    // `<a title="x>` and `y"z>` is text. Borrowing the pattern is what makes
    // the pre-pass agree about that instead of guessing.
    '<a title="x>y"z><h1>t</h1>',
    '<pre>  spaced  </pre><h1>t</h1>',
    '<script>var a=1;</script><script>var b=2;</script><h1>t</h1>',
  ])('parses %s like parse', (html) => {
    expect(parseHtml(html).toString()).toBe(parse(html).toString());
  });

  it('parses the production blog page with its end tag literalised like parse', () => {
    const literalised = blogPage().replace(/<\/noscript\s+>/g, '</noscript>');
    expect(literalised).not.toContain('</noscript\n');
    expect(parseHtml(literalised).toString()).toBe(parse(literalised).toString());
  });
});

// The pre-pass walks the document with two values copied out of the
// dependency's compiled source, because the package exports neither. A copy is
// only as good as its guard: without this suite the next `pnpm up
// node-html-parser` could change the parser's tokenisation and leave the pass
// silently tokenising the old way — the exact failure mode the copy exists to
// prevent.
describe('the node-html-parser internals this module copies', () => {
  it('still declares kMarkupPattern as PARSER_MARKUP_PATTERN copies it', () => {
    const declaration = /^const kMarkupPattern = \/(.*)\/([a-z]*);?$/m.exec(parserSource());
    expect(declaration, 'no `const kMarkupPattern = /…/;` in dist/nodes/html.js').not.toBeNull();
    // Compiled rather than compared as written, so the guard fires on a
    // changed pattern and not on a reformat of the same one: a dropped `;` is
    // already optional above, and `new RegExp` reports the flags in their
    // canonical order, so `/ug` reads the same as `/gu`. Any real difference —
    // one character of the body, one flag — still shows up in `.source` or
    // `.flags`, and an unsupported flag throws here rather than passing.
    const declared = new RegExp(declaration?.[1] ?? '', declaration?.[2] ?? '');
    expect(declared.source).toBe(PARSER_MARKUP_PATTERN.source);
    expect(declared.flags).toBe(PARSER_MARKUP_PATTERN.flags);
  });

  it('still defaults blockTextElements as PARSER_DEFAULT_BLOCK_TEXT_ELEMENTS copies it', () => {
    const literal = /const elements = options\.blockTextElements \|\| \{([^}]*)\};/.exec(
      parserSource(),
    );
    expect(literal, 'no `options.blockTextElements || {…}` in dist/nodes/html.js').not.toBeNull();
    const defaults = [...(literal?.[1] ?? '').matchAll(/([A-Za-z][\w-]*)\s*:\s*(true|false)/g)].map(
      (entry) => [entry[1] ?? '', entry[2] === 'true'] as const,
    );
    expect(Object.fromEntries(defaults)).toEqual(PARSER_DEFAULT_BLOCK_TEXT_ELEMENTS);
  });
});
