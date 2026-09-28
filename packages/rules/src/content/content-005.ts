// CONTENT-005 — низкая читабельность (page-level; severity из реестра).
//
// Оракул: успешная HTML-страница с видимым текстом от VISIBLE_TEXT_MIN_CHARS
// символов (порог CONTENT-003 — страница короче него уже получает finding о
// пустоте, а не о сложности), от MIN_PROSE_SENTENCES предложений и от
// MIN_PROSE_WORDS слов прозы, чей `<html lang>` называет английский или
// українську, а переважний алфавіт видимого тексту цій мові відповідає
// (readability.ts, SCRIPT_DOMINANCE_THRESHOLD) — даёт finding, когда её счёт
// по шкале языка ниже READABILITY_SCORE_MIN. Страница, для которой это не
// выполняется по любой из причин, applicable-целью не считается вовсе — не
// «прочитано, проблем нет», а «эта проверка её не измеряет», и репорт (§M1,
// apps/web/src/i18n.ts) называет причину читателю, а не одно на всех
// «ничего подходящего».
//
// ПОЧЕМУ MIN_PROSE_SENTENCES И MIN_PROSE_WORDS ОТДЕЛЬНО ОТ VISIBLE_TEXT_MIN_CHARS.
// 200 символов — это «страница не пустая» (порог CONTENT-003). Список из
// коротких пунктов или таблица цен легко набирает 200+ символов, не будучи
// прозой: делить длину предложения на число «предложений», которых там
// фактически одно (countSentences без терминатора возвращает 1), даёт счёт
// на весь текст целиком и либо ложно проваливает страницу, либо ложно её
// хвалит. Пять предложений и сто слов — это минимум, на котором Flesch
// вообще был откалиброван, а не порог, подобранный под фикстуры.
//
// ПОЧЕМУ READABILITY_SCORE_MIN ОДИН НА ОБЕ ШКАЛЫ. Обе формулы (readability.ts)
// возвращают число в одной и той же логике, «выше — проще», и порог 30 — это
// «Very Confusing» по обеим шкалам Флеша, английской и адаптации Оборневой.
// Он не переиспользуется как единственно возможный: обе формулы сохраняют
// свои коэффициенты неизменными, порог — единственное, что общее. Репорту
// показывается счёт, зажатый в 0..100 (см. clampScore ниже): формула не
// ограничена снизу, а «читабельность −74 из 100» не читается как число из
// заявленной шкалы.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { NotApplicableReason, PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { codePointLength } from '../seo/dom.js';
import { VISIBLE_TEXT_MIN_CHARS } from './content-003.js';
import {
  declaredLanguage,
  measureReadability,
  resolveReadabilityLanguage,
  type ReadabilityMeasurement,
} from './readability.js';
import { visibleText } from './visible-text.js';

const descriptor = requireDescriptor('CONTENT-005');

/** Below this score (both language scales, clamped 0..100, higher = easier) → finding. */
export const READABILITY_SCORE_MIN = 30;

/** Below this many sentences of visible text, a page is not prose this check can measure. */
export const MIN_PROSE_SENTENCES = 5;

/** Below this many words of visible text, a page is not prose this check can measure. */
export const MIN_PROSE_WORDS = 100;

type Applicability =
  | { readonly applicable: true; readonly readability: ReadabilityMeasurement }
  | { readonly applicable: false; readonly reason: NotApplicableReason };

const applicabilityCache = new WeakMap<PageSnapshot, Applicability>();

function evaluateApplicability(page: PageSnapshot): Applicability {
  if (!isSuccessfulHtmlPage(page)) {
    return { applicable: false, reason: 'no-candidates' };
  }
  const text = visibleText(page);
  if (codePointLength(text) < VISIBLE_TEXT_MIN_CHARS) {
    return { applicable: false, reason: 'no-candidates' };
  }
  const language = resolveReadabilityLanguage(declaredLanguage(page), text);
  if (!language.usable) {
    return { applicable: false, reason: language.reason };
  }
  const result = measureReadability(text, language.language);
  if (!result.measurable) {
    return { applicable: false, reason: 'no-candidates' };
  }
  if (result.sentences < MIN_PROSE_SENTENCES || result.words < MIN_PROSE_WORDS) {
    return { applicable: false, reason: 'too-little-prose' };
  }
  return { applicable: true, readability: result };
}

/** `evaluateApplicability`, cached per page snapshot — asked once by `isApplicable`, once by `evaluatePage`. */
function applicabilityOf(page: PageSnapshot): Applicability {
  const cached = applicabilityCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const result = evaluateApplicability(page);
  applicabilityCache.set(page, result);
  return result;
}

/** The reported score, bounded to the 0..100 scale the copy and evidence promise. */
function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

const EVIDENCE_CODE_BY_LANGUAGE = {
  en: 'content-005.evidence.en-scale',
  uk: 'content-005.evidence.uk-scale',
} as const;

/**
 * Why every page of the crawl fell outside this check, when none did — the
 * most common reason among the crawl's successful HTML pages, since each can
 * fail for a different one (no `lang`, an unsupported `lang`, a `lang` the
 * text disagrees with, or too little prose to measure). Ties keep the order
 * the crawl read the pages in, so the result is deterministic.
 */
function aggregateNotApplicableReason(ctx: SiteContext): NotApplicableReason | undefined {
  const successfulPages = ctx.crawl.pages.filter(isSuccessfulHtmlPage);
  if (successfulPages.length === 0) {
    return 'no-candidates';
  }
  const counts = new Map<NotApplicableReason, number>();
  for (const page of successfulPages) {
    const result = applicabilityOf(page);
    if (result.applicable) {
      // applicableTargets was actually 0 for this to be called; an applicable
      // page here means the crawl changed under us mid-evaluation.
      continue;
    }
    counts.set(result.reason, (counts.get(result.reason) ?? 0) + 1);
  }
  let best: NotApplicableReason = 'no-candidates';
  let bestCount = 0;
  for (const [reason, count] of counts) {
    if (count > bestCount) {
      best = reason;
      bestCount = count;
    }
  }
  return best;
}

export const content005LowReadability: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: (page: PageSnapshot): boolean => applicabilityOf(page).applicable,
  notApplicableReason: aggregateNotApplicableReason,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const applicability = applicabilityOf(page);
    if (!applicability.applicable) {
      return [];
    }
    const { readability } = applicability;
    const score = clampScore(readability.score);
    if (score >= READABILITY_SCORE_MIN) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: findingMessage(EVIDENCE_CODE_BY_LANGUAGE[readability.language], {
          score: Math.round(score),
          minimum: READABILITY_SCORE_MIN,
          sentences: readability.sentences,
          words: readability.words,
        }),
        recommendation: findingMessage('content-005.recommendation', {}),
      }),
    ];
  },
};
