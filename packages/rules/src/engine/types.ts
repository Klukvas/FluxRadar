// Контракты rule engine (T-08): контекст сайта, finding и интерфейсы правил.
// Правило само сообщает applicable/affected targets (D-121) — движок только
// агрегирует, дедупит по fingerprint и ведёт coverage-счётчики.

import type { EvidenceType, Plan, RuleDescriptor, TargetKind } from '@fluxradar/contracts';
import type { CrawlResult, PageSnapshot } from '@fluxradar/crawler';

/** Единственный вариант правил v0.1; смена трактовки оракула → 'v2'. */
export const RULE_VARIANT_V1 = 'v1';
export type RuleVariant = typeof RULE_VARIANT_V1;

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
  /** Уверенность правила в находке, 0..1. */
  readonly confidence: number;
  /** true — единственное содержание находки это недоступность цели (D-026). */
  readonly targetUnreachable?: boolean;
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
}

/**
 * Page-level правило. isApplicable определяет знаменатель агрегата
 * (по умолчанию — успешно загруженная HTML-страница); движок не вызывает
 * evaluatePage для страниц вне applicable-набора.
 */
export interface PageRule {
  readonly kind: 'page';
  readonly descriptor: RuleDescriptor;
  isApplicable(page: PageSnapshot): boolean;
  evaluatePage(page: PageSnapshot, ctx: SiteContext): readonly RuleFinding[];
}

export interface SiteRuleResult {
  readonly findings: readonly RuleFinding[];
  readonly applicableTargets: number;
  readonly affectedTargets: number;
}

/** Site-level правило: одна цель — сам сайт (applicable/affected ∈ {0,1}). */
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
