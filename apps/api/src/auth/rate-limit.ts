// In-memory rate limit логина: 5 попыток / 15 минут на пару (email, IP).
// Часы инъектируются — окно тестируется без реального ожидания. Стор чистится
// при каждом обращении к ключу; для локального MVP этого достаточно
// (глобальная очистка понадобится при реальном трафике).

import { rateLimited } from '../http/errors.ts';

export const LOGIN_ATTEMPT_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface LoginRateLimiterOptions {
  readonly limit?: number;
  readonly windowMs?: number;
  /** Инъектируемые часы (unix ms) для детерминированных тестов. */
  readonly now?: () => number;
}

export class LoginRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, readonly number[]>();

  constructor(options: LoginRateLimiterOptions = {}) {
    this.limit = options.limit ?? LOGIN_ATTEMPT_LIMIT;
    this.windowMs = options.windowMs ?? LOGIN_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  private key(email: string, ip: string): string {
    return `${email.toLowerCase()}|${ip}`;
  }

  /**
   * Регистрирует попытку логина; (limit+1)-я попытка внутри окна → 429.
   * Вызывается ДО проверки пароля — перебор блокируется независимо от исхода.
   */
  assertAllowed(email: string, ip: string): void {
    const key = this.key(email, ip);
    const cutoff = this.now() - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
      throw rateLimited('too many login attempts, try again later');
    }
    this.attempts.set(key, [...recent, this.now()]);
  }

  /** Успешный вход сбрасывает счётчик пары (email, IP). */
  reset(email: string, ip: string): void {
    this.attempts.delete(this.key(email, ip));
  }
}
