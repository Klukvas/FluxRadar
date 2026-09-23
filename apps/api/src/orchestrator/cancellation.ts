// Кооперативная отмена прогона.
//
// «Отмена» до сих пор означала ровно одно: строка Scan переводилась в
// Cancelled. Сам прогон этого не замечал — обход продолжал ходить по сайту,
// GEO продолжал платить провайдеру за запросы, а в конце resolveScanOutcome
// падал с InvalidTransitionError («scan is Cancelled, only Running scans
// resolve»), после чего worker пытался провести Failed → Queued и падал
// второй раз, оставляя job невыполненным.
//
// Отмена — это факт в базе, который может случиться в любой момент чужого
// процесса, поэтому единственный честный способ его узнать — спросить базу.
// Watch опрашивает статус скана и переводит его в AbortSignal, который прогон
// проверяет между фазами, а обход и AI-провайдер — ещё и внутри запроса: сигнал
// доезжает до safeFetch и до адаптера провайдера, так что отмена прекращает и
// текущий запрос, а не только следующий.

import type { PrismaClient } from '@prisma/client';

/** Как часто спрашивать базу о статусе скана. */
export const CANCELLATION_POLL_MS = 1_000;

/** Прогон прекращён по запросу пользователя — не сбой платформы. */
export class ScanCancelledError extends Error {
  readonly scanId: string;

  constructor(scanId: string) {
    super(`scan ${scanId} was cancelled`);
    this.name = 'ScanCancelledError';
    this.scanId = scanId;
  }
}

export interface CancellationWatch {
  readonly signal: AbortSignal;
  /**
   * Первая проверка статуса завершена.
   *
   * Отмена могла случиться между стартом прогона и первым опросом; ожидание
   * этого промиса делает окно детерминированным, а не «повезёт-не повезёт».
   * Промис не отклоняется: сбой опроса уходит в onPollError.
   */
  readonly ready: Promise<void>;
  /** Останавливает опрос; вызывается в finally вызывающего. */
  stop(): void;
}

export interface CancellationWatchOptions {
  readonly pollMs?: number;
  /** Ошибки опроса не валят прогон — они логируются и опрос продолжается. */
  readonly onPollError?: (error: unknown) => void;
}

/**
 * Следит за статусом скана и абортит сигнал, как только он стал Cancelled.
 *
 * Исчезнувший скан тоже абортит: продолжать прогон удалённой строки нечем и
 * незачем.
 *
 * Опрос строго последовательный (следующий планируется только после ответа) и
 * начинается сразу. Прежний setInterval делал и то и другое хуже: на базе
 * медленнее интервала он копил неограниченное число параллельных чтений на
 * каждый оплаченный прогон, а первую проверку откладывал на целый интервал,
 * из-за чего уже отменённый скан успевал начать фазу.
 */
export function watchScanCancellation(
  prisma: PrismaClient,
  scanId: string,
  options: CancellationWatchOptions = {},
): CancellationWatch {
  const controller = new AbortController();
  const pollMs = options.pollMs ?? CANCELLATION_POLL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleNext = (): void => {
    // stop() мог случиться, пока чтение было в полёте: тогда нового опроса нет.
    if (stopped) {
      return;
    }
    timer = setTimeout(poll, pollMs);
    timer.unref();
  };

  function poll(): Promise<void> {
    return prisma.scan
      .findUnique({ where: { id: scanId }, select: { status: true } })
      .then((scan) => {
        if (scan === null || scan.status === 'Cancelled') {
          controller.abort();
          return;
        }
        scheduleNext();
      })
      .catch((error: unknown) => {
        // Недоступная база — не основание убивать оплаченный прогон.
        options.onPollError?.(error);
        scheduleNext();
      });
  }

  controller.signal.addEventListener('abort', stop, { once: true });
  return { signal: controller.signal, ready: poll(), stop };
}

/** Точка проверки между фазами прогона. */
export function throwIfCancelled(scanId: string, signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new ScanCancelledError(scanId);
  }
}

/** Что делать с прогоном, попытка которого завершилась исключением. */
export type FailedAttemptDecision =
  /** Пользовательская отмена: терминализировать без refund и без retry. */
  | { readonly kind: 'cancelled' }
  /** Пользовательская пауза: припарковать job, ничего не выбрасывая. */
  | { readonly kind: 'paused' }
  /** Сбой платформы; retry — есть ли ещё бесплатная попытка (§18). */
  | { readonly kind: 'failure'; readonly retry: boolean };

export interface FailedAttemptInput {
  readonly error: unknown;
  /** Статус скана, прочитанный ПОСЛЕ исключения. */
  readonly currentStatus: string;
  /** Запрошенная пауза, прочитанная ПОСЛЕ исключения. */
  readonly pauseRequestedAt?: Date | null;
  readonly platformRetryCount: number;
}

/**
 * Отмена — не сбой.
 *
 * Прежний worker этого не различал: любое исключение вело в ветку Failed, где
 * Running → Failed не срабатывал (скан уже Cancelled), а следом тратился
 * platform retry переходом Failed → Queued, который состояние-машина запрещает.
 * Отмена узнаётся двумя независимыми способами, потому что оба возможны:
 * прогон сам заметил сигнал (ScanCancelledError) либо упал по другой причине
 * уже после того, как пользователь отменил скан.
 *
 * Пауза — то же самое, но обратимое: скан, который владелец остановил, нельзя
 * ни объявить сбоем платформы, ни отправить на platform retry, потому что
 * retry стирает checkpoint — то есть ровно то, ради чего пауза и делалась.
 */
export function decideAfterFailedAttempt(input: FailedAttemptInput): FailedAttemptDecision {
  if (input.error instanceof ScanCancelledError || input.currentStatus === 'Cancelled') {
    return { kind: 'cancelled' };
  }
  if (input.currentStatus === 'Paused' || (input.pauseRequestedAt ?? null) !== null) {
    return { kind: 'paused' };
  }
  return { kind: 'failure', retry: input.platformRetryCount < 1 };
}
