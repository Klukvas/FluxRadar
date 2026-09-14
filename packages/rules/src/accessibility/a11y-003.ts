// A11Y-003 — язык документа и структура заголовков (WCAG 1.3.1/2.4.6/3.1.1).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage, type CataloguedFindingMessage } from '../messages/index.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-003');

interface SkippedHeadingLevel {
  readonly fromLevel: number;
  readonly toLevel: number;
}

export const a11y003DocumentStructure: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const html = root.querySelector('html');
    const isLangMissing = (html?.getAttribute('lang')?.trim() ?? '') === '';
    const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const levels = headings.map((heading) => Number.parseInt(heading.rawTagName.slice(1), 10));
    const h1Count = levels.filter((level) => level === 1).length;
    const skippedLevel = firstSkippedLevel(levels);
    if (!isLangMissing && h1Count === 1 && skippedLevel === undefined) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: structureEvidence(isLangMissing, h1Count, skippedLevel),
        recommendation: findingMessage('a11y-003.recommendation', {}),
        selector: isLangMissing ? 'html' : 'h1',
      }),
    ];
  },
};

function firstSkippedLevel(levels: readonly number[]): SkippedHeadingLevel | undefined {
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1] ?? 0;
    const current = levels[index] ?? 0;
    if (current - previous > 1) {
      return { fromLevel: previous, toLevel: current };
    }
  }
  return undefined;
}

// Раньше evidence склеивал до трёх русских фраз. Теперь на каждое сочетание
// проблем свой код, и evidence называет ровно те проблемы, что есть на
// странице: число h1 появляется только когда оно неверное — и всегда как
// проблема («ожидается ровно один»), а не как нейтральное число.
function structureEvidence(
  isLangMissing: boolean,
  h1Count: number,
  skippedLevel: SkippedHeadingLevel | undefined,
): CataloguedFindingMessage {
  const isH1CountWrong = h1Count !== 1;
  if (skippedLevel === undefined) {
    if (!isLangMissing) {
      return findingMessage('a11y-003.evidence.h1-count', { h1Count });
    }
    return isH1CountWrong
      ? findingMessage('a11y-003.evidence.missing-lang.h1-count', { h1Count })
      : findingMessage('a11y-003.evidence.missing-lang', {});
  }
  const { fromLevel, toLevel } = skippedLevel;
  if (isLangMissing && isH1CountWrong) {
    return findingMessage('a11y-003.evidence.missing-lang.h1-count.skipped-level', {
      h1Count,
      fromLevel,
      toLevel,
    });
  }
  if (isLangMissing) {
    return findingMessage('a11y-003.evidence.missing-lang.skipped-level', { fromLevel, toLevel });
  }
  if (isH1CountWrong) {
    return findingMessage('a11y-003.evidence.h1-count.skipped-level', {
      h1Count,
      fromLevel,
      toLevel,
    });
  }
  return findingMessage('a11y-003.evidence.skipped-level', { fromLevel, toLevel });
}
