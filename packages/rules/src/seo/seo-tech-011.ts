// SEO-TECH-011 — слабо связанные страницы (цели — страницы; severity из реестра).
//
// Оракул: прочитанная HTML-страница, на которую ведёт РОВНО одна внутренняя
// ссылка с другой прочитанной страницы, даёт finding; evidence называет эту
// единственную страницу-источник. Ссылка страницы на саму себя источником не
// считается, повторные ссылки с одной страницы — это один источник, а ссылка
// через редирект засчитывается странице назначения (redirectAliases): нижний
// колонтитул, ссылающийся на `/about`, держит страницу `/about/` наравне с
// навигацией, которая ссылается на неё напрямую.
//
// КАНДИДАТ — СТРАНИЦА, А НЕ АДРЕС. Снимок, уехавший редиректом, судится под
// адресом назначения: «страницу /about держит одна ссылка» было бы утверждением
// о редиректе, а не о странице. Пока у назначения есть свой снимок, судит он, а
// адрес редиректа кандидатом не бывает — иначе один документ получил бы вердикт
// дважды. Но на сайте, где вся навигация написана как `/about`, а сервер уводит
// на `/about/`, второго снимка не существует вовсе (markFinalUrlSeen), и
// молчание о такой странице — это молчание о целом классе сайтов. Тогда
// единственный снимок судится под адресом назначения (isJudgeablePage), и
// evidence называет именно его: адрес, по которому страница живёт.
//
// И ИМЯ НАХОДКИ — ТОТ ЖЕ АДРЕС ДОКУМЕНТА. Есть ли у `/about/` свой снимок,
// решает порядок очереди обхода (markFinalUrlSeen), а не сайт: находка,
// названная адресом снимка, меняла бы личность от прогона к прогону — новый
// прогон открывал бы вторую issue о той же странице и не мог закрыть первую.
// Поэтому и normalizedUrl находки, и checkedTargets — canonicalAddress.
//
// РЕДИРЕКТ ЗА ОБЛАСТЬ ОБХОДА КАНДИДАТА НЕ ДАЁТ. `/go`, отвечающий 302 на
// https://partner.example/landing, оставляет снимок чужой страницы: «её держит
// одна ссылка» было бы утверждением о чужом сайте, и ссылки такой страницы
// сайту тоже не принадлежат (leftCrawlScope, как и у самого краулера).
//
// ТОЧКА ВХОДА ИСКЛЮЧЕНА. К ней приходят по адресу, а не по ссылке, поэтому её
// входящие ссылки ничего не говорят о доступности: главная с одной ссылкой из
// подвала — не слабо связанная страница. Исключается именно точка входа обхода
// (ctx.origin) и адрес, на который она уводит редиректом, а не всякая страница
// глубины 0: явный seed владельца говорит, как МЫ нашли страницу, а не как на
// неё ссылается сайт.
//
// ПОЧЕМУ SITE-SCOPED И ПОЧЕМУ ПРИ НЕПОЛНОМ ГРАФЕ — Not applicable: причины те
// же, что у SEO-TECH-009 (см. его шапку) — «ровно одна ссылка» это утверждение
// обо всех прочитанных страницах сайта, и недочитанная страница превращает его в
// ложное. Partial отвергнут по той же причине: он сделал бы Partial весь скан
// любого сайта крупнее лимита тарифа.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFindingAt } from '../engine/finding.js';
import type { RuleFinding, SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { notApplicable } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { linkGraphGap } from './link-graph-gap.js';
import {
  addressJudges,
  canonicalAddress,
  discoveredTargets,
  entryPageUrls,
  linkSourceAddresses,
  soleInboundSource,
} from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-011');

export const seoTech011WeaklyLinkedPages: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    if (linkGraphGap(ctx) !== null) {
      return notApplicable('link-graph-gap');
    }
    const candidates = judgeablePages(ctx);
    if (candidates.length === 0) {
      // Обход, прочитавший одну только точку входа, граф не потерял: судить о
      // входящих ссылках здесь просто некого, и сказать «обход не дочитал
      // страницы» значило бы приписать прогону незаконченность.
      return notApplicable('no-candidates');
    }
    const findings = candidates.flatMap((page): readonly RuleFinding[] => {
      // Единственный источник и есть проверка: «ровно одна ссылка» и названная в
      // evidence страница приходят из одного вызова и разойтись не могут.
      const only = soleInboundSource(ctx.crawl, page.normalizedUrl);
      if (only === null) {
        return [];
      }
      return [
        pageFindingAt(descriptor, canonicalAddress(ctx.crawl, page.normalizedUrl), page, {
          evidenceType: 'http',
          evidence: findingMessage('seo-tech-011.evidence', { source: only }),
          recommendation: findingMessage('seo-tech-011.recommendation', {}),
          // Находка держится на снимке единственной страницы-источника: пропал
          // он — и «ровно одна ссылка» больше ничем не подтверждено, а не
          // починено (§14, RuleFinding.dependencyTargets).
          dependencyTargets: [only],
        }),
      ];
    });
    return {
      findings,
      applicableTargets: candidates.length,
      affectedTargets: findings.length,
      // Под тем же именем, каким находку называет pageFindingAt: политика
      // Resolved ищет в этом наборе именно normalizedUrl прошлой issue.
      checkedTargets: candidates.map((page) => canonicalAddress(ctx.crawl, page.normalizedUrl)),
      // Вердикт о странице выносят ссылки ДРУГИХ страниц обхода, поэтому входы —
      // весь набор прочитанных страниц под адресами документов: под тем же
      // именем, каким находка называет свой единственный источник (§14,
      // RuleEvaluation.inputTargets).
      inputTargets: linkSourceAddresses(ctx.crawl),
      // Спрос — всё, что обход увидел: исчезнувшая из него страница сайтом
      // больше не упоминается, и её потеря не замораживает находку.
      requestedInputs: discoveredTargets(ctx.crawl),
    };
  },
};

/**
 * Страницы, о которых правило судит: по одному снимку на адрес документа
 * (addressJudges — там же и дедуп двух адресов одного документа, и порядок),
 * кроме точки входа под любым из её адресов.
 */
function judgeablePages(ctx: SiteContext): readonly PageSnapshot[] {
  const entry = entryPageUrls(ctx);
  return [...addressJudges(ctx.crawl)].filter(
    (page) =>
      !entry.has(page.normalizedUrl) && !entry.has(canonicalAddress(ctx.crawl, page.normalizedUrl)),
  );
}
