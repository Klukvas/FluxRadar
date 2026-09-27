// Контракт покрытия, общий у трёх правил дублей (SEO-ONPAGE-004/006,
// CONTENT-001). Сами оракулы — в файлах правил; здесь ровно то, что у всех трёх
// обязано совпадать, потому что иначе политика Resolved закроет живую находку
// (§14).
//
// ЗНАМЕНАТЕЛЬ — ПРОЧИТАННЫЕ СТРАНИЦЫ, ВСЕ. Страница без значения (без title,
// без description, с пустым body) из знаменателя НЕ выпадает: правило на неё
// посмотрело и сказало «дублей нет» — это пройденная проверка, а не пропущенная.
// Отсюда инвариант: каждая страница в checkedTargets действительно была судима,
// и прошлая находка о ней закрывается только после настоящего повторного
// взгляда.
//
// МЕНЬШЕ ДВУХ СТРАНИЦ — НЕ «ДУБЛЕЙ НЕТ», А «СРАВНИВАТЬ НЕ С ЧЕМ». Обход,
// принёсший одну страницу (free-проверка главной, сайт из одной страницы,
// узкий scope), отчитывается 'no-candidates': сказать «уникальность в порядке»
// значило бы выдать отсутствие данных за результат.
//
// ГРАФ ССЫЛОК ЗДЕСЬ НЕ ПРИ ЧЁМ. Дубль — это совпадение значений двух
// прочитанных страниц, и недочитанная страница не делает вердикт ложным: она
// может добавить третьего члена группы, но не отменить совпадение первых двух.
// Поэтому linkGraphGap (SEO-TECH-009/010/011) к этим правилам не применяется, и
// усечённый лимитом обход всё равно отвечает по существу.

import type { PageSnapshot } from '@fluxradar/crawler';

import type { NotApplicableReason, SiteContext } from '../engine/types.js';
import { canonicalAddress, discoveredTargets, judgesPageAddress } from '../seo/site-index.js';
import { duplicateIndex, type DuplicateValueKind } from './duplicate-groups.js';

/** Хуки PageRule, одинаковые у всех правил дублей. */
export interface DuplicateCoverage {
  isApplicable(page: PageSnapshot, ctx: SiteContext): boolean;
  judgedAddress(page: PageSnapshot, ctx: SiteContext): string;
  inputTargets(ctx: SiteContext): readonly string[];
  requestedInputs(ctx: SiteContext): readonly string[];
  notApplicableReason(ctx: SiteContext): NotApplicableReason | undefined;
}

export function duplicateCoverage(kind: DuplicateValueKind): DuplicateCoverage {
  return {
    // Знаменатель считает документы, а не снимки: два адреса одного документа —
    // одна применимая цель, и судит её один снимок (addressJudges).
    isApplicable: (page: PageSnapshot, ctx: SiteContext): boolean =>
      judgesPageAddress(page, ctx.crawl) && duplicateIndex(ctx, kind).judged.length >= 2,
    // Названа цель адресом, по которому страница живёт: иначе её личность
    // зависела бы от того, чей снимок обход получил первым.
    judgedAddress: (page: PageSnapshot, ctx: SiteContext): string =>
      canonicalAddress(ctx.crawl, page.normalizedUrl),
    // Вердикт о странице выносят значения ДРУГИХ прочитанных страниц: выпавшая
    // из обхода страница превращает дубль в уникальное значение, ничего не
    // починив (§14, RuleEvaluation.inputTargets).
    inputTargets: (ctx: SiteContext): readonly string[] => duplicateIndex(ctx, kind).addresses,
    // Спрос — всё, что обход увидел: страница, которую сайт больше нигде не
    // упоминает, из спроса исчезает, и это починка, а не потеря данных.
    requestedInputs: (ctx: SiteContext): readonly string[] => discoveredTargets(ctx.crawl),
    notApplicableReason: (ctx: SiteContext): NotApplicableReason | undefined =>
      duplicateIndex(ctx, kind).judged.length < 2 ? 'no-candidates' : undefined,
  };
}
