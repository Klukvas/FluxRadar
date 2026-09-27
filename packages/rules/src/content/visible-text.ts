// Видимый текст страницы для CONTENT-003 и CONTENT-001: текст body без
// содержимого script/style, сущности раскрыты, пробелы схлопнуты. Обход
// рекурсивный и НЕ мутирует document — parsePage кэширует разбор снимка для
// всех правил (dom.ts), удалять из него узлы нельзя.
//
// РЕЗУЛЬТАТ КЭШИРУЕТСЯ НА СНИМОК (WeakMap, как parsePage). Текст одного снимка
// спрашивают трижды: индекс дублей строит по нему группу, CONTENT-001 берёт
// длину и начало для evidence, CONTENT-003 меряет порог. Обход DOM на каждый
// вопрос означал бы три полных прохода по body каждой страницы сайта.
//
// СУЩНОСТИ РАСКРЫТЫ, ПОТОМУ ЧТО ТЕКСТ — ВИДИМЫЙ. `Tom &amp; Jerry` читатель
// видит как `Tom & Jerry`, и ровно так же его видит поисковик: считать эти две
// страницы разными значило бы пропустить дубль из-за того, каким редактором
// набрана одна из них. Длина в CONTENT-003 по той же причине считается по
// раскрытому тексту: пять символов `&amp;` — это один видимый символ.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { Node } from 'node-html-parser';
import { HTMLElement, TextNode } from 'node-html-parser';

import { parsePage } from '../seo/dom.js';

const INVISIBLE_TAGS = new Set(['script', 'style']);

const textCache = new WeakMap<PageSnapshot, string>();

/** Видимый текст body (или всего документа, если body нет) после collapse. */
export function visibleText(page: PageSnapshot): string {
  const cached = textCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const root = parsePage(page);
  const body = root.querySelector('body') ?? root;
  const text = collectText(body).replace(/\s+/g, ' ').trim();
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
