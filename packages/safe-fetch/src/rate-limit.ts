// Per-host token bucket + семафор параллелизма (D-030, D-129).
// Ёмкость bucket-а = rps (burst не больше секунды трафика), пополнение непрерывное.
// Авто-throttle по доле 5xx (D-030) живёт в crawler (T-07), не здесь.

import { CRAWL_LIMITS } from '@fluxradar/contracts';

export interface HostLimiterOptions {
  /** Запросов в секунду на host; по умолчанию CRAWL_LIMITS.perHostRps. */
  readonly rps?: number;
  /** Одновременных запросов на host; по умолчанию CRAWL_LIMITS.perHostConcurrency. */
  readonly concurrency?: number;
  /** Инъекция часов для тестов; по умолчанию Date.now. */
  readonly now?: () => number;
}

/** Освобождает слот параллелизма; повторные вызовы — no-op. */
export type ReleaseFn = () => void;

interface HostState {
  tokens: number;
  lastRefillMs: number;
  active: number;
  queue: Array<(release: ReleaseFn) => void>;
  timer: NodeJS.Timeout | null;
}

export class HostLimiter {
  private readonly rps: number;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly hosts = new Map<string, HostState>();

  constructor(options: HostLimiterOptions = {}) {
    this.rps = options.rps ?? CRAWL_LIMITS.perHostRps;
    this.concurrency = options.concurrency ?? CRAWL_LIMITS.perHostConcurrency;
    this.now = options.now ?? Date.now;
    if (!Number.isFinite(this.rps) || this.rps <= 0) {
      throw new Error(`HostLimiter: rps must be a positive number, got ${this.rps}`);
    }
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) {
      throw new Error(
        `HostLimiter: concurrency must be a positive integer, got ${this.concurrency}`,
      );
    }
  }

  /**
   * Ожидает токен rate-лимита И свободный слот параллелизма host-а.
   * Возвращённый ReleaseFn обязателен к вызову по завершении запроса.
   */
  acquire(host: string): Promise<ReleaseFn> {
    const state = this.stateFor(host);
    return new Promise((resolve) => {
      state.queue.push(resolve);
      this.pump(state);
    });
  }

  private stateFor(host: string): HostState {
    const existing = this.hosts.get(host);
    if (existing !== undefined) {
      return existing;
    }
    const created: HostState = {
      tokens: this.rps,
      lastRefillMs: this.now(),
      active: 0,
      queue: [],
      timer: null,
    };
    this.hosts.set(host, created);
    return created;
  }

  private pump(state: HostState): void {
    this.refill(state);
    while (state.queue.length > 0 && state.active < this.concurrency && state.tokens >= 1) {
      const resolveNext = state.queue.shift();
      if (resolveNext === undefined) {
        break;
      }
      state.tokens -= 1;
      state.active += 1;
      resolveNext(this.makeRelease(state));
    }
    const waitingForTokens = state.queue.length > 0 && state.active < this.concurrency;
    if (waitingForTokens && state.timer === null) {
      const waitMs = Math.max(1, Math.ceil(((1 - state.tokens) / this.rps) * 1000));
      state.timer = setTimeout(() => {
        state.timer = null;
        this.pump(state);
      }, waitMs);
      state.timer.unref?.();
    }
  }

  private refill(state: HostState): void {
    const nowMs = this.now();
    const elapsedSeconds = Math.max(0, nowMs - state.lastRefillMs) / 1000;
    state.tokens = Math.min(this.rps, state.tokens + elapsedSeconds * this.rps);
    state.lastRefillMs = nowMs;
  }

  private makeRelease(state: HostState): ReleaseFn {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      state.active -= 1;
      this.pump(state);
    };
  }
}
