// Видимый текст страницы: текст body без содержимого script/style, сущности
// раскрыты, пробелы схлопнуты, форма NFC. Обход рекурсивный и НЕ мутирует
// document — parsePage кэширует разбор снимка для всех правил (dom.ts), удалять
// из него узлы нельзя.
//
// КТО ЕГО СПРАШИВАЕТ (весь список, потому что решения ниже меняют ответ каждому):
//  • CONTENT-003 — меряет длину против порога в 200 символов (content-003.ts);
//  • CONTENT-001 — через shared/duplicate-groups.ts: текст идёт в ключ группы, а
//    его длина и начало — в evidence находки;
//  • отчёт готовности к AI-краулерам — extractableContent той же меркой в 200
//    символов (ai-readiness.ts);
//  • статический разбор UX — первые MAX_TEXT символов уезжают в запрос к модели
//    как доказательство о странице (ux/analyzer.ts).
//
// РЕЗУЛЬТАТ КЭШИРУЕТСЯ НА СНИМОК (WeakMap, как parsePage). Текст одного снимка
// спрашивают не меньше трёх раз: индекс дублей строит по нему группу, CONTENT-001
// берёт длину и начало для evidence, CONTENT-003 меряет порог. Обход DOM на
// каждый вопрос означал бы столько же полных проходов по body каждой страницы.
//
// СУЩНОСТИ РАСКРЫТЫ, ПОТОМУ ЧТО ТЕКСТ — ВИДИМЫЙ. `Tom &amp; Jerry` читатель
// видит как `Tom & Jerry`, и ровно так же его видит поисковик: считать эти две
// страницы разными значило бы пропустить дубль из-за того, каким редактором
// набрана одна из них. Длина по той же причине считается по раскрытому тексту:
// пять символов `&amp;` — это один видимый символ.
//
// NFC — ЗДЕСЬ, А НЕ У СПРАШИВАЮЩЕГО. «Café» составным é и «Café» готовым é —
// одно слово для читателя, и одна строка для группировки дублей. Пока к NFC
// приводил только индекс дублей, CONTENT-001 сообщал о странице из macOS одну
// длину, а CONTENT-003 мерил против порога другую — на 50 символов больше на
// каждые 50 составных é. Нормализация в кэше означает, что все спрашивающие
// видят один и тот же текст и одну и ту же его длину.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { Node } from 'node-html-parser';
import { HTMLElement, TextNode } from 'node-html-parser';

import { parsePage } from '../seo/dom.js';

const INVISIBLE_TAGS = new Set(['script', 'style']);

const textCache = new WeakMap<PageSnapshot, string>();

/** Видимый текст body (или всего документа, если body нет): collapse и NFC. */
export function visibleText(page: PageSnapshot): string {
  const cached = textCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const root = parsePage(page);
  const body = root.querySelector('body') ?? root;
  const text = collectText(body).replace(/\s+/g, ' ').trim().normalize('NFC');
  textCache.set(page, text);
  return text;
}

function collectText(node: Node): string {
  if (node instanceof TextNode) {
    // .text, а не .rawText: `&amp;` — это один видимый символ, а не пять.
    return node.text;
  }
  if (node instanceof HTMLElement) {
    if (INVISIBLE_TAGS.has(node.rawTagName?.toLowerCase() ?? '')) {
      return '';
    }
    return node.childNodes.map(collectText).join('');
  }
  return '';
}

// Prose, for CONTENT-005's purposes, is the text of `<p>`, `<blockquote>` and
// `<dd>` elements only — the tags a reader experiences as running sentences,
// not a heading, a list item, or a table cell, each of which is a label or a
// fragment rather than something Flesch's formulas were fit to score. A list
// of short labels or a pricing table can easily clear 200 visible characters
// without containing a single sentence; scoring it as prose would either
// flag it falsely or praise it falsely (see the rationale in content-005.ts).
//
// Tag identity alone is not enough (T9 review H6): a `<p>` inside a `<td>`
// is still a table cell's fragment, not a sentence, whether or not the CMS
// wrapped that cell's text in a `<p>` — Gutenberg's table block and most
// Markdown renderers' loose lists do exactly that. So a prose tag is only
// prose when nothing between it and `<body>` is itself a non-prose
// structural container: a list item, a table (and everything inside one),
// a list, or a `<dt>` label. `<dl>` itself stays a pass-through rather than
// an excluded container, so `<dd>` — a PROSE_TAGS member — still counts;
// only its sibling `<dt>` is pruned, which is "outside dd" for a `<dl>`.
const PROSE_TAGS = new Set(['p', 'blockquote', 'dd']);

