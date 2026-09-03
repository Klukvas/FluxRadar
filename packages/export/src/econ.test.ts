// ECON-001: fx-фикстуры (валидный forecast проходит, reserve ниже floor — нет)
// + пробы каждой причины отказа: mix, пересчёт gross, потолки p95, margin,
// provider invoices, break-even, operational floor 45, налоговый контракт.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { EconForecastInput } from './econ.js';
import { ECON_OPERATIONAL_FLOOR_SCANS, validateEconForecast } from './econ.js';

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
    // margin: Basic 55−3.25−24.25=27.50, Complete 120−6.50−53.50=60.00 → 0.8/0.2 = 34.
    expect(result.report.weightedContributionMarginUsd).toBe(34);
    // break-even: ceil((1000+500+68+17+50)/34) = ceil(48.09) = 49 <= 50 прогонов.
    expect(result.report.breakEvenScans).toBe(49);
    expect(result.report.forecastGrossRevenueUsd).toBe(3400);
    expect(result.report.supportReserveFloorUsd).toBe(500);
    expect(result.report.operationalFloorScans).toBe(ECON_OPERATIONAL_FLOOR_SCANS);
  });

  it('операционный stress-case плана §18 сходится ровно в floor 45', () => {
    // fixed 1000 + reserve 500, margin $34 при mix 80/20 и потолочных costs →
    // ceil(1500/34) = ceil(44.12) = 45 = planning floor.
    const stress = {
      ...VALID,
      forecast_scans: 45,
      forecast_gross_revenue: 45 * (0.8 * 55 + 0.2 * 120),
      expected_refund_loss: 0,
      expected_chargeback_loss: 0,
      fx_buffer: 0,
    };
    const result = validateEconForecast(stress);
    expect(result.pass).toBe(true);
    if (!result.pass) return;
    expect(result.report.breakEvenScans).toBe(45);
  });

  it('reserve ниже floor max($500, 10% gross) отклоняется (fx-фикстура)', () => {
    const result = validateEconForecast(loadFixture('forecast-reserve-below-floor.json'));
    expect(result.pass).toBe(false);
    if (result.pass) return;
    expect(result.failures.map((failure) => failure.code)).toEqual(['reserve-floor']);
    // floor = 10% × $14 400 = $1 440 > $500 — отчёт это показывает.
    expect(result.report?.supportReserveFloorUsd).toBe(1440);
  });

  it('mix, не суммирующийся в 1, отклоняется', () => {
    expect(failureCodes({ ...VALID, basic_mix: 0.8, complete_mix: 0.3 })).toContain('mix');
  });

  it('gross revenue, не совпадающий с пересчётом из цен и mix, отклоняется', () => {
    expect(failureCodes({ ...VALID, forecast_gross_revenue: 3500 })).toContain('gross-revenue');
  });

  it('p95 variable cost выше hard ceiling отклоняется', () => {
    expect(failureCodes({ ...VALID, variable_cost_complete_p95: 53.51 })).toContain('cost-ceiling');
  });

  it('нулевая или отрицательная contribution margin отклоняется', () => {
    const codes = failureCodes({
      ...omitKey(VALID, 'weighted_average_contribution_margin'),
      basic_mix: 1,
      complete_mix: 0,
      forecast_gross_revenue: 50 * 55,
      variable_cost_basic_p95: 52,
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
    // 46 прогонов ≥ floor 45, но break-even по рискам = 49.
    const codes = failureCodes({
      ...VALID,
      forecast_scans: 46,
      forecast_gross_revenue: 46 * 68,
    });
    expect(codes).toEqual(['break-even']);
  });

  it('forecast ниже operational floor 45 отклоняется даже при малых расходах', () => {
    const codes = failureCodes({
      ...VALID,
      forecast_scans: 44,
      forecast_gross_revenue: 44 * 68,
    });
    expect(codes).toContain('operational-floor');
  });

  it('tax_treatment=expense требует tax_expense_per_scan и уменьшает margin', () => {
    expect(failureCodes({ ...VALID, tax_treatment: 'expense' })).toContain('tax');
    // margin 34 − $2 налога = 32 → break-even ceil(1635/32) = 52; прогноз 55 покрывает.
    const withTax = validateEconForecast({
      ...VALID,
      forecast_scans: 55,
      forecast_gross_revenue: 55 * 68,
      tax_treatment: 'expense',
      tax_expense_per_scan: 2,
      weighted_average_contribution_margin: 32,
    });
    expect(withTax.pass).toBe(true);
    if (!withTax.pass) return;
    expect(withTax.report.weightedContributionMarginUsd).toBe(32);
    expect(withTax.report.breakEvenScans).toBe(52);
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
