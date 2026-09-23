// Какие issues прошлого скана новый скан вправе закрыть как Resolved (§14).
//
// Прежнее правило было «fingerprint-а нет в новом скане → Resolved», и это
// неверно во всех случаях, когда новый скан просто не проверял то же самое:
// скан, суженный до /blog/*, закрывал находки на /shop/*; отключённая
// Analytics-интеграция закрывала прошлые находки Analytics; страница, не
// влезшая в лимит URL или закрытая robots.txt, выглядела «починенной».
// Отсутствие находки — доказательство исправления ТОЛЬКО там, где проверка
// действительно повторилась.
//
// Почему «модуль Completed + хотя бы одна загруженная страница» тоже не годится
// (это была первая версия этой политики):
//   • SEO-TECH-007 (дубли URL) всегда applicable — applicableTargets = 1 даже
//     на пустом обходе. Его находка пропадает, если обход просто увидел меньше
//     страниц: варианты URL берутся из ссылок на загруженных страницах.
//   • PRIVACY-004 смотрит только на главную. Обход без неё оставляет модуль
//     Privacy завершённым на остальных правилах, и находка о ссылке на политику
//     закрывалась без единого взгляда на главную.
//   • Page-правила работают только по успешным HTML-страницам. Страница,
//     отдавшая 404 или PDF, «загружена» — но DOM-находки на ней исчезают все
//     сразу, и отчёт объявлял починкой то, что страница умерла.
//   • API-проверки (§9) выполняются отдельно от обхода: страница по тому же URL
//     ничего не говорит о endpoint-е.
//
// Почему «правило видело эту страницу» тоже мало (вторая версия). Вердикт трёх
// page-правил зависит не только от их цели: SEO-TECH-006 читает снимок
// страницы, КУДА ведёт ссылка, CONTENT-004 — снимок media, SEO-TECH-008 —
// ссылки всех страниц обхода. Выпавший из обхода вход (лимит URL, robots,
// сузившийся scope, circuit breaker краулера) убирает находку с живой
// страницы, ничего не починив.
//
// И почему «повтори все прошлые входы правила» — тоже неверно (третья версия,
// её и чинит этот файл). Такое требование не различает две противоположные
// вещи: вход ИСЧЕЗ (страница не обойдена — неизвестность) и вход БОЛЬШЕ НЕ
// НУЖЕН (владелец удалил битую ссылку — починка). Оно же делало проверку
// общей на всё правило: удаление любой несвязанной страницы замораживало все
// находки SEO-TECH-006/007/008 и CONTENT-004 по всему сайту, включая те, чью
// починку прогон доказал полностью.
//
// Поэтому доказательство — это факт на уровне находки: материал, на котором
// держалась ИМЕННО ОНА (dependencyTargets правила), плюс два набора нового
// прогона — что он прочитал (inputTargets) и о чём спрашивал
// (requestedInputs). Прошлый вход закрывает находку, если прогон получил его
// снова ИЛИ если сайт о нём больше не спрашивает. Нет данных о прошлом
// покрытии (скан старше этой политики) — не закрываем.

import type { RuleCoverageEntry, RuleCoverageIndex, ScanCoverage } from './run-coverage.ts';
import { sameRequestContext } from './run-context.ts';

/** Что прогон реально проверил. */
export interface RunCoverage {
  /** ruleId → что это правило прочитало (run-coverage.ts). */
  readonly coverageByRule: RuleCoverageIndex;
  /** Модули, закрывшие в этом прогоне все свои проверки с usable output. */
  readonly completedModules: ReadonlySet<string>;
  readonly rulesetVersion: string;
}

/** Покрытие скана, в котором находка была записана. */
export interface PreviousRunCoverage {
  readonly coverageByRule: RuleCoverageIndex;
  /** fingerprint → материал, на котором держалась эта находка. */
  readonly issueDependencies: ReadonlyMap<string, readonly string[]>;
  readonly rulesetVersion: string;
}

/** Поля прошлой issue, по которым решается её судьба. */
export interface PreviousIssueTarget {
  readonly id: string;
  readonly fingerprint: string;
  readonly ruleId: string;
  readonly module: string;
  readonly targetKind: string;
  readonly normalizedUrl: string;
}

/** Цели уровня сайта: у них нет отдельной страницы, у находки пустой URL (D-019). */
const SITE_LEVEL_TARGET_KINDS: readonly string[] = ['site', 'environment'];

/** Покрытие прошлого скана в форме, которую ждёт политика. */
export function previousRunCoverage(
  coverage: ScanCoverage,
  rulesetVersion: string,
): PreviousRunCoverage {
  return {
    coverageByRule: coverage.byRule,
    issueDependencies: coverage.issueDependencies,
    rulesetVersion,
  };
}

/**
 * Доказал ли прогон, что этой находки больше нет.
 *
 * Только «да» разрешает Resolved; «не знаю» обязано оставить прежний статус.
 */
