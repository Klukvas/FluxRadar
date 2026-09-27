// SEO-TECH-010 — глубина клика (page-level; severity из реестра contracts).
//
// Оракул: прочитанная HTML-страница, отделённая от точки входа обхода на
// DEEP_PAGE_MIN_DEPTH переходов по ссылкам и больше, даёт finding. Глубину
// считает сам обход (PageSnapshot.depth, BFS от точки входа), поэтому вердикт
// выводится из собственного снимка страницы — своих входов у правила нет.
//
// ПОЧЕМУ ПРАВИЛО НЕ БОИТСЯ УСЕЧЁННОГО ОБХОДА, в отличие от TECH-009/011:
// пропущенная страница может только СКРЫТЬ короткий путь, а не выдумать
// длинный, и очередь обхода — FIFO по глубине, поэтому depth снимка это длина
// кратчайшего известного пути. Ошибка усечения здесь идёт в сторону молчания.
//
// ЧТО ПРАВИЛО НЕ ВИДИТ. Страница, попавшая в обход из sitemap, получает depth 1
// независимо от того, сколько кликов до неё на самом деле (crawler.ts
// enqueue(sitemapPageUrl, 1)), а явный seed владельца — 0: для обхода это точки
// входа. Такая страница остаётся без finding, даже если по ссылкам она глубоко;
// это осознанный недосчёт, а не ложная тишина о странице, которую обход прошёл
// ссылками.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';

const descriptor = requireDescriptor('SEO-TECH-010');

/**
 * С какой глубины страница считается слишком глубокой.
 *
 * Четыре перехода: до трёх включительно страница лежит в пределах обычной
 * навигации (главная → раздел → подраздел → страница), а всё, что дальше,
 * пользователь и краулер находят заметно позже.
 */
export const DEEP_PAGE_MIN_DEPTH = 4;

export const seoTech010DeepPages: PageRule = {
  kind: 'page',
  descriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    if (page.depth < DEEP_PAGE_MIN_DEPTH) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: findingMessage('seo-tech-010.evidence', {
          depth: page.depth,
          entryUrl: ctx.origin,
          threshold: DEEP_PAGE_MIN_DEPTH,
        }),
        recommendation: findingMessage('seo-tech-010.recommendation', {}),
      }),
    ];
  },
};
