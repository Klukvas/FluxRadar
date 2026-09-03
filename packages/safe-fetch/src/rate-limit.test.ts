import { afterEach, describe, expect, it, vi } from 'vitest';

import { HostLimiter } from './rate-limit.js';

/** Отслеживает settle-статус промиса без await (для проверки «ещё ждёт»). */
function trackResolved(promise: Promise<unknown>): () => boolean {
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  return () => resolved;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HostLimiter', () => {
  it('ограничивает параллелизм per host', async () => {
    const limiter = new HostLimiter({ rps: 1000, concurrency: 2 });
    const releaseFirst = await limiter.acquire('example.com');
    await limiter.acquire('example.com');

    const third = limiter.acquire('example.com');
    const isThirdResolved = trackResolved(third);
    await flushMicrotasks();
    expect(isThirdResolved()).toBe(false);

    releaseFirst();
    await flushMicrotasks();
    expect(isThirdResolved()).toBe(true);
  });

  it('ограничивает частоту: 3-й запрос при rps=2 ждёт пополнения токенов', async () => {
    vi.useFakeTimers();
    const limiter = new HostLimiter({ rps: 2, concurrency: 10 });
    await limiter.acquire('example.com');
    await limiter.acquire('example.com');

    const third = limiter.acquire('example.com');
    const isThirdResolved = trackResolved(third);
    await flushMicrotasks();
    expect(isThirdResolved()).toBe(false);

    await vi.advanceTimersByTimeAsync(600); // 0.5 s на токен при rps=2 + запас
    expect(isThirdResolved()).toBe(true);
  });

  it('лимиты независимы между хостами', async () => {
    const limiter = new HostLimiter({ rps: 1, concurrency: 1 });
    await limiter.acquire('a.example');
    const other = limiter.acquire('b.example');
    const isOtherResolved = trackResolved(other);
    await flushMicrotasks();
    expect(isOtherResolved()).toBe(true);
  });

  it('release идемпотентен: двойной вызов не освобождает два слота', async () => {
    const limiter = new HostLimiter({ rps: 1000, concurrency: 1 });
    const release = await limiter.acquire('example.com');
    release();
    release();

    const second = limiter.acquire('example.com');
    const isSecondResolved = trackResolved(second);
    const third = limiter.acquire('example.com');
    const isThirdResolved = trackResolved(third);
    await flushMicrotasks();

    expect(isSecondResolved()).toBe(true);
    expect(isThirdResolved()).toBe(false);
  });

  it('отклоняет бессмысленные лимиты в конструкторе', () => {
    expect(() => new HostLimiter({ rps: 0 })).toThrow(/rps/);
    expect(() => new HostLimiter({ concurrency: 0 })).toThrow(/concurrency/);
  });
});