export function provesRepeatCheck(
  issue: PreviousIssueTarget,
  run: RunCoverage,
  previous: PreviousRunCoverage,
): boolean {
  if (run.rulesetVersion !== previous.rulesetVersion) {
    // Сменился ruleset — правило могло измениться или исчезнуть, и его молчание
    // о находке ничего не значит.
    return false;
  }
  if (!run.completedModules.has(issue.module)) {
    // Partial/Unavailable/Not applicable не доказывают повторную проверку.
    return false;
  }
  const checkedNow = run.coverageByRule.get(issue.ruleId);
  if (checkedNow === undefined || checkedNow.checkedTargets.size === 0) {
    // Правило в этом прогоне не прочитало ничего: ни одной страницы в scope,
    // не было главной, не выполнилась API-проверка — причина не важна.
    return false;
  }
  const checkedBefore = previous.coverageByRule.get(issue.ruleId);
  if (!sameRequestContext(checkedNow.context, checkedBefore?.context)) {
    // Другой User-Agent или другая привязка GA4/Search Console — те же URL-ы,
    // но другие данные; а прогон без записанного контекста сравнению не
    // подлежит вовсе.
    return false;
  }
  if (SITE_LEVEL_TARGET_KINDS.includes(issue.targetKind)) {
    return coversPreviousTargets(checkedNow, checkedBefore?.checkedTargets);
  }
  // page/api: нужна именно своя цель. Для page это значит, что правило видело
  // эту страницу успешной и разобранной; для api — что выполнилась проверка
  // этого endpoint-а, а не что обход загрузил страницу по тому же адресу.
  if (!checkedNow.checkedTargets.has(issue.normalizedUrl)) {
    return false;
  }
  return coversFindingDependencies(issue, checkedNow, checkedBefore, previous.issueDependencies);
}

/**
 * Прочитал ли прогон как минимум те же цели, что прогон с находкой.
 *
 * Site-level находка относится к сайту целиком, поэтому «та же цель» — это тот
 * же материал: главная у PRIVACY-004, robots.txt у SEO-TECH-001, набор
 * HTML-страниц у SEO-TECH-007. Суженный обход теряет варианты URL и ссылки, не
 * исправив ничего, — и обязан оставить находку открытой. Но страница, которой
 * на сайте больше нет (её не ищет ни ссылка, ни sitemap), из требований
 * выбывает: иначе одно удаление навсегда замораживало бы находку о дублях.
 * Неизвестное прошлое покрытие (скан старше этой политики или нечитаемая
 * запись) трактуется как отсутствие доказательства.
 */
function coversPreviousTargets(
  now: RuleCoverageEntry,
  checkedBefore: ReadonlySet<string> | undefined,
): boolean {
  if (checkedBefore === undefined || checkedBefore.size === 0) {
    return false;
  }
  return [...checkedBefore].every(
    (target) => now.checkedTargets.has(target) || noLongerRequested(now, target),
  );
}

/**
 * Прочитал ли прогон материал, на котором держалась page/api-находка.
 *
 * Требование берётся с самой находки: у SEO-TECH-006 это снимок цели её
 * ссылки, у CONTENT-004 — снимки её битых media. Такой список есть не у всех
 * правил; у остальных требованием остаются объявленные входы правила целиком
 * (SEO-TECH-008: противоречие создают ссылки любых других страниц, и сузить
 * это до одной находки нечем).
 *
 * Пустое требование — нормальное состояние, а не пробел: у правила без
 * собственных входов вердикт о странице целиком следует из её снимка, и
 * «страницу посмотрели снова» уже доказано выше.
 */
function coversFindingDependencies(
  issue: PreviousIssueTarget,
  now: RuleCoverageEntry,
  before: RuleCoverageEntry | undefined,
  issueDependencies: ReadonlyMap<string, readonly string[]>,
): boolean {
  const perIssue = issueDependencies.get(issue.fingerprint);
  const required = perIssue ?? [...(before?.inputTargets ?? [])];
  return required.every((target) => now.inputTargets.has(target) || noLongerRequested(now, target));
}

/**
 * Перестал ли сайт спрашивать про этот вход.
 *
 * Ссылка удалена, картинка снята, страница больше ниоткуда не видна — прогон
 * не получил по ней данных, но и получать их незачем: это починка, а не
 * пробел. Правило, не объявившее свой спрос (requestedInputs === null), такого
 * вывода не позволяет — там любой недостающий вход оставляет находку открытой.
 */
function noLongerRequested(now: RuleCoverageEntry, target: string): boolean {
  return now.requestedInputs !== null && !now.requestedInputs.has(target);
}

/**
 * Issues прошлого скана, которые новый скан вправе закрыть: исчез fingerprint
 * И прогон доказал, что ту же цель тем же правилом действительно проверяли.
 */
export function resolvableIssues(
  previousIssues: readonly PreviousIssueTarget[],
  currentFingerprints: ReadonlySet<string>,
  run: RunCoverage,
  previous: PreviousRunCoverage,
): readonly PreviousIssueTarget[] {
  return previousIssues.filter(
    (issue) =>
      !currentFingerprints.has(issue.fingerprint) && provesRepeatCheck(issue, run, previous),
  );
}
