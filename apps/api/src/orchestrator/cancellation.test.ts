// Отмена прогона: обнаружение (watch) и решение о судьбе job-а.
//
// Оба тестируются без базы: watch получает узкий фейк prisma.scan.findUnique,
// а решение — чистая функция. DB-оркестровка worker-а здесь не покрывается.

import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import {
  decideAfterFailedAttempt,
  ScanCancelledError,
  throwIfCancelled,
  watchScanCancellation,
} from './cancellation.ts';

const SCAN_ID = 'scan-cancel-1';
const POLL_MS = 5;

/** Ровно то, что watch вызывает: одно чтение статуса скана. */
function fakePrisma(statuses: readonly (string | null)[]): {
  prisma: PrismaClient;
  reads: () => number;
} {
  let read = 0;
  const prisma = {
    scan: {
      findUnique: (): Promise<{ status: string } | null> => {
        const status = statuses[Math.min(read, statuses.length - 1)] ?? null;
        read += 1;
        return Promise.resolve(status === null ? null : { status });
      },
    },
  } as unknown as PrismaClient;
  return { prisma, reads: () => read };
}

function failingPrisma(): PrismaClient {
  return {
    scan: { findUnique: (): Promise<never> => Promise.reject(new Error('connection lost')) },
  } as unknown as PrismaClient;
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition was not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** prisma, каждое чтение которого висит, пока тест его не отпустит. */
function slowPrisma(status: string): {
  prisma: PrismaClient;
  inFlight: () => number;
  release: () => void;
} {
  const pending: ((value: { status: string }) => void)[] = [];
  const prisma = {
    scan: {
      findUnique: (): Promise<{ status: string }> =>
        new Promise((resolve) => pending.push(resolve)),
    },
  } as unknown as PrismaClient;
  return {
    prisma,
    inFlight: () => pending.length,
    release: () => {
      for (const resolve of pending.splice(0)) {
        resolve({ status });
      }
    },
  };
}

describe('watchScanCancellation', () => {
  it('абортит сигнал, как только скан стал Cancelled', async () => {
    const { prisma } = fakePrisma(['Running', 'Running', 'Cancelled']);
    const watch = watchScanCancellation(prisma, SCAN_ID, { pollMs: POLL_MS });
    try {
      expect(watch.signal.aborted).toBe(false);
      await waitFor(() => watch.signal.aborted);
      expect(watch.signal.aborted).toBe(true);
    } finally {
      watch.stop();
    }
  });

  it('проверяет статус сразу, не ожидая первого интервала', async () => {
    // Отмена, случившаяся перед стартом фазы, обязана быть замечена до первого
    // внешнего запроса: интервал в секунду успевает пропустить обход.
    const { prisma, reads } = fakePrisma(['Cancelled']);
    const watch = watchScanCancellation(prisma, SCAN_ID, { pollMs: 60_000 });
    try {
      await watch.ready;
      expect(reads()).toBe(1);
      expect(watch.signal.aborted).toBe(true);
    } finally {
      watch.stop();
    }
  });

  it('не накапливает параллельные чтения на медленной базе', async () => {
    // Прежний setInterval стрелял каждые pollMs независимо от того, ответила ли
    // база: на оплаченном прогоне это неограниченный рост параллельных запросов.
    const slow = slowPrisma('Running');
    const watch = watchScanCancellation(slow.prisma, SCAN_ID, { pollMs: 1 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(slow.inFlight()).toBe(1);
    } finally {
      watch.stop();
      slow.release();
    }
  });

  it('stop во время чтения не планирует следующий опрос', async () => {
    const slow = slowPrisma('Running');
    const watch = watchScanCancellation(slow.prisma, SCAN_ID, { pollMs: 1 });
    expect(slow.inFlight()).toBe(1);
    watch.stop();
    slow.release();
    await watch.ready;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slow.inFlight()).toBe(0);
  });

  it('исчезнувший скан тоже абортит прогон', async () => {
    const { prisma } = fakePrisma([null]);
    const watch = watchScanCancellation(prisma, SCAN_ID, { pollMs: POLL_MS });
    try {
      await waitFor(() => watch.signal.aborted);
    } finally {
      watch.stop();
    }
    expect(watch.signal.aborted).toBe(true);
  });

  it('после аборта база больше не опрашивается', async () => {
    const { prisma, reads } = fakePrisma(['Cancelled']);
    const watch = watchScanCancellation(prisma, SCAN_ID, { pollMs: POLL_MS });
    await waitFor(() => watch.signal.aborted);
    const readsAtAbort = reads();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));
    expect(reads()).toBe(readsAtAbort);
    watch.stop();
  });

  it('сбой опроса сообщается и НЕ выдаёт себя за отмену', async () => {
    const onPollError = vi.fn();
    const watch = watchScanCancellation(failingPrisma(), SCAN_ID, {
      pollMs: POLL_MS,
      onPollError,
    });
    try {
      await waitFor(() => onPollError.mock.calls.length > 0);
      // Недоступная база — не основание убивать оплаченный прогон.
      expect(watch.signal.aborted).toBe(false);
    } finally {
      watch.stop();
    }
  });

  it('stop прекращает опрос', async () => {
    const { prisma, reads } = fakePrisma(['Running']);
    const watch = watchScanCancellation(prisma, SCAN_ID, { pollMs: POLL_MS });
    await waitFor(() => reads() > 0);
    watch.stop();
    const readsAtStop = reads();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));
    expect(reads()).toBe(readsAtStop);
  });
});

