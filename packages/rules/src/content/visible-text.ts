// Видимый текст страницы для CONTENT-003: текст body без содержимого
// script/style, пробелы схлопнуты. Обход рекурсивный и НЕ мутирует
// document — parsePage кэширует разбор снимка для всех правил (dom.ts),
// удалять из него узлы нельзя.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { Node } from 'node-html-parser';
import { HTMLElement, TextNode } from 'node-html-parser';

import { parsePage } from '../seo/dom.js';

const INVISIBLE_TAGS = new Set(['script', 'style']);

/** Видимый текст body (или всего документа, если body нет) после collapse. */
export function visibleText(page: PageSnapshot): string {
  const root = parsePage(page);
  const body = root.querySelector('body') ?? root;
  return collectText(body).replace(/\s+/g, ' ').trim();
}

function collectText(node: Node): string {
  if (node instanceof TextNode) {
    return node.rawText;
  }
  if (node instanceof HTMLElement) {
    if (INVISIBLE_TAGS.has(node.rawTagName?.toLowerCase() ?? '')) {
      return '';
    }
    return node.childNodes.map(collectText).join('');
  }
  return '';
}
