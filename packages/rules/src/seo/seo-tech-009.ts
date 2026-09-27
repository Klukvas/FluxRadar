// SEO-TECH-009 — orphan-страницы (цели — страницы; severity из реестра contracts).
//
// Оракул: URL, который XML-sitemap сайта перечисляет и обход прочитал как
// успешную HTML-страницу, но на который не ведёт ни одна ссылка ни с одной
// прочитанной страницы, даёт finding на этой странице. Точка входа обхода
// исключена: к ней приходят по адресу, а не по ссылке (entryPageUrls). Ссылка
// через редирект считается ссылкой на страницу назначения (redirectAliases):
// сайт, у которого вся навигация ведёт на `/`, а `/` уводит на `/en/`, ссылается
// именно на `/en/`.
//
// ПОЧЕМУ ПРАВИЛО SITE-SCOPED, А НАХОДКИ PAGE-LEVEL. Знаменатель проверки —
// не «все страницы обхода», а «страницы, перечисленные в sitemap»: только о них
// сайт сам сказал «это мои страницы». Page-правило такой знаменатель объявить
// не может (isApplicable видит один снимок и ничего не знает про sitemap), и
// именно поэтому правило приходит через evaluateSite, оставаясь чистой функцией
// от ctx.
//
// SITEMAP НЕ ПРОЧИТАН → Not applicable. Кандидатов просто нет: прогон, не
// нашедший sitemap, не знает ни одной страницы, о которой владелец заявил
// отдельно от ссылок. Молчание с applicable = 0 читается в отчёте как «эта
// проверка к прогону не применялась» (ModuleChecks, notApplicableReasons), а не
// как «orphan-страниц нет».
//
// ГРАФ ССЫЛОК НЕПОЛОН → тоже Not applicable. Вывод «никто не ссылается»
// держится на прочитанных ссылках каждой страницы сайта, поэтому при пробеле
// (лимит тарифа, пауза, недочитанная страница, ссылка в никуда) правило молчит —
// иначе страница выглядела бы orphan только потому, что её единственный источник
// ссылки не обошли (linkGraphGap). Пробелом НЕ считается адрес, который обход и
// не собирался читать: чужой хост, шаблоны scope, шаг глубже maxDepth. Там
// область не потеряна, а выбрана владельцем, и evidence находки говорит ровно то,
// что правило проверило, — «ни одна из N ПРОЧИТАННЫХ страниц не ссылается»
// (isDeliberatelyUncrawled).
//
// И почему Not applicable, а НЕ Partial: completedTargets < applicableTargets
// делает Partial весь модуль, а через allApplicableChecksClosed — и весь скан
// (apps/api/src/billing/resolve-outcome.ts). Тогда любой сайт крупнее лимита
// тарифа заканчивался бы «Partial» вместо «Completed», то есть цену усечённого
// обхода заплатил бы статус всего скана, а не одна проверка.

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { SiteContext, SiteRule, SiteRuleResult } from '../engine/types.js';
import { NOT_APPLICABLE } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  SITEMAP_INPUT,
  discoveredTargets,
  entryPageUrls,
  inboundSourceCount,
  linkGraphGap,
  linkSourcePages,
  sitemapPages,
} from './site-index.js';

const descriptor = requireDescriptor('SEO-TECH-009');

export const seoTech009OrphanPages: SiteRule = {
  kind: 'site',
  descriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    if (linkGraphGap(ctx) !== null) {
      return NOT_APPLICABLE;
    }
    // Точка входа кандидатом не бывает: к ней приходят по адресу, а не по
    // ссылке — и под оба своих адреса, если она уводит редиректом (entryPageUrls).
    const entry = entryPageUrls(ctx);
    const candidates = sitemapPages(ctx.crawl).filter((page) => !entry.has(page.normalizedUrl));
    if (candidates.length === 0) {
      return NOT_APPLICABLE;
    }
    const sources = linkSourcePages(ctx.crawl);
    const findings = candidates
      .filter((page) => inboundSourceCount(ctx.crawl, page.normalizedUrl) === 0)
      .map((page) =>
        pageFinding(descriptor, page, {
          evidenceType: 'http',
          evidence: findingMessage('seo-tech-009.evidence', {
            url: page.finalUrl,
            sources: sources.length,
          }),
          recommendation: findingMessage('seo-tech-009.recommendation', {}),
        }),
      );
    return {
      findings,
      applicableTargets: candidates.length,
      affectedTargets: findings.length,
      // Судило правило ровно страницы sitemap — и закрывать его находку можно
      // только по прогону, который снова прочитал ту же страницу (§14).
      checkedTargets: candidates.map((page) => page.normalizedUrl),
      // А смотрело — на ссылки всех прочитанных страниц и на сам факт того, что
      // sitemap был прочитан: без страницы-источника находка исчезает не потому,
      // что ссылку добавили (§14, RuleEvaluation.inputTargets).
      inputTargets: [...sources.map((page) => page.normalizedUrl), SITEMAP_INPUT],
      // Спрашивало — обо всём, что обход вообще увидел: страница, которую сайт
      // больше нигде не упоминает, из спроса исчезает, и это починка, а не
      // потеря данных.
      requestedInputs: [...discoveredTargets(ctx.crawl), SITEMAP_INPUT],
    };
  },
};
