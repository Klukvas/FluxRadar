// SEO-TECH-010 — глубина клика (page-level; severity из реестра contracts).
//
// Оракул: прочитанная HTML-страница, отделённая от точки входа обхода на
// DEEP_PAGE_MIN_DEPTH переходов по ссылкам и больше, даёт finding. Глубину
// считает само правило — BFS от точки входа по ссылкам прочитанных страниц
// (clickDepthsFromEntry), — а не берёт из снимка: PageSnapshot.depth это
// расстояние до БЛИЖАЙШЕГО seed-а обхода, а seed-ом служит каждый URL из
// sitemap (crawler.ts enqueue(sitemapPageUrl, 1)). На сайте, чей sitemap
// перечисляет все страницы, такая глубина никогда не превышает 1, и правило
// молчало бы именно там, где владелец и ждёт ответа; а когда всё-таки говорило
// бы — называло бы шаги от sitemap-seed-а «переходами от точки входа», то есть
// врало бы в evidence.
//
// СТРАНИЦА, ДО КОТОРОЙ ССЫЛКАМИ НЕ ДОЙТИ, finding НЕ ДАЁТ: у неё нет глубины, а
// не «глубина большая». Это предмет SEO-TECH-009 (страница, на которую не ведёт
// ни одна ссылка), и называть её «в N переходах» правило не вправе.
//
// ГРАФ ССЫЛОК НЕПОЛОН → Not applicable, как у TECH-009/011 (см. их шапки).
// Непрочитанная страница может СКРЫТЬ короткий путь: сайт home → /nav (таймаут)
// → /x, где /x доступна ещё и через четыре других перехода, дал бы «/x в 4
// переходах от точки входа» для страницы в двух кликах. Ошибка усечения здесь
// идёт не в сторону молчания, а в сторону ложной находки, поэтому знаменатель
// правила зависит от целости графа (isApplicable), и на неполном графе проверка
// отчитывается «не применялась», а не «глубоких страниц нет». Адрес, который
// обход и не собирался читать (чужой хост, шаблоны scope, шаг глубже maxDepth),
// пробелом не считается — см. isDeliberatelyUncrawled в site-index.ts.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  clickDepthsFromEntry,
  discoveredTargets,
  linkGraphGap,
  linkSourcePages,
} from './site-index.js';

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
  isApplicable: (page: PageSnapshot, ctx: SiteContext): boolean =>
    isSuccessfulHtmlPage(page) && linkGraphGap(ctx) === null,
  // Вердикт о странице выносят ссылки ДРУГИХ страниц обхода: путь к ней
  // складывается из них, и выпавшая из обхода страница-источник делает путь
  // неизвестным, а не длинным (§14, RuleEvaluation.inputTargets).
  inputTargets: (ctx: SiteContext): readonly string[] =>
    linkSourcePages(ctx.crawl).map((page) => page.normalizedUrl),
  // Спрос — всё, что обход увидел: страница, которую сайт больше нигде не
  // упоминает, из спроса исчезает, и это починка, а не потеря данных.
  requestedInputs: (ctx: SiteContext): readonly string[] => discoveredTargets(ctx.crawl),
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const depth = clickDepthsFromEntry(ctx).get(page.normalizedUrl);
    if (depth === undefined || depth < DEEP_PAGE_MIN_DEPTH) {
      return [];
    }
    return [
      pageFinding(descriptor, page, {
        evidenceType: 'http',
        evidence: findingMessage('seo-tech-010.evidence', {
          depth,
          entryUrl: ctx.origin,
          threshold: DEEP_PAGE_MIN_DEPTH,
        }),
        recommendation: findingMessage('seo-tech-010.recommendation', {}),
      }),
    ];
  },
};
