// A11Y-010 — landmarks и медиа для assistive technology (WCAG 1.3.1/1.2.2).

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { accessibleName, elementSelector } from './helpers.js';
import { parsePage } from '../seo/dom.js';

const descriptor = requireDescriptor('A11Y-010');

export const a11y010ScreenReaderEvidence: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const root = parsePage(page);
    const mainLandmarks = root.querySelectorAll('main, [role="main"]');
    const invalidMain = mainLandmarks.length === 0 || mainLandmarks.length > 1;
    const iframe = root
      .querySelectorAll('iframe')
      .find((element) => (element.getAttribute('title')?.trim() ?? '') === '');
    const video = root
      .querySelectorAll('video')
      .find(
        (element) =>
          element.querySelectorAll('track[kind="captions"], track[kind="subtitles"]').length === 0,
      );
    const nav = root
      .querySelectorAll('nav')
      .find(
        (element) =>
          accessibleName(element, root) === '' && root.querySelectorAll('nav').length > 1,
      );
    const target = invalidMain ? (root.querySelector('html') ?? root) : (iframe ?? video ?? nav);
    if (target === undefined) {
      return [];
    }
    const reason = invalidMain
      ? mainLandmarks.length === 0
        ? 'на странице отсутствует main landmark'
        : 'на странице несколько main landmarks'
      : iframe !== undefined
        ? 'iframe без title'
        : video !== undefined
          ? 'video без track captions/subtitles'
          : 'один из нескольких nav landmarks не имеет доступного имени';
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'dom',
        evidence: `${elementSelector(target)}: ${reason}`,
        recommendation:
          'Добавьте единственный main landmark, назовите повторяющиеся nav landmarks и ' +
          'предоставьте title для iframe и captions/subtitles для video.',
        selector: elementSelector(target),
      }),
    ];
  },
};
