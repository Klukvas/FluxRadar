// Контракты rule engine (T-08): контекст сайта, finding и интерфейсы правил.
// Правило само сообщает applicable/affected targets (D-121) — движок только
// агрегирует, дедупит по fingerprint и ведёт coverage-счётчики.

import type { EvidenceType, Plan, RuleDescriptor, TargetKind } from '@fluxradar/contracts';
import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';

import type { FindingMessages } from '../messages/catalog.js';

/** Единственный вариант правил v0.1; смена трактовки оракула → 'v2'. */
export const RULE_VARIANT_V1 = 'v1';
export type RuleVariant = typeof RULE_VARIANT_V1;

/**
 * Почему у правила не нашлось ни одной цели.
 *
 * Код, а не готовая фраза: отчёт печатает её на языке читателя. Без кода отчёт
 * вынужден угадывать причину по ruleId — и «обход не дочитал страницы» читается
 * одинаково и на усечённом обходе, и на сайте из одной страницы, где обход
 * дочитал всё. Правило причину знает; угадывать её в UI — значит писать
 * читателю то, чего не было.
 */
export type NotApplicableReason =
  /** Граф внутренних ссылок неполон: любой вердикт о входящих ссылках был бы ложным. */
  | 'link-graph-gap'
  /** Sitemap не прочитан: правилу, судящему его страницы, не из чего брать кандидатов. */
  | 'no-sitemap'
  /** Обход не оставил ни одной цели, о которой это правило вправе судить. */
  | 'no-candidates'
  /** CONTENT-005: страница не объявила `<html lang>` вовсе. */
  | 'no-declared-language'
  /** CONTENT-005: `<html lang>` объявлен, но это не английский и не українська. */
  | 'unsupported-language'
  /** CONTENT-005: объявлена мова, но переважний алфавіт видимого тексту їй не відповідає. */
  | 'script-mismatch'
  /** CONTENT-005: тексту вистачає на CONTENT-003, але замало речень і слів для виміру. */
  | 'too-little-prose';

/** Метод API-проверки: allowlist §9 (Reliability contract v1). */
export const API_CHECK_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;
export type ApiCheckMethod = (typeof API_CHECK_METHODS)[number];

/** Результат выполненного API-запроса (v0.1 — только статус и тайминг). */
export interface ApiCheckSnapshot {
  readonly status: number;
  readonly timingMs: number;
}

/**
 * Явно добавленный пользователем API-endpoint (§9 Reliability contract v1).
 * snapshot отсутствует, если запрос не выполнялся (например, заблокирован
 * no-credentials policy REL-API-005).
 */
export interface ApiCheck {
  readonly method: ApiCheckMethod;
  readonly url: string;
  /** Явно ожидаемые статусы; пусто/не задано → default «любой 2xx» (§9). */
  readonly expectedStatus?: readonly number[];
  /** Заголовки из конфига проверки — вход policy-скана REL-API-005. */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly snapshot?: ApiCheckSnapshot;
  /**
   * Why this check has no snapshot. Present exactly when `snapshot` is absent
   * and the caller knows why.
   */
  readonly unavailable?: ApiCheckUnavailable;
}

export interface ApiCheckUnavailable {
  /** Operator-facing reason: a transport failure, a stop, an off-site redirect. */
  readonly reason: string;
  /**
   * Whether this endpoint was part of what the module was asked to check.
   *
   * An endpoint on somebody else's site never was, so it belongs in no
   * denominator. One that timed out was, and has to count as an applicable
   * target the module did not complete — otherwise "no API problems found"
   * reads the same whether every endpoint passed or none was reachable.
   */
  readonly applicable: boolean;
}

/** Вход движка: результат обхода + идентичность сайта и тариф скана. */
export interface SiteContext {
  /** Origin, как он задан в профиле сайта (до нормализации). */
  readonly origin: string;
  /** Нормализованный origin — поле `domain` fingerprint-а (D-019, §14). */
  readonly domain: string;
  readonly crawl: CrawlResult;
  /** Сырой robots.txt (HTTP 200); приоритетнее crawl.robotsTxt, если задан. */
  readonly robotsTxt?: string;
  readonly plan: Plan;
  /** Явно добавленные API-endpoints (§9); нет поля — Reliability/api молчит. */
  readonly apiChecks?: readonly ApiCheck[];
}

/**
 * Сырой finding одного правила (план §14). Поля normalized* — вход
 * fingerprint-v1; для site-level правил normalizedUrl — пустая строка (D-019).
 */
