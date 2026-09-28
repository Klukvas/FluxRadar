// CONTENT-005 — низкая читабельность (page-level; severity из реестра).
//
// Оракул: успешная HTML-страница с видимым текстом от VISIBLE_TEXT_MIN_CHARS
// символов (порог CONTENT-003 — страница короче него уже получает finding о
// пустоте, а не о сложности) на языке, который умеет мерить readability.ts
// (`html lang` или обнаруженный по алфавиту), даёт finding, когда её счёт по
// шкале языка ниже READABILITY_SCORE_MIN. Страница на любом другом языке, как
// и слишком короткая, applicable-целью не считается вовсе — не «прочитано,
// проблем нет», а «эта проверка её не измеряет».
//
// ПОЧЕМУ READABILITY_SCORE_MIN ОДИН НА ОБЕ ШКАЛЫ. Обе формулы (readability.ts)
// возвращают число в одной и той же логике 0..100, «выше — проще», и порог 30
// — это «Very Confusing» по обеим шкалам Флеша, английской и адаптации
// Оборневой. Он не переиспользуется как единственно возможный: обе формулы
// сохраняют свои коэффициенты неизменными, порог — единственное, что общее.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { NotApplicableReason, PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { codePointLength } from '../seo/dom.js';
import { VISIBLE_TEXT_MIN_CHARS } from './content-003.js';
import {
  documentLanguage,
  measureReadability,
  type ReadabilityMeasurement,
} from './readability.js';
import { visibleText } from './visible-text.js';

const descriptor = requireDescriptor('CONTENT-005');

/** Below this score (both language scales, 0..100, higher = easier) → finding. */
export const READABILITY_SCORE_MIN = 30;

function measurableReadability(page: PageSnapshot): ReadabilityMeasurement | null {
  if (!isSuccessfulHtmlPage(page)) {
    return null;
  }
  const text = visibleText(page);
  if (codePointLength(text) < VISIBLE_TEXT_MIN_CHARS) {
    return null;
  }
  const result = measureReadability(text, documentLanguage(page, text));
  return result.measurable ? result : null;
}

export const content005LowReadability: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: (page: PageSnapshot): boolean => measurableReadability(page) !== null,
  // Причина одна: язык страницы не входит в SUPPORTED_READABILITY_LANGUAGES,
  // либо текста не хватает даже на измерение (обе ветки уже отсеяны
  // CONTENT-003 или другим applicable-правилом раньше в отчёте) — с точки
  // зрения этой проверки то и другое одинаково «нечего судить».
  notApplicableReason: (): NotApplicableReason | undefined => 'no-candidates',
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const readability = measurableReadability(page);
    if (readability === null || readability.score >= READABILITY_SCORE_MIN) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: findingMessage('content-005.evidence', {
          score: Math.round(readability.score),
          minimum: READABILITY_SCORE_MIN,
          scale: readability.scale,
          sentences: readability.sentences,
          words: readability.words,
        }),
        recommendation: findingMessage('content-005.recommendation', {}),
      }),
    ];
  },
};
