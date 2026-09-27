// SEO-TECH-011 — слабо связанные страницы (цели — страницы; severity из реестра).
//
// Оракул: прочитанная HTML-страница, на которую ведёт РОВНО одна внутренняя
// ссылка с другой прочитанной страницы, даёт finding; evidence называет эту
// единственную страницу-источник. Ссылка страницы на саму себя источником не
// считается, повторные ссылки с одной страницы — это один источник.
//
// ТОЧКА ВХОДА ИСКЛЮЧЕНА. К ней приходят по адресу, а не по ссылке, поэтому её
// входящие ссылки ничего не говорят о доступности: главная с одной ссылкой из
// подвала — не слабо связанная страница. Исключается именно точка входа обхода
// (ctx.origin), а не всякая страница глубины 0: явный seed владельца говорит,
// как МЫ нашли страницу, а не как на неё ссылается сайт.
//
// ПОЧЕМУ SITE-SCOPED И ПОЧЕМУ ПРИ НЕПОЛНОМ ГРАФЕ — Not applicable: причины те
// же, что у SEO-TECH-009 (см. его шапку) — «ровно одна ссылка» это утверждение
// обо всех прочитанных страницах сайта, и недочитанная страница превращает его в
// ложное. Partial отвергнут по той же причине: он сделал бы Partial весь скан
// любого сайта крупнее лимита тарифа.

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { RuleFinding, SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  discoveredTargets,
  entryPageUrl,
  inboundSources,
  linkGraphGap,
  linkSourcePages,
} from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-011');

/** Ни одного кандидата и ни одного доказательства: проверка не применялась. */
const NOT_APPLICABLE: SiteRuleResult = {
  findings: [],
  applicableTargets: 0,
  affectedTargets: 0,
  checkedTargets: [],
};

export const seoTech011WeaklyLinkedPages: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    if (linkGraphGap(ctx) !== null) {
      return NOT_APPLICABLE;
    }
    const sources = linkSourcePages(ctx.crawl);
    const entryUrl = entryPageUrl(ctx);
    const candidates = sources
      .filter((page) => page.normalizedUrl !== entryUrl)
      .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl));
    const findings = candidates.flatMap((page): readonly RuleFinding[] => {
      // Ровно один источник: деструктуризация и есть проверка — «единственная
      // страница-источник» в evidence и условие находки не могут разойтись.
      const [only, ...rest] = inboundSources(ctx.crawl, page.normalizedUrl);
      if (only === undefined || rest.length > 0) {
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
