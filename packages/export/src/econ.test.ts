// ECON-001: fx-фикстуры (валидный forecast проходит, reserve ниже floor — нет)
// + пробы каждой причины отказа: mix, пересчёт gross, потолки p95, margin,
// provider invoices, break-even, operational floor 45, налоговый контракт.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { EconForecastInput } from './econ.js';
import {
  ECON_OPERATIONAL_FLOOR_SCANS,
  VARIABLE_COST_CEILING_USD,
  validateEconForecast,
} from './econ.js';

function loadFixture(name: string): EconForecastInput {
  const path = fileURLToPath(new URL(`../fixtures/econ/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as EconForecastInput;
}

const VALID = loadFixture('forecast-valid.json');

function failureCodes(value: unknown): readonly string[] {
  const result = validateEconForecast(value);
  if (result.pass) {
    return [];
  }
  return result.failures.map((failure) => failure.code);
}

/** Иммутабельное удаление ключа: проба «поле отсутствует», а не «поле = undefined». */
function omitKey(value: EconForecastInput, key: keyof EconForecastInput): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([entryKey]) => entryKey !== key));
}

describe('validateEconForecast', () => {
  it('валидный forecast (fx-фикстура) проходит и даёт break-even отчёт', () => {
    const result = validateEconForecast(VALID);
    expect(result.pass).toBe(true);
    if (!result.pass) return;
    // Creem 3.9% + $0.40: Basic $39 → $1.92, Complete $87 → $3.79.
    // margin: Basic 39−1.92−15.93=21.15, Complete 87−3.79−36.76=46.45 → 0.8/0.2 = 26.21.
    expect(result.report.weightedContributionMarginUsd).toBe(26.21);
    // break-even: ceil((1000+500+68.04+17.01+50)/26.21) = ceil(62.38) = 63 <= 70 прогонов.
    expect(result.report.breakEvenScans).toBe(63);
    // 70 × (0.8 × 39 + 0.2 × 87) = 70 × 48.60.
    expect(result.report.forecastGrossRevenueUsd).toBe(3402);
    expect(result.report.supportReserveFloorUsd).toBe(500);
    expect(result.report.operationalFloorScans).toBe(ECON_OPERATIONAL_FLOOR_SCANS);
  });

  // At $39 / $87 the §18 stress case no longer converges at the operational
  // floor: with costs at the Creem p95 ceiling the margins are Basic
  // 39 − 1.92 − 17.58 = 19.50 and Complete 87 − 3.79 − 39.71 = 43.50, so
  // 0.8×19.50 + 0.2×43.50 = 24.30, and fixed 1000 + reserve 500 needs
  // ceil(1500/24.30) = ceil(61.73) = 62 scans. Pinned as a finding, not hidden:
  // 45 scans now fails break-even, 62 is the first forecast that passes.
  it('операционный stress-case плана §18 под потолком Creem: 45 прогонов мало, 62 — хватает', () => {
    const stress = (scans: number, grossUsd: number) => ({
      ...VALID,
      fixed_costs: 1000,
      forecast_scans: scans,
      forecast_gross_revenue: grossUsd,
      expected_refund_loss: 0,
      expected_chargeback_loss: 0,
      fx_buffer: 0,
      variable_cost_basic_p95: VARIABLE_COST_CEILING_USD.basic,
      variable_cost_complete_p95: VARIABLE_COST_CEILING_USD.complete,
      weighted_average_contribution_margin: 24.3,
    });
    // 45 × 48.60 = 2187; 62 × 48.60 = 3013.20.
    expect(failureCodes(stress(45, 2187))).toEqual(['break-even']);
    const result = validateEconForecast(stress(62, 3013.2));
    expect(result.pass).toBe(true);
    if (!result.pass) return;
    expect(result.report.breakEvenScans).toBe(62);
    expect(result.report.operationalFloorScans).toBe(ECON_OPERATIONAL_FLOOR_SCANS);
  });

  it('reserve ниже floor max($500, 10% gross) отклоняется (fx-фикстура)', () => {
    const result = validateEconForecast(loadFixture('forecast-reserve-below-floor.json'));
    expect(result.pass).toBe(false);
    if (result.pass) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['reserve-floor']);
    // floor = 10% × $10 440 (120 × $87) = $1 044 > $500 — отчёт это показывает.
    expect(result.report?.supportReserveFloorUsd).toBe(1044);
  });

  it('mix, не суммирующийся в 1, отклоняется', () => {
    expect(failureCodes({ ...VALID, basic_mix: 0.8, complete_mix: 0.3 })).toContain('mix');
  });

  it('gross revenue, не совпадающий с пересчётом из цен и mix, отклоняется', () => {
    expect(failureCodes({ ...VALID, forecast_gross_revenue: 3500 })).toContain('gross-revenue');
  });

  it('потолки p95 — то, что остаётся от цены после комиссии Creem и маржи 50%', () => {
    // 39 − (1.52 + 0.40) − 19.50 и 87 − (3.39 + 0.40) − 43.50, в центах без float.
    expect(VARIABLE_COST_CEILING_USD).toEqual({ basic: 17.58, complete: 39.71 });
  });

  it('p95 variable cost выше hard ceiling отклоняется', () => {
    expect(failureCodes({ ...VALID, variable_cost_complete_p95: 39.72 })).toContain('cost-ceiling');
    expect(failureCodes({ ...VALID, variable_cost_basic_p95: 17.59 })).toContain('cost-ceiling');
  });

  it('нулевая или отрицательная contribution margin отклоняется', () => {
    const codes = failureCodes({
      ...omitKey(VALID, 'weighted_average_contribution_margin'),
      basic_mix: 1,
      complete_mix: 0,
      forecast_gross_revenue: 70 * 39,
      variable_cost_basic_p95: 38,
    });
    expect(codes).toContain('margin');
    expect(codes).toContain('cost-ceiling');
  });

  it('заявленная margin, не совпадающая с пересчётом, отклоняется', () => {
    expect(failureCodes({ ...VALID, weighted_average_contribution_margin: 40 })).toContain(
      'margin',
    );
  });

  it('без подтверждённых provider invoices gate закрыт', () => {
    expect(failureCodes({ ...VALID, provider_invoices_confirmed: false })).toContain(
      'provider-invoices',
    );
  });

  it('forecast ниже risk-adjusted break-even отклоняется', () => {
    // 62 прогона ≥ floor 45, но break-even по рискам = 63.
    const codes = failureCodes({
      ...VALID,
      forecast_scans: 62,
      forecast_gross_revenue: 3013.2,
    });
    expect(codes).toEqual(['break-even']);
  });

  it('forecast ниже operational floor 45 отклоняется даже при малых расходах', () => {
    const codes = failureCodes({
      ...VALID,
      forecast_scans: 44,
      forecast_gross_revenue: 2138.4,
    });
    expect(codes).toContain('operational-floor');
  });

  it('tax_treatment=expense требует tax_expense_per_scan и уменьшает margin', () => {
    expect(failureCodes({ ...VALID, tax_treatment: 'expense' })).toContain('tax');
    // margin 26.21 − $2 налога = 24.21 → break-even ceil(1635.05/24.21) = 68; прогноз 70 покрывает.
    const withTax = validateEconForecast({
      ...VALID,
      tax_treatment: 'expense',
      tax_expense_per_scan: 2,
      weighted_average_contribution_margin: 24.21,
    });
    expect(withTax.pass).toBe(true);
    if (!withTax.pass) return;
    expect(withTax.report.weightedContributionMarginUsd).toBe(24.21);
    expect(withTax.report.breakEvenScans).toBe(68);
  });

  it('pass-through налог с ненулевым tax_expense_per_scan отклоняется', () => {
    expect(failureCodes({ ...VALID, tax_expense_per_scan: 2 })).toContain('tax');
  });

  it('отсутствие risk inputs (fx_buffer) — автоматический отказ input contract', () => {
    expect(failureCodes(omitKey(VALID, 'fx_buffer'))).toContain('input');
  });

  it('отрицательные значения отклоняются схемой input contract', () => {
    expect(failureCodes({ ...VALID, fixed_costs: -1 })).toContain('input');
  });

  it('не-объект отклоняется без исключения', () => {
    const result = validateEconForecast('forecast');
    expect(result.pass).toBe(false);
    if (result.pass) return;
    expect(result.report).toBeNull();
  });
});
