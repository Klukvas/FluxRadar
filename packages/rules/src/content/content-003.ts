// CONTENT-003 — пустые/малосодержательные страницы (page-level; severity
// из реестра).
//
// Оракул: видимый текст body (без script/style, пробелы схлопнуты,
// длина в Unicode code points — та же метрика, что у лимитов §16) строго
// меньше 200 символов → finding; ровно 200 — норма (boundary 199/200).
// Excerpt — фактическая длина и начало текста.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { codePointLength } from '../seo/dom.js';
import { visibleText } from './visible-text.js';

const descriptor = requireDescriptor('CONTENT-003');

/** Порог §10/T-09: страницы с текстом короче 200 символов — малосодержательные. */
export const VISIBLE_TEXT_MIN_CHARS = 200;

/** Сколько символов текста показывать в excerpt. */
const EXCERPT_PREVIEW_CHARS = 120;

export const content003LowValuePages: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const text = visibleText(page);
    const length = codePointLength(text);
    if (length >= VISIBLE_TEXT_MIN_CHARS) {
      return [];
    }
    const preview = [...text].slice(0, EXCERPT_PREVIEW_CHARS).join('');
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence:
          `Видимый текст: ${length} символов < ${VISIBLE_TEXT_MIN_CHARS} ` +
          `(малосодержательная страница): "${preview}"`,
        recommendation:
          'Наполните страницу содержательным текстом или закройте её от индексации ' +
          '(noindex), если она служебная.',
      }),
    ];
  },
};
