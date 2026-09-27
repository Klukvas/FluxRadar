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
// КАНДИДАТ — СТРАНИЦА, ОТДАННАЯ ПО СВОЕМУ АДРЕСУ. Снимок, уехавший редиректом,
// судится под адресом назначения, а не под своим (isOwnAddress — тот же фильтр,
// что у TECH-009): «страницу /about держит одна ссылка» было бы утверждением о
// редиректе, а не о странице, и считало бы её ссылки дважды.
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

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { RuleFinding, SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { NOT_APPLICABLE } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  discoveredTargets,
  entryPageUrls,
  isOwnAddress,
  linkGraphGap,
  linkSourcePages,
  soleInboundSource,
} from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-011');

export const seoTech011WeaklyLinkedPages: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    if (linkGraphGap(ctx) !== null) {
      return NOT_APPLICABLE;
    }
    const sources = linkSourcePages(ctx.crawl);
    const entry = entryPageUrls(ctx);
    const candidates = sources
      .filter((page) => !entry.has(page.normalizedUrl) && isOwnAddress(page, ctx.crawl))
      .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl));
    const findings = candidates.flatMap((page): readonly RuleFinding[] => {
      // Единственный источник и есть проверка: «ровно одна ссылка» и названная в
      // evidence страница приходят из одного вызова и разойтись не могут.
      const only = soleInboundSource(ctx.crawl, page.normalizedUrl);
      if (only === null) {
        return [];
      }
      return [
        pageFinding(descriptor, page, {
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
      checkedTargets: candidates.map((page) => page.normalizedUrl),
      // Вердикт о странице выносят ссылки ДРУГИХ страниц обхода, поэтому входы —
      // весь набор прочитанных страниц (§14, RuleEvaluation.inputTargets).
      inputTargets: sources.map((page) => page.normalizedUrl),
      // Спрос — всё, что обход увидел: исчезнувшая из него страница сайтом
      // больше не упоминается, и её потеря не замораживает находку.
      requestedInputs: discoveredTargets(ctx.crawl),
    };
  },
};
