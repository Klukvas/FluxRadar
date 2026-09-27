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