// Chrome the reader does not read as the page's message: navigation, page
// header/footer, sidebars, forms, and the structural containers above. A
// `<p>` inside a `<nav>` (a footer sitemap blurb, say) is still chrome, not
// prose — skip the whole subtree rather than only the container's own text.
const EXCLUDED_CONTAINERS = new Set([
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'li',
  'td',
  'th',
  'table',
  'ul',
  'ol',
  'dt',
]);

// The ARIA landmark roles that mark the same chrome as EXCLUDED_CONTAINERS,
// for markup that uses a `<div role="navigation">` instead of a `<nav>`.
const EXCLUDED_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary']);

function hasExcludedRole(node: HTMLElement): boolean {
  const role = node.getAttribute('role');
  return role !== undefined && EXCLUDED_ROLES.has(role.trim().toLowerCase());
}

const proseTextCache = new WeakMap<PageSnapshot, string>();

/**
 * Like `visibleText`, but scoped to prose (see `PROSE_TAGS` above) and for
 * CONTENT-005's sentence/word measurement only: each prose block ends with
 * `". "` in the output, so `countSentences` (readability.ts) sees a boundary
 * between two adjacent blocks even when the source HTML has no punctuation
 * or whitespace at the seam (minified `</p><p>`). Not used for
 * CONTENT-001/003's exact-match and length checks — those must keep reading
 * the page's literal visible text, not a version that both narrows scope and
 * inserts punctuation.
 */
export function proseText(page: PageSnapshot): string {
  const cached = proseTextCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const root = parsePage(page);
  const body = root.querySelector('body') ?? root;
  const text = collectProseText(body).replace(/\s+/g, ' ').trim().normalize('NFC');
  proseTextCache.set(page, text);
  return text;
}

function collectProseText(node: Node): string {
  if (!(node instanceof HTMLElement)) {
    return '';
  }
  const tag = node.rawTagName?.toLowerCase() ?? '';
  if (INVISIBLE_TAGS.has(tag) || EXCLUDED_CONTAINERS.has(tag) || hasExcludedRole(node)) {
    return '';
  }
  if (PROSE_TAGS.has(tag)) {
    // Trimmed, not raw: a nested prose block (L12) already ends its own
    // text in ". " (its own recursive call below), and interpolating the
    // untrimmed string would leave a space between that period and this
    // one — two adjacent-but-for-a-space terminators that countSentences
    // (readability.ts) reads as two boundaries instead of one. Trimming
    // first makes the two periods adjacent, which its regex merges into
    // a single terminator, same as a source sentence that already ends
    // in its own punctuation.
    const inner = node.childNodes.map(collectProseBlockText).join('').trim();
    return inner === '' ? '' : `${inner}. `;
  }
  return node.childNodes.map(collectProseText).join('');
}

// Text directly inside a prose block (a `<p>`, `<blockquote>` or `<dd>`):
// plain text and inline elements (`<strong>`, `<a>`, …) concatenate as one
// sentence, same as collectText, but a nested prose tag — a `<p>` inside a
// `<blockquote>` or a `<dd>`, which Markdown and CMS output both produce —
// recurses through collectProseText instead, so it gets its own `". "`
// boundary rather than gluing onto its neighbor (T9 review L12). A nested
// excluded container (a `<form>` or `<nav>` a browser would actually hoist
// out of a `<p>`) is pruned the same as anywhere else in the tree.
function collectProseBlockText(node: Node): string {
  if (node instanceof TextNode) {
    return node.text;
  }
  if (!(node instanceof HTMLElement)) {
    return '';
  }
  const tag = node.rawTagName?.toLowerCase() ?? '';
  if (INVISIBLE_TAGS.has(tag) || EXCLUDED_CONTAINERS.has(tag) || hasExcludedRole(node)) {
    return '';
  }
  if (PROSE_TAGS.has(tag)) {
    return collectProseText(node);
  }
  return node.childNodes.map(collectProseBlockText).join('');
}
