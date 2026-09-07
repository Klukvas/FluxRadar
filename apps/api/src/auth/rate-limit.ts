// In-memory rate limits for the single API process.
//
// Два ограничителя: LoginRateLimiter — перебор пароля по паре (email, IP);
// RequestRateLimiter — всё остальное (регистрация, письма, сканы, checkout,
// webhooks). Часы инъектируются — окно тестируется без реального ожидания.
//
// Каждое действие ограничивается ДВУМЯ независимыми ключами — по аккаунту
// (или email) и по IP — а не одним составным `account:ip`. Составной ключ
// выглядит строже, но им же и обходится: сменив IP, тот же аккаунт получает
// чистый счётчик, то есть аккаунтный лимит не ограничивает вообще ничего.
// Раздельные ключи ограничивают и одного клиента, и один аккаунт, при этом
// офисный NAT (много аккаунтов за одним адресом) не блокируется аккаунтным
// лимитом — поэтому IP-лимиты заметно выше аккаунтных.
//
// Стор ограничен по числу ключей и чистится при обращении; для одного процесса
// этого достаточно (общий стор понадобится при горизонтальном масштабировании).

import { rateLimited } from '../http/errors.ts';

/**
 * Login is limited on THREE keys, not one, for the reason stated at the top of
 * this file: a single composite (email, IP) key is the shape that looks strict
 * and bounds nothing.
 *
 *   pair  — the tightest, and the only one there used to be. It stops repeated
 *           guessing against one account from one address.
 *   email — one account, whatever address is trying. Without it, an attacker
 *           with a botnet gets a fresh five guesses per address, forever.
 *   ip    — one address, whatever account it names. Without it, password
 *           spraying (one common password against thousands of accounts) never
 *           touches a limit at all, because no pair is ever tried twice.
 *
 * The address ceiling is much higher than the account one: a whole office can
 * sit behind one NAT address and mistype passwords on a Monday morning, while
 * fifty failures against a single account in a quarter of an hour is nobody's
 * bad memory.
 */
export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_EMAIL_LIMIT = 10;
export const LOGIN_IP_LIMIT = 50;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_REFUSAL_MESSAGE = 'too many login attempts, try again later';

export const REGISTER_LIMIT = 5;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
/**
 * Регистрация на один и тот же адрес. Каждая попытка шлёт письмо с
 * подтверждением на адрес, который назвал клиент, поэтому без этого лимита один
 * адрес можно заваливать письмами, меняя IP; на аккаунт-лимит тут опереться
 * нельзя — аккаунта ещё нет.
 */
export const REGISTER_EMAIL_LIMIT = 3;
export const EMAIL_ACTION_LIMIT = 5;
export const EMAIL_ACTION_WINDOW_MS = 60 * 60 * 1000;
export const EMAIL_IP_ACTION_LIMIT = 30;
export const EMAIL_TOKEN_ACTION_LIMIT = 20;
export const SCAN_ACTION_LIMIT = 10;
/** Один адрес может стоять за целой командой; аккаунтный лимит держит абьюз. */
export const SCAN_ACTION_IP_LIMIT = 40;
export const SCAN_ACTION_WINDOW_MS = 10 * 60 * 1000;
/**
 * Экспорт читает весь скан со всеми issue и AI-ответами, рендерит его и кладёт
 * объект в приватное хранилище — это самый дорогой GET в API.
 */
export const EXPORT_ACTION_LIMIT = 30;
export const EXPORT_ACTION_IP_LIMIT = 90;
export const EXPORT_ACTION_WINDOW_MS = 10 * 60 * 1000;
export const WEBHOOK_LIMIT = 6000;
export const WEBHOOK_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_MAX_TRACKED_KEYS = 10_000;

/** Ключ + его окно. Одно действие проверяется набором таких правил. */
export interface RateLimitRule {
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * Сколько секунд ждать, чтобы в окне освободилось место. Самая старая попытка
 * выходит из окна первой, поэтому именно она задаёт Retry-After. Минимум —
 * одна секунда: Retry-After: 0 приглашает клиента повторить немедленно.
 */
function retryAfterSeconds(
  timestamps: readonly number[],
  windowMs: number,
  current: number,
): number {
  const oldest = timestamps[0];
  const waitMs = oldest === undefined ? windowMs : oldest + windowMs - current;
  return Math.max(1, Math.ceil(waitMs / 1000));
}

/**
 * Generic in-memory multi-key limiter for the single API process.
 *
 * Every limited action in the API is expressed as a set of rules evaluated by
 * this class — including login, which owns a separate instance so a login flood
 * cannot evict the buckets holding back scans, exports and checkout.
 */
export class RequestRateLimiter {
  private readonly attempts = new Map<
    string,
    { readonly timestamps: readonly number[]; readonly windowMs: number }
  >();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  assertAllowed(key: string, limit: number, windowMs: number): void {
    this.assertAllowedAll([{ key, limit, windowMs }]);
  }

