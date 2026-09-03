// Квота-инварианты T-10: лимит тарифа, retry бесплатен (D-015),
// release/commit, иммутабельность трекера.

import { describe, expect, it } from 'vitest';

import { AiModuleError, QuotaExceededError } from './errors.js';
import { AiQuotaTracker } from './quota.js';

describe('AiQuotaTracker', () => {
  it('берёт лимит из тарифа: Free 0, Basic 50, Complete 500', () => {
    expect(AiQuotaTracker.forPlan('Free').limit).toBe(0);
    expect(AiQuotaTracker.forPlan('Basic').limit).toBe(50);
    expect(AiQuotaTracker.forPlan('Complete').limit).toBe(500);
  });

  it('reserve сверх лимита бросает QuotaExceededError', () => {
    const quota = AiQuotaTracker.withLimit(1).reserve('k1');
    expect(() => quota.reserve('k2')).toThrow(QuotaExceededError);
  });

  it('лимит 0 (Free) отклоняет первый же резерв', () => {
    expect(() => AiQuotaTracker.withLimit(0).reserve('k1')).toThrow(QuotaExceededError);
  });

  it('retry с тем же ключом бесплатен: повторный reserve уже committed ключа — no-op', () => {
    const committed = AiQuotaTracker.withLimit(1).reserve('k1').commit('k1');
    const retried = committed.reserve('k1');
    expect(retried).toBe(committed);
    expect(retried.spent).toBe(1);
    expect(retried.outstanding).toBe(0);
  });

  it('повторный reserve зарезервированного ключа не занимает вторую единицу', () => {
    const reserved = AiQuotaTracker.withLimit(1).reserve('k1');
    expect(reserved.reserve('k1')).toBe(reserved);
    expect(reserved.outstanding).toBe(1);
  });

  it('release освобождает единицу под новый ключ', () => {
    const quota = AiQuotaTracker.withLimit(1).reserve('k1').release('k1');
    expect(quota.outstanding).toBe(0);
    expect(() => quota.reserve('k2')).not.toThrow();
  });

  it('release неизвестного ключа — no-op', () => {
    const quota = AiQuotaTracker.withLimit(1);
    expect(quota.release('ghost')).toBe(quota);
  });

  it('commit без резерва — ошибка вызывающего кода', () => {
    expect(() => AiQuotaTracker.withLimit(1).commit('k1')).toThrow(AiModuleError);
  });

  it('повторный commit committed ключа — no-op (retry после успеха)', () => {
    const committed = AiQuotaTracker.withLimit(1).reserve('k1').commit('k1');
    expect(committed.commit('k1')).toBe(committed);
  });

  it('трекер иммутабелен: reserve/commit не меняют исходное состояние', () => {
    const initial = AiQuotaTracker.withLimit(2);
    const reserved = initial.reserve('k1');
    reserved.commit('k1');
    expect(initial.spent).toBe(0);
    expect(initial.outstanding).toBe(0);
    expect(reserved.spent).toBe(0);
    expect(reserved.outstanding).toBe(1);
  });
});
