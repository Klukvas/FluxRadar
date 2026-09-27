// CONTENT-001 — дубль содержимого страницы (цели — страницы; severity из реестра).
//
// Оракул: прочитанная HTML-страница, чей видимый текст (visibleText: body без
// script/style, пробелы схлопнуты, регистр сохранён) СОВПАДАЕТ ЗНАК В ЗНАК с
// текстом другой прочитанной страницы, даёт finding. Только полное совпадение:
// почти-дубли этот релиз не ищет (где встанет их подпись — в шапке
// shared/duplicate-groups.ts).
//
// ПУСТАЯ СТРАНИЦА НЕ ДУБЛЬ ПУСТОЙ. Текста нет — значения нет, и в группировку
// такая страница не идёт: иначе каждый сайт с парой служебных заглушек получал бы
// «дубль контента» вместо честного CONTENT-003 (страница короче 200 символов).
// Малосодержательность — предмет CONTENT-003, и это правило её не повторяет: две
// страницы с одинаковым коротким текстом получат находки обоих правил, потому что
// это две разные проблемы — «здесь нечего читать» и «это уже есть по другому
// адресу».
//
// НОМЕР 001 — тот, под которым §3 плана и заводил «duplicate pages»; в реестре он
// до сих пор пуст, потому что раньше сравнивать было нечем: правило требует
// контекста всего обхода, а не одного снимка.
//
// КАНДИДАТ — СТРАНИЦА, А НЕ СНИМОК. Один документ обход держит под двумя
// адресами всякий раз, когда навигация ссылается на `/p`, а сервер уводит на
// `/p/`: судит его один снимок на адрес документа (addressJudges), и находка
// названа этим адресом. Иначе главный дубль каждого сайта был бы он сам, и
// «починить» его было бы нечем. Снимок, уехавший редиректом за область обхода,
// страницей сайта не считается вовсе (leftCrawlScope).
//
// CANONICAL СНИМАЕТ НАХОДКУ — и здесь это важнее, чем у заголовков: публиковать
// один текст по двум адресам законно ровно до тех пределов, пока сайт назвал
// канонический. Страница, объявившая canonical-ом другого члена группы, находки
// не даёт; не даёт её и та, на которую указали, — при условии, что цепочка
// заявлений кончается внутри группы. Петля canonical-ов и цепочка, уходящая из
// группы, настоящей версии не называют, и находку получают все их страницы
// (duplicate-groups.ts, silencedMembers). Остаются и те, кто делит текст без
// canonical или с canonical на себя. Что именно случилось, evidence называет
// отдельным предложением на каждый из двух случаев: у страницы в петле canonical
// есть, и утверждать обратное правило не вправе (UnclaimedReason).
//
// ДУБЛЬ URL (SEO-TECH-007) ЗДЕСЬ НЕ ДУБЛИРУЕТСЯ: группа 007 — это один
// normalizedUrl в нескольких raw-формах, обход читает его один раз, и на всю
// группу приходится ровно один судящий адрес. Два члена группы дублей из одной
// группы 007 получиться не могут — пинится тестом.

import type { PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFindingAt } from '../engine/finding.js';
import type { PageRule, RuleFinding, SiteContext } from '../engine/types.js';
import { findingMessage, type FindingMessageCode } from '../messages/index.js';
import { codePointLength } from '../seo/dom.js';
import { canonicalAddress } from '../seo/site-index.js';
import {
  duplicateIndex,
  duplicateValueOf,
  unclaimedDuplicatesOf,
  type UnclaimedReason,
} from '../shared/duplicate-groups.js';
import { duplicateCoverage } from '../shared/duplicate-rule.js';

const descriptor = requireDescriptor('CONTENT-001');

/** Сколько символов текста показывать в evidence — как у CONTENT-003. */
const EXCERPT_PREVIEW_CHARS = 120;

/** Причина находки → предложение о ней, как у SEO-ONPAGE-004. */
const EVIDENCE_CODES = {
  'no-canonical': 'content-001.evidence.no-canonical',
  'unresolved-chain': 'content-001.evidence.unresolved-chain',
} as const satisfies Record<UnclaimedReason, FindingMessageCode>;

export const content001DuplicateContent: PageRule = {
  kind: 'page',
  descriptor,
  ...duplicateCoverage('visible-text'),
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[] {
    const address = canonicalAddress(ctx.crawl, page.normalizedUrl);
    const duplicates = unclaimedDuplicatesOf(duplicateIndex(ctx, 'visible-text'), address);
    if (duplicates === null) {
      return [];
    }
    // Разбора DOM здесь уже не происходит: текст снимка посчитан при построении
    // индекса и лежит в кэше (content/visible-text.ts).
    const text = duplicateValueOf(page, 'visible-text');
    return [
      pageFindingAt(descriptor, address, page, {
        evidenceType: 'dom',
        evidence: findingMessage(EVIDENCE_CODES[duplicates.reason], {
          count: duplicates.count,
          pages: duplicates.listed.join(', '),
          length: codePointLength(text),
          preview: [...text].slice(0, EXCERPT_PREVIEW_CHARS).join(''),
        }),
        recommendation: findingMessage('content-001.recommendation', {}),
        // Никакого селектора и параметра: цель — страница целиком, а всё
        // изменчивое (число партнёров, их адреса) в fingerprint не входит, иначе
        // каждый прогон открывал бы новую issue о той же странице (§14).
        dependencyTargets: duplicates.listed,
      }),
    ];
  },
};
