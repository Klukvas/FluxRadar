// Учёт AI-квоты прогона (T-10, план §5/§18). Трекер — иммутабельный value-object:
// каждая операция возвращает новое состояние, вызывающий код передаёт его дальше.
// Retry с тем же ai_request_key бесплатен (D-015); превышение лимита — ошибка.

import { TARIFFS } from '@fluxradar/contracts';
import type { Plan } from '@fluxradar/contracts';

import { AiModuleError, QuotaExceededError } from './errors.js';

function without(keys: ReadonlySet<string>, requestKey: string): ReadonlySet<string> {
  return new Set([...keys].filter((key) => key !== requestKey));
}

export class AiQuotaTracker {
  private constructor(
    readonly limit: number,
    private readonly reserved: ReadonlySet<string>,
    private readonly committed: ReadonlySet<string>,
  ) {}

  /** Лимит из тарифа: Basic 50, Complete 500, Free 0 (TARIFFS.aiRequestLimit). */
  static forPlan(plan: Plan): AiQuotaTracker {
    return AiQuotaTracker.withLimit(TARIFFS[plan].aiRequestLimit);
  }

  static withLimit(limit: number): AiQuotaTracker {
    return new AiQuotaTracker(limit, new Set(), new Set());
  }

  /**
   * Резервирует единицу квоты под ключ. Уже reserved/committed ключ — retry:
   * возвращается то же состояние без повторного списания. Новый ключ сверх
   * лимита → QuotaExceededError.
   */
  reserve(requestKey: string): AiQuotaTracker {
    if (this.reserved.has(requestKey) || this.committed.has(requestKey)) return this;
    if (this.reserved.size + this.committed.size >= this.limit) {
      throw new QuotaExceededError(requestKey, this.limit);
    }
    return new AiQuotaTracker(
      this.limit,
      new Set([...this.reserved, requestKey]),
      this.committed,
    );
  }

  /** Закрывает резерв успешным запросом; commit без резерва — баг вызывающего кода. */
  commit(requestKey: string): AiQuotaTracker {
    if (this.committed.has(requestKey)) return this;
    if (!this.reserved.has(requestKey)) {
      throw new AiModuleError(`ai: commit without reservation — "${requestKey}"`);
    }
    return new AiQuotaTracker(
      this.limit,
      without(this.reserved, requestKey),
      new Set([...this.committed, requestKey]),
    );
  }

  /** Освобождает резерв после окончательного отказа; неизвестный ключ — no-op. */
  release(requestKey: string): AiQuotaTracker {
    if (!this.reserved.has(requestKey)) return this;
    return new AiQuotaTracker(this.limit, without(this.reserved, requestKey), this.committed);
  }

  /** Фактически списанная квота = количество committed-ключей. */
  get spent(): number {
    return this.committed.size;
  }

  /** Открытые резервы (для диагностики: после прогона должно быть 0). */
  get outstanding(): number {
    return this.reserved.size;
  }
}
