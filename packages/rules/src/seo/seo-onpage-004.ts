// SEO-ONPAGE-004 — дубль title (цели — страницы; severity из реестра).
//
// Оракул: прочитанная HTML-страница, чей нормализованный <title> (trim, пробелы
// схлопнуты, регистр сохранён) совпадает с title другой прочитанной страницы,
// даёт finding; evidence называет сам заголовок, сколько ещё страниц его носят и
// первые из них по алфавиту. Страница без title finding НЕ даёт: пустой
// заголовок — предмет SEO-ONPAGE-001, и десять страниц без title не дубли друг
// друга.
//
// ЭТО ОБЕЩАНИЕ, КОТОРОЕ ДАВНО ДАНО ЧИТАТЕЛЮ. Страница /checks обещает у title
// «uniqueness across crawled pages» с первого релиза, а проверяли до этого
// только присутствие и длину (SEO-ONPAGE-001). Номер 004 — тот, под которым
// §3 плана и заводил «metadata length/uniqueness»: длину закрыли 001/002,
// уникальность осталась за ним.
//
// КАНДИДАТ — СТРАНИЦА, А НЕ СНИМОК, и два снимка одного документа (`/p` с 301 и
// `/p/`) дублями друг друга не бывают: в группировку идёт один снимок на адрес
// документа, и находка названа этим же адресом (duplicate-groups.ts,
// addressJudges). Снимок, уехавший редиректом за область обхода, страницей сайта
// не считается вовсе.
//
// CANONICAL СНИМАЕТ НАХОДКУ, ЕСЛИ ДОВОДИТ ДО КОНЦА. Одинаковый title у двух
// страниц, одна из которых объявила другую своей канонической версией, — это не
// проблема, а её решение: сайт сказал поисковику, какой адрес настоящий. Молчит
// правило и о самой канонической странице. Но заявление должно чем-то
// кончаться: цепочка, уходящая из группы, и петля canonical-ов сообщают, что
// настоящая версия где-то есть, и не сообщают какая, — такие страницы находку
// получают все (duplicate-groups.ts, silencedMembers). Получает её и страница
// без canonical или с canonical на себя, которую никто каноничной не назвал, —
// и evidence говорит об этом прямо.
//
// ДУБЛЬ URL (SEO-TECH-007) ЗДЕСЬ НЕ ДУБЛИРУЕТСЯ. Группа 007 — это ОДИН
// normalizedUrl, найденный в ≥2 raw-формах (`/p` и `/p?utm=x`); обход такой
// адрес читает один раз, поэтому у всей группы 007 ровно один снимок и ровно
// один судящий адрес. Двух членов группы дублей из одной группы 007 получиться
// не может — см. тест «группа дублей URL остаётся одной страницей».

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFindingAt } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import {
  duplicateIndex,
  duplicateValueOf,
  unclaimedDuplicatesOf,
} from '../shared/duplicate-groups.js';
import { duplicateCoverage } from '../shared/duplicate-rule.js';
import { canonicalAddress } from './site-index.js';

const descriptor = requireDescriptor('SEO-ONPAGE-004');

export const seoOnpage004DuplicateTitle: PageRule = {
  kind: 'page',
  descriptor,
  ...duplicateCoverage('title'),
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const address = canonicalAddress(ctx.crawl, page.normalizedUrl);
    const duplicates = unclaimedDuplicatesOf(duplicateIndex(ctx, 'title'), address);
    if (duplicates === null) {
      return [];
    }
    return [
      pageFindingAt(descriptor, address, page, {
        evidenceType: 'dom',
        evidence: findingMessage('seo-onpage-004.evidence', {
          title: duplicateValueOf(page, 'title'),
          count: duplicates.count,
          pages: duplicates.listed.join(', '),
        }),
        recommendation: findingMessage('seo-onpage-004.recommendation', {}),
        // Стабильный селектор, а не список партнёров: fingerprint находки не
        // вправе меняться от того, сколько страниц сегодня носят этот заголовок
        // (§14) — иначе каждый прогон открывал бы новую issue о той же странице.
        selector: 'title',
        // Находка держится на снимках названных страниц: пропали они — и
        // «заголовок не уникален» больше ничем не подтверждено, а не починено.
        // Список ограничен тем же, что и evidence: требование покрытия обязано
        // называть то, что читатель видит (§14, RuleFinding.dependencyTargets).
        dependencyTargets: duplicates.listed,
      }),
    ];
  },
};