export interface RuleFinding {
  readonly ruleId: string;
  readonly targetKind: TargetKind;
  readonly normalizedUrl: string;
  readonly normalizedResource: string;
  readonly normalizedSelector: string;
  readonly normalizedParameter: string;
  readonly ruleVariant: RuleVariant;
  /** Фактический URL цели (finalUrl страницы либо ресурс site-check-а). */
  readonly targetUrl: string;
  readonly evidenceType: EvidenceType;
  /** Обрезан до EVIDENCE_EXCERPT_MAX_CHARS Unicode-символов (§16). */
  readonly evidenceExcerpt: string;
  readonly recommendation: string;
  /**
   * Message codes and values behind `evidenceExcerpt` and `recommendation`, so
   * the report can render both in the reader's language. The two text fields
   * hold the English rendering; absent while a rule still writes plain text.
   */
  readonly messages?: FindingMessages;
  /** Уверенность правила в находке, 0..1. */
  readonly confidence: number;
  /** true — единственное содержание находки это недоступность цели (D-026). */
  readonly targetUnreachable?: boolean;
  /**
   * Материал обхода, на котором держится ИМЕННО ЭТА находка.
   *
   * У SEO-TECH-006 это снимок цели ссылки, у CONTENT-004 — снимки битых media
   * этой страницы. Находка исчезает и тогда, когда исчез её материал, поэтому
   * политика Resolved спрашивает про него, а не про весь обход: иначе один
   * необойдённый URL замораживал бы все находки правила (§14,
   * apps/api/src/orchestrator/resolution-policy.ts).
   *
   * Поле не входит в fingerprint и не влияет на score.
   */
  readonly dependencyTargets?: readonly string[];
  /**
   * Non-scoring связь findings разных модулей с общим evidence (§14
   * cross-module policy): не входит в fingerprint и не влияет на score.
   */
  readonly evidenceGroupId?: string;
}

/** Итог одного правила: findings + агрегаты уровня правила (D-016/D-121). */
export interface RuleEvaluation {
  readonly ruleId: string;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
  readonly findings: readonly RuleFinding[];
  /**
   * Что именно это правило прочитало в этом прогоне — доказательство повторной
   * проверки для политики Resolved (§14).
   *
   * Для page/api-правил это normalizedUrl каждой взятой в работу цели: счётчик
   * applicableTargets говорит «сколько», но не «каких», а закрывать находку
   * можно только на той цели, которую правило действительно смотрело.
   * Site-правило само называет входы, от которых зависит его вердикт
   * (homepage, robots.txt, HTML-страницы обхода) — у него applicableTargets
   * почти всегда 1 и потому не доказывает ничего. Пустой список означает
   * «правило ни на что не смотрело», и молчание о прошлой находке ничего не
   * значит.
   */
  readonly checkedTargets: readonly string[];
  /**
   * Материал обхода, от которого зависит вердикт правила ПОМИМО самой цели.
   *
   * У большинства page-правил его нет: вердикт о странице целиком выводится из
   * её собственного снимка. Но SEO-TECH-006 читает снимки страниц, на которые
   * ведут ссылки, CONTENT-004 — снимки media, SEO-TECH-008 — ссылки всех
   * страниц обхода и sitemap. Для них «страницу снова посмотрели» — не
   * доказательство: находка исчезает и тогда, когда пропал вход, а не когда
   * что-то починили. Политика Resolved требует, чтобы прогон прочитал как
   * минимум те же входы (§14, resolution-policy.ts).
   *
   * Пустой список означает «своих входов у правила нет», и это нормальное
   * состояние: проверка совпадает с целью.
   */
  readonly inputTargets: readonly string[];
  /**
   * Всё, о чём правило спрашивало обход, — и отвеченное (inputTargets), и нет.
   *
   * Разница между «вход пропал» и «сайт больше о нём не спрашивает» — это
   * разница между неизвестностью и починкой. Ссылка, которую владелец удалил,
   * из requestedInputs исчезает, и прошлая находка о ней закрывается; ссылка,
   * оставшаяся на странице, но чья цель не обойдена, остаётся здесь — и находка
   * остаётся открытой (§14, resolution-policy.ts).
   *
   * undefined — правило о своём спросе не отчиталось: тогда «больше не
   * спрашивают» доказать нечем и любой пропавший вход блокирует Resolved.
   */
  readonly requestedInputs: readonly string[] | undefined;
  /**
   * Почему целей не нашлось. Есть только при applicableTargets = 0 и только у
   * правил, которые причину назвали (NotApplicableReason).
   */
  readonly notApplicableReason?: NotApplicableReason;
}

/**
 * Page-level правило. isApplicable определяет знаменатель агрегата
 * (по умолчанию — успешно загруженная HTML-страница); движок не вызывает
 * evaluatePage для страниц вне applicable-набора.
 *
 * Контекст обхода приходит и в isApplicable: у правила, чей вердикт выводится из
 * графа ссылок (SEO-TECH-010), знаменатель зависит не только от снимка — на
 * неполном графе оно обязано отчитаться «не применялось», а не «проблем нет».
 */
