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
// КАНДИДАТ — СТРАНИЦА, А НЕ АДРЕС, и называется она адресом документа. Один
// документ обход держит под двумя адресами всякий раз, когда навигация
// ссылается на `/about`, а сервер уводит на `/about/`: судит его один снимок на
// адрес (addressJudges, как у TECH-011), а находка и checkedTargets названы
// canonicalAddress. Иначе одна страница получала бы вердикт дважды на одном
// прогоне — и в знаменателе «N страниц проверено» оказались бы снимки вместо
// страниц, — а личность находки менялась бы между прогонами по порядку очереди
// обхода, а не по состоянию сайта. Снимок, уехавший редиректом за область
// обхода, кандидатом не бывает вовсе: «эта страница в четырёх переходах от вашей
// главной» о чужом сайте — утверждение не о навигации владельца (leftCrawlScope).
//
// ГЛУБИНУ ПРАВИЛО СПРАШИВАЕТ ТЕМ ЖЕ АДРЕСОМ ДОКУМЕНТА. Ссылка на страницу бывает
// написана и адресом назначения (`/about/`) при единственном снимке под адресом
// редиректа (`/about`) — тогда глубина лежит под адресом документа, и спросить
// её адресом снимка значило бы назвать страницу проверенной, ничего не измерив
// (click-depth.ts). ИНВАРИАНТ: страница, попавшая в checkedTargets, либо
// получила глубину, либо до неё действительно не дойти ссылками — иначе прошлая
// находка о всё ещё глубокой странице закрылась бы как исправленная (§14).
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
import { pageFindingAt } from '../engine/finding.js';
import type { NotApplicableReason, PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { clickDepthsFromEntry } from './click-depth.js';
import { linkGraphGap } from './link-graph-gap.js';
import {
  canonicalAddress,
  discoveredTargets,
  judgesPageAddress,
  linkSourceAddresses,
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
  // Знаменатель считает документы, а не снимки: два адреса одного документа —
  // одна применимая цель, и судит её один снимок (addressJudges).
  isApplicable: (page: PageSnapshot, ctx: SiteContext): boolean =>
    judgesPageAddress(page, ctx.crawl) && linkGraphGap(ctx) === null,
  // Названа цель адресом, по которому страница живёт.
  judgedAddress: (page: PageSnapshot, ctx: SiteContext): string =>
    canonicalAddress(ctx.crawl, page.normalizedUrl),
  // Вердикт о странице выносят ссылки ДРУГИХ страниц обхода: путь к ней
  // складывается из них, и выпавшая из обхода страница-источник делает путь
  // неизвестным, а не длинным (§14, RuleEvaluation.inputTargets).
  inputTargets: (ctx: SiteContext): readonly string[] => linkSourceAddresses(ctx.crawl),
  // Спрос — всё, что обход увидел: страница, которую сайт больше нигде не
  // упоминает, из спроса исчезает, и это починка, а не потеря данных.
  requestedInputs: (ctx: SiteContext): readonly string[] => discoveredTargets(ctx.crawl),
  // Применимых страниц не бывает по двум разным причинам, и отчёт обязан их
  // различать: граф ссылок неполон — или обход не принёс ни одной прочитанной
  // HTML-страницы вовсе. Вторую правило не называет: там молчит весь модуль, и
  // «переходы посчитать нельзя» о ней сказало бы не больше, чем общая строка.
  notApplicableReason: (ctx: SiteContext): NotApplicableReason | undefined =>
    linkGraphGap(ctx) === null ? undefined : 'link-graph-gap',
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    // Адресом документа, а не адресом снимка: глубину странице дала ссылка, и
    // написана она бывает любой из двух форм её адреса (click-depth.ts).
    const depth = clickDepthsFromEntry(ctx).get(canonicalAddress(ctx.crawl, page.normalizedUrl));
    if (depth === undefined || depth < DEEP_PAGE_MIN_DEPTH) {
      return [];
    }
    return [
      pageFindingAt(descriptor, canonicalAddress(ctx.crawl, page.normalizedUrl), page, {
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