  /**
   * Проверяет все правила действия и только потом записывает попытку в каждое.
   * Порядок важен: если записывать по ходу проверки, отказ по второму правилу
   * уже сжёг бы попытку в первом, и лимит начал бы срабатывать раньше своего
   * значения.
   */
  assertAllowedAll(
    rules: readonly RateLimitRule[],
    message = 'too many requests, try again later',
  ): void {
    const current = this.now();
    this.pruneExpired(current);
    const evaluated = rules.map((rule) => ({ rule, recent: this.recentFor(rule, current) }));
    const blocked = evaluated.find(({ rule, recent }) => recent.length >= rule.limit);
    if (blocked !== undefined) {
      // Сохраняем подрезанный список: окно должно оставаться точным и у отказа.
      this.attempts.set(blocked.rule.key, {
        timestamps: blocked.recent,
        windowMs: blocked.rule.windowMs,
      });
      throw rateLimited(message, retryAfterSeconds(blocked.recent, blocked.rule.windowMs, current));
    }
    for (const { rule, recent } of evaluated) {
      if (!this.attempts.has(rule.key) && this.attempts.size >= RATE_LIMIT_MAX_TRACKED_KEYS) {
        const oldest = this.attempts.keys().next().value;
        if (oldest !== undefined) this.attempts.delete(oldest);
      }
      this.attempts.set(rule.key, { timestamps: [...recent, current], windowMs: rule.windowMs });
    }
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private recentFor(rule: RateLimitRule, current: number): readonly number[] {
    const cutoff = current - rule.windowMs;
    return (this.attempts.get(rule.key)?.timestamps ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );
  }

  private pruneExpired(current: number): void {
    if (this.attempts.size < RATE_LIMIT_MAX_TRACKED_KEYS) return;
    for (const [key, tracked] of this.attempts) {
      const cutoff = current - tracked.windowMs;
      if (!tracked.timestamps.some((timestamp) => timestamp > cutoff)) this.attempts.delete(key);
    }
  }
}

export interface LoginRateLimiterOptions {
  /** The (email, IP) pair ceiling. */
  readonly limit?: number;
  /** One account from any address. */
  readonly emailLimit?: number;
  /** One address against any account. */
  readonly ipLimit?: number;
  readonly windowMs?: number;
  /** Инъектируемые часы (unix ms) для детерминированных тестов. */
  readonly now?: () => number;
}

export class LoginRateLimiter {
  private readonly limit: number;
  private readonly emailLimit: number;
  private readonly ipLimit: number;
  private readonly windowMs: number;
  // Its own store, so a login flood cannot evict the buckets holding back scan
  // creation or checkout; the multi-key evaluation is the same one every other
  // limited action uses.
  private readonly attempts: RequestRateLimiter;

  constructor(options: LoginRateLimiterOptions = {}) {
    this.limit = options.limit ?? LOGIN_ATTEMPT_LIMIT;
    this.emailLimit = options.emailLimit ?? LOGIN_EMAIL_LIMIT;
    this.ipLimit = options.ipLimit ?? LOGIN_IP_LIMIT;
    this.windowMs = options.windowMs ?? LOGIN_WINDOW_MS;
    this.attempts = new RequestRateLimiter(options.now ?? Date.now);
  }

  private pairKey(email: string): string {
    return email.toLowerCase();
  }

  private rules(email: string, ip: string): readonly RateLimitRule[] {
    const normalized = this.pairKey(email);
    return [
      { key: `login:pair:${normalized}|${ip}`, limit: this.limit, windowMs: this.windowMs },
      { key: `login:email:${normalized}`, limit: this.emailLimit, windowMs: this.windowMs },
      { key: `login:ip:${ip}`, limit: this.ipLimit, windowMs: this.windowMs },
    ];
  }

  /**
   * Регистрирует попытку логина; превышение любого из трёх правил → 429.
   * Вызывается ДО проверки пароля — перебор блокируется независимо от исхода.
   */
  assertAllowed(email: string, ip: string): void {
    this.attempts.assertAllowedAll(this.rules(email, ip), LOGIN_REFUSAL_MESSAGE);
  }

  /**
   * Успешный вход сбрасывает счётчики, привязанные к аккаунту.
   *
   * Адресный счётчик НЕ сбрасывается: правильный пароль доказывает, что клиент
   * владеет этим аккаунтом, и ничего не говорит о том, что с того же адреса не
   * перебирают остальные. Иначе один свой аккаунт обнулял бы IP-лимит после
   * каждой пачки попыток — то есть отменял бы его.
   */
  reset(email: string, ip: string): void {
    const normalized = this.pairKey(email);
    this.attempts.reset(`login:pair:${normalized}|${ip}`);
    this.attempts.reset(`login:email:${normalized}`);
  }
}

/**
 * Правила одного действия, ограниченного и по аккаунту, и по клиентскому IP.
 *
 * `ip` — это то, что вернул Express с учётом `trust proxy` (см. http/trust-proxy.ts).
 * За обратным прокси без правильной настройки все запросы приходят с одного
 * адреса, поэтому IP-лимит сам по себе ненадёжен — аккаунтный ключ и есть тот,
 * который всегда точен.
 */
export function accountAndIpRules(
  action: string,
  accountId: string,
  ip: string,
  limits: { readonly account: number; readonly ip: number; readonly windowMs: number },
): readonly RateLimitRule[] {
  return [
    { key: `${action}:account:${accountId}`, limit: limits.account, windowMs: limits.windowMs },
    { key: `${action}:ip:${ip}`, limit: limits.ip, windowMs: limits.windowMs },
  ];
}

/** Действия со сканом: создание, запуск, повтор, отмена. */
export function scanActionRules(
  action: string,
  accountId: string,
  ip: string,
): readonly RateLimitRule[] {
  return accountAndIpRules(action, accountId, ip, {
    account: SCAN_ACTION_LIMIT,
    ip: SCAN_ACTION_IP_LIMIT,
    windowMs: SCAN_ACTION_WINDOW_MS,
  });
}