describe('throwIfCancelled', () => {
  it('молчит, пока сигнала нет или он не абортнут', () => {
    expect(() => throwIfCancelled(SCAN_ID)).not.toThrow();
    expect(() => throwIfCancelled(SCAN_ID, new AbortController().signal)).not.toThrow();
  });

  it('бросает ScanCancelledError после аборта', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfCancelled(SCAN_ID, controller.signal)).toThrow(ScanCancelledError);
  });
});

describe('decideAfterFailedAttempt', () => {
  it('ScanCancelledError → отмена, без refund и без retry', () => {
    expect(
      decideAfterFailedAttempt({
        error: new ScanCancelledError(SCAN_ID),
        currentStatus: 'Cancelled',
        platformRetryCount: 0,
      }),
    ).toEqual({ kind: 'cancelled' });
  });

  it('любая ошибка на уже отменённом скане → отмена, а не сбой платформы', () => {
    // Классический случай: resolveScanOutcome бросил InvalidTransitionError,
    // потому что скан уже Cancelled. Прежний код шёл отсюда в Failed → Queued.
    expect(
      decideAfterFailedAttempt({
        error: new Error('scan is Cancelled, only Running scans resolve'),
        currentStatus: 'Cancelled',
        platformRetryCount: 0,
      }),
    ).toEqual({ kind: 'cancelled' });
  });

  // Пауза и отмена приехали из разных дорожек и встречаются здесь. Без этой
  // ветки приостановленный скан, чья попытка упала после паузы, уходил в
  // Failed → Queued, а platform retry стирает checkpoint — то есть ровно то,
  // ради чего паузу и делали.
  it('ошибка на приостановленном скане → пауза, а не сбой платформы', () => {
    expect(
      decideAfterFailedAttempt({
        error: new Error('scan is Paused, only Running scans resolve'),
        currentStatus: 'Paused',
        platformRetryCount: 0,
      }),
    ).toEqual({ kind: 'paused' });
  });

  it('запрошенная пауза на ещё Running скане тоже не сбой платформы', () => {
    // Пауза записана, статус ещё не переведён: попытка упала в этом окне.
    expect(
      decideAfterFailedAttempt({
        error: new Error('crawl transport closed mid-flight'),
        currentStatus: 'Running',
        pauseRequestedAt: new Date('2026-09-23T10:00:00.000Z'),
        platformRetryCount: 0,
      }),
    ).toEqual({ kind: 'paused' });
  });

  it('отмена сильнее паузы: отменённый скан не паркуется как приостановленный', () => {
    expect(
      decideAfterFailedAttempt({
        error: new ScanCancelledError(SCAN_ID),
        currentStatus: 'Cancelled',
        pauseRequestedAt: new Date('2026-09-23T10:00:00.000Z'),
        platformRetryCount: 0,
      }),
    ).toEqual({ kind: 'cancelled' });
  });

  it('настоящий сбой платформы сохраняет единственный бесплатный retry', () => {
    expect(
      decideAfterFailedAttempt({
        error: new Error('crawler exploded'),
        currentStatus: 'Running',
        platformRetryCount: 0,
      }),
    ).toEqual({ kind: 'failure', retry: true });
    expect(
      decideAfterFailedAttempt({
        error: new Error('crawler exploded again'),
        currentStatus: 'Running',
        platformRetryCount: 1,
      }),
    ).toEqual({ kind: 'failure', retry: false });
  });
});