export interface PageRule {
  readonly kind: 'page';
  readonly descriptor: RuleDescriptor;
  isApplicable(page: PageSnapshot, ctx: SiteContext): boolean;
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[];
  /**
   * Входы за пределами самой страницы (см. RuleEvaluation.inputTargets).
   * Метод объявляют только правила, которым нужен контекст всего обхода.
   */
  inputTargets?(ctx: SiteContext): readonly string[];
  /**
   * Всё, о чём правило спрашивало обход (см. RuleEvaluation.requestedInputs).
   * Объявляется вместе с inputTargets и обязан быть его надмножеством.
   */
  requestedInputs?(ctx: SiteContext): readonly string[];
  /**
   * Почему у правила может не оказаться ни одной применимой страницы.
   *
   * Объявляют правила, чей знаменатель зависит не только от снимка
   * (SEO-TECH-010 — от целости графа ссылок): движок запишет причину, только
   * если applicable-набор действительно пуст.
   */
  notApplicableReason?(ctx: SiteContext): NotApplicableReason | undefined;
  /**
   * Адрес, которым правило называет эту страницу (по умолчанию — её
   * normalizedUrl).
   *
   * Объявляет правило, чьи находки названы адресом ДОКУМЕНТА, а не снимка
   * (SEO-TECH-010, pageFindingAt): checkedTargets обязаны называть цель тем же
   * именем, что и находка, иначе политика Resolved не узнаёт в новом прогоне ту
   * же проверку (§14, resolution-policy.ts).
   */
  judgedAddress?(page: PageSnapshot, ctx: SiteContext): string;
}

export interface SiteRuleResult {
  readonly findings: readonly RuleFinding[];
  readonly applicableTargets: number;
  readonly affectedTargets: number;
  /**
   * Входы, которые правило прочитало (см. RuleEvaluation.checkedTargets).
   *
   * Не задано — движок считает, что правило о своих входах не отчиталось, и
   * политика Resolved трактует его находки как недоказуемые. Site-правило
   * обязано перечислить входы, если хочет, чтобы его починенную находку когда-
   * нибудь закрыли: applicableTargets = 1 у него бывает и тогда, когда обход
   * не принёс ни одной нужной страницы.
   */
  readonly checkedTargets?: readonly string[];
  /**
   * Входы за пределами названных целей (см. RuleEvaluation.inputTargets).
   * Site-правило обычно называет свои входы прямо в checkedTargets, поэтому
   * поле остаётся пустым; оно существует, чтобы api-правила и будущие
   * site-правила могли разделить «что судил» и «на что при этом смотрел».
   */
  readonly inputTargets?: readonly string[];
  /**
   * Всё, о чём правило спрашивало обход (см. RuleEvaluation.requestedInputs).
   *
   * Site-правилу, чей вердикт строится на наборе страниц (SEO-TECH-007), это
   * нужно не меньше, чем page-правилу: без него удалённая страница навсегда
   * замораживает находку, потому что прошлый набор входов уже не повторить.
   */
  readonly requestedInputs?: readonly string[];
  /**
   * Applicable targets the rule actually reached; absent means all of them.
   *
   * Page rules already model this (an unreachable page counts applicable and
   * not completed, §15). Site and API rules need it for the same reason: an
   * endpoint that timed out is not "nothing to report", and leaving it out of
   * the denominator would let a module that reached none of its targets report
   * full coverage.
   */
  readonly completedTargets?: number;
  /**
   * Почему целей не нашлось (NotApplicableReason). Осмысленно только при
   * applicableTargets = 0 — движок записывает причину лишь тогда.
   */
  readonly notApplicableReason?: NotApplicableReason;
}

/**
 * Site-level правило: цели считает само (SiteRuleResult), движок их не выводит.
 *
 * Обычно цель одна — сайт (applicable/affected ∈ {0,1}, как у TECH-007), но
 * правило вправе судить набор страниц и отдавать page-level findings: у
 * SEO-TECH-009/011 знаменатель — страницы sitemap и прочитанные HTML-страницы,
 * и объявить его может только правило, видящее весь обход.
 */
export interface SiteRule {
  readonly kind: 'site';
  readonly descriptor: RuleDescriptor;
  evaluateSite(ctx: SiteContext): SiteRuleResult;
}

/**
 * API-level правило (T-09): цели — ctx.apiChecks; правило само решает,
 * какие проверки applicable (форма результата та же, что у site-правил).
 */
export interface ApiRule {
  readonly kind: 'api';
  readonly descriptor: RuleDescriptor;
  evaluateApiChecks(ctx: SiteContext): SiteRuleResult;
}

export type Rule = PageRule | SiteRule | ApiRule;

/**
 * Пустой результат site-правила: ни одного кандидата и ни одного доказательства.
 *
 * Читается в отчёте как «эта проверка к прогону не применялась» (ModuleChecks,
 * notApplicableReasons), а не как «проблем нет», и это разные утверждения. А
 * какое именно — говорит причина: она и отличает усечённый обход от сайта, на
 * котором правилу просто нечего судить.
 */
export function notApplicable(reason: NotApplicableReason): SiteRuleResult {
  return {
    findings: [],
    applicableTargets: 0,
    affectedTargets: 0,
    checkedTargets: [],
    notApplicableReason: reason,
  };
}

/** Applicable target по умолчанию: финальный 2xx и HTML-тело (T-08). */
export function isSuccessfulHtmlPage(page: PageSnapshot): boolean {
  return (
    page.fetchError === undefined && page.status >= 200 && page.status < 300 && page.html !== null
  );
}

/** Страница, на которую был получен HTTP-ответ (любой финальный статус). */
export function hasHttpResponse(page: PageSnapshot): boolean {
  return page.fetchError === undefined && page.status > 0;
}
