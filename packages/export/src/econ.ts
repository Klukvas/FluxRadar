// ECON-001 (план §18): чистый валидатор 30-дневного launch forecast.
// Пересчитывает gross revenue из цен тарифов и mix, проверяет support-reserve
// floor max($500, 10% gross), потолки p95 variable cost ($24.25/$53.50),
// положительную weighted contribution margin (после Paddle fee, p95 cost и
// non-pass-through tax), risk-adjusted break-even и operational floor 45.
// Денежная арифметика — в целых центах, деление только в break-even.

import { TARIFFS } from '@fluxradar/contracts';
import { Ajv2020 } from 'ajv/dist/2020.js';

/** Обязательный operational stress-case плана §18: минимум 45 прогонов. */
export const ECON_OPERATIONAL_FLOOR_SCANS = 45;
/** Support reserve floor: max($500/month, 10% × forecast gross revenue). */
export const SUPPORT_RESERVE_MIN_USD = 500;
export const SUPPORT_RESERVE_GROSS_SHARE = 0.1;
/** Модель Paddle для предварительного расчёта: 5% + $0.50 за транзакцию (§18). */
export const PADDLE_FEE_RATE = 0.05;
export const PADDLE_FEE_FLAT_USD = 0.5;
/** Hard ceiling всей переменной себестоимости одного прогона (§18). */
export const VARIABLE_COST_CEILING_USD = { basic: 24.25, complete: 53.5 } as const;

/** Погрешность сравнения долей/центов, пересчитанных через float-умножение. */
const EPSILON = 1e-9;
/** Допуск сверки денежных значений, посчитанных вне валидатора: один цент. */
const MONEY_TOLERANCE_CENTS = 1;

/** Input contract ECON-001 (§18) — форма forecast-файла. */
export interface EconForecastInput {
  readonly forecast_scans: number;
  readonly basic_mix: number;
  readonly complete_mix: number;
  readonly forecast_gross_revenue: number;
  readonly fixed_costs: number;
  readonly support_reserve: number;
  readonly refund_rate: number;
  readonly chargeback_rate: number;
  readonly expected_refund_loss: number;
  readonly expected_chargeback_loss: number;
  readonly fx_buffer: number;
  /** Налог по receipt Paddle: pass-through не входит в margin, expense — входит. */
  readonly tax_treatment: 'pass-through' | 'expense';
  readonly tax_expense_per_scan?: number;
  readonly variable_cost_basic_p95: number;
  readonly variable_cost_complete_p95: number;
  /** Если задан — сверяется с пересчётом (после Paddle fee и p95 cost). */
  readonly weighted_average_contribution_margin?: number;
  /** Без счетов всех provider ECON-001 автоматически не проходит (§18). */
  readonly provider_invoices_confirmed: boolean;
}

export interface EconFailure {
  readonly code:
    | 'input'
    | 'mix'
    | 'gross-revenue'
    | 'reserve-floor'
    | 'cost-ceiling'
    | 'tax'
    | 'margin'
    | 'provider-invoices'
    | 'break-even'
    | 'operational-floor';
  readonly message: string;
}

export interface EconReport {
  readonly forecastScans: number;
  readonly forecastGrossRevenueUsd: number;
  readonly supportReserveFloorUsd: number;
  readonly weightedContributionMarginUsd: number;
  readonly breakEvenScans: number;
  readonly operationalFloorScans: number;
}

export type EconValidationResult =
  | { readonly pass: true; readonly report: EconReport }
  | {
      readonly pass: false;
      readonly failures: readonly EconFailure[];
      readonly report: EconReport | null;
    };

const FORECAST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'forecast_scans',
    'basic_mix',
    'complete_mix',
    'forecast_gross_revenue',
    'fixed_costs',
    'support_reserve',
    'refund_rate',
    'chargeback_rate',
    'expected_refund_loss',
    'expected_chargeback_loss',
    'fx_buffer',
    'tax_treatment',
    'variable_cost_basic_p95',
    'variable_cost_complete_p95',
    'provider_invoices_confirmed',
  ],
  properties: {
    forecast_scans: { type: 'number', minimum: 0 },
    basic_mix: { type: 'number', minimum: 0, maximum: 1 },
    complete_mix: { type: 'number', minimum: 0, maximum: 1 },
    forecast_gross_revenue: { type: 'number', minimum: 0 },
    fixed_costs: { type: 'number', minimum: 0 },
    support_reserve: { type: 'number', minimum: 0 },
    refund_rate: { type: 'number', minimum: 0, maximum: 1 },
    chargeback_rate: { type: 'number', minimum: 0, maximum: 1 },
    expected_refund_loss: { type: 'number', minimum: 0 },
    expected_chargeback_loss: { type: 'number', minimum: 0 },
    fx_buffer: { type: 'number', minimum: 0 },
    tax_treatment: { enum: ['pass-through', 'expense'] },
    tax_expense_per_scan: { type: 'number', minimum: 0 },
    variable_cost_basic_p95: { type: 'number', minimum: 0 },
    variable_cost_complete_p95: { type: 'number', minimum: 0 },
    weighted_average_contribution_margin: { type: 'number' },
    provider_invoices_confirmed: { type: 'boolean' },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const validateForecastShape = ajv.compile(FORECAST_SCHEMA);

/** Полная проверка ECON-001; отказ перечисляет все причины сразу. */
export function validateEconForecast(value: unknown): EconValidationResult {
  if (!validateForecastShape(value)) {
    const failures = (validateForecastShape.errors ?? []).map((error): EconFailure => ({
      code: 'input',
      message: `forecast${error.instancePath} ${error.message ?? error.keyword}`,
    }));
    return { pass: false, failures, report: null };
  }
  const input = value as unknown as EconForecastInput;
  const failures = [
    ...mixFailures(input),
    ...grossRevenueFailures(input),
    ...reserveFloorFailures(input),
    ...costCeilingFailures(input),
    ...taxFailures(input),
    ...marginFailures(input),
    ...invoiceFailures(input),
    ...volumeFailures(input),
  ];
  const report = buildReport(input);
  if (failures.length > 0) {
    return { pass: false, failures, report };
  }
  if (report === null) {
    // Недостижимо при пустых failures (margin > 0 уже проверен) — защита от рассинхрона.
    return {
      pass: false,
      failures: [{ code: 'margin', message: 'report не построен при нулевой margin' }],
      report: null,
    };
  }
  return { pass: true, report };
}

function mixFailures(input: EconForecastInput): readonly EconFailure[] {
  const total = input.basic_mix + input.complete_mix;
  if (Math.abs(total - 1) <= EPSILON) {
    return [];
  }
  return [
    {
      code: 'mix',
      message: `basic_mix + complete_mix = ${total}, ожидается ровно 1`,
    },
  ];
}

/** §18: валидатор пересчитывает gross revenue из цен тарифов и mix. */
function grossRevenueFailures(input: EconForecastInput): readonly EconFailure[] {
  const recomputed = recomputedGrossCents(input);
  const declared = toCents(input.forecast_gross_revenue);
  if (Math.abs(recomputed - declared) <= MONEY_TOLERANCE_CENTS) {
    return [];
  }
  return [
    {
      code: 'gross-revenue',
      message:
        `forecast_gross_revenue $${fromCents(declared)} не совпадает с пересчётом из цен и mix ` +
        `$${fromCents(recomputed)} (${input.forecast_scans} × (basic ${input.basic_mix} × ` +
        `$${TARIFFS.Basic.priceUsd} + complete ${input.complete_mix} × $${TARIFFS.Complete.priceUsd}))`,
    },
  ];
}

function reserveFloorFailures(input: EconForecastInput): readonly EconFailure[] {
  const floorCents = reserveFloorCents(input);
  const reserveCents = toCents(input.support_reserve);
  if (reserveCents >= floorCents) {
    return [];
  }
  return [
    {
      code: 'reserve-floor',
      message:
        `support_reserve $${fromCents(reserveCents)} ниже floor $${fromCents(floorCents)} ` +
        `(max($${SUPPORT_RESERVE_MIN_USD}, ${SUPPORT_RESERVE_GROSS_SHARE * 100}% × gross))`,
    },
  ];
}

function costCeilingFailures(input: EconForecastInput): readonly EconFailure[] {
  const checks = [
    ['variable_cost_basic_p95', input.variable_cost_basic_p95, VARIABLE_COST_CEILING_USD.basic],
    [
      'variable_cost_complete_p95',
      input.variable_cost_complete_p95,
      VARIABLE_COST_CEILING_USD.complete,
    ],
  ] as const;
  return checks.flatMap(([field, actual, ceiling]) =>
    toCents(actual) <= toCents(ceiling)
      ? []
      : [
          {
            code: 'cost-ceiling',
            message: `${field} $${actual} превышает hard ceiling $${ceiling} (§18)`,
          } as const,
        ],
  );
}

function taxFailures(input: EconForecastInput): readonly EconFailure[] {
  if (input.tax_treatment === 'expense' && input.tax_expense_per_scan === undefined) {
    return [
      {
        code: 'tax',
        message: 'tax_treatment=expense требует tax_expense_per_scan (USD за прогон)',
      },
    ];
  }
  if (input.tax_treatment === 'pass-through' && (input.tax_expense_per_scan ?? 0) > 0) {
    return [
      {
        code: 'tax',
        message: 'pass-through налог не является расходом FluxLab и не входит в margin (§18)',
      },
    ];
  }
  return [];
}

function marginFailures(input: EconForecastInput): readonly EconFailure[] {
  const weighted = weightedMarginCents(input);
  const found: EconFailure[] = [];
  if (weighted <= 0) {
    found.push({
      code: 'margin',
      message: `weighted average contribution margin $${fromCents(weighted)} обязан быть > 0`,
    });
  }
  const declared = input.weighted_average_contribution_margin;
  if (declared !== undefined && Math.abs(toCents(declared) - weighted) > MONEY_TOLERANCE_CENTS) {
    found.push({
      code: 'margin',
      message:
        `заявленная weighted_average_contribution_margin $${declared} не совпадает с пересчётом ` +
        `$${fromCents(weightedMarginCents(input))} (после Paddle fee и p95 variable cost)`,
    });
  }
  return found;
}

function invoiceFailures(input: EconForecastInput): readonly EconFailure[] {
  return input.provider_invoices_confirmed
    ? []
    : [
        {
          code: 'provider-invoices',
          message: 'нет подтверждённых счетов всех provider — gate закрыт (§18)',
        },
      ];
}

/** Break-even (единственная формула §18) и operational floor 45. */
function volumeFailures(input: EconForecastInput): readonly EconFailure[] {
  const found: EconFailure[] = [];
  const breakEven = breakEvenScans(input);
  if (breakEven !== null && input.forecast_scans < breakEven) {
    found.push({
      code: 'break-even',
      message:
        `forecast_scans ${input.forecast_scans} не покрывает risk-adjusted break-even ` +
        `${breakEven} = ceil((fixed + reserve + refund/chargeback loss + FX) / margin)`,
    });
  }
  if (input.forecast_scans < ECON_OPERATIONAL_FLOOR_SCANS) {
    found.push({
      code: 'operational-floor',
      message: `forecast_scans ${input.forecast_scans} ниже operational floor ${ECON_OPERATIONAL_FLOOR_SCANS}`,
    });
  }
  return found;
}

function buildReport(input: EconForecastInput): EconReport | null {
  const margin = weightedMarginCents(input);
  const breakEven = breakEvenScans(input);
  if (margin <= 0 || breakEven === null) {
    return null;
  }
  return {
    forecastScans: input.forecast_scans,
    forecastGrossRevenueUsd: fromCents(recomputedGrossCents(input)),
    supportReserveFloorUsd: fromCents(reserveFloorCents(input)),
    weightedContributionMarginUsd: fromCents(margin),
    breakEvenScans: breakEven,
    operationalFloorScans: ECON_OPERATIONAL_FLOOR_SCANS,
  };
}

function recomputedGrossCents(input: EconForecastInput): number {
  const perScanCents =
    input.basic_mix * toCents(TARIFFS.Basic.priceUsd) +
    input.complete_mix * toCents(TARIFFS.Complete.priceUsd);
  return Math.round(input.forecast_scans * perScanCents);
}

function reserveFloorCents(input: EconForecastInput): number {
  return Math.max(
    toCents(SUPPORT_RESERVE_MIN_USD),
    Math.round(SUPPORT_RESERVE_GROSS_SHARE * recomputedGrossCents(input)),
  );
}

/** Margin плана: цена − Paddle fee (5% + $0.50) − p95 cost − non-pass-through tax. */
function planMarginCents(priceUsd: number, variableCostUsd: number, taxCents: number): number {
  const priceCents = toCents(priceUsd);
  const paddleFeeCents = Math.round(priceCents * PADDLE_FEE_RATE) + toCents(PADDLE_FEE_FLAT_USD);
  return priceCents - paddleFeeCents - toCents(variableCostUsd) - taxCents;
}

function weightedMarginCents(input: EconForecastInput): number {
  const taxCents = input.tax_treatment === 'expense' ? toCents(input.tax_expense_per_scan ?? 0) : 0;
  const basic = planMarginCents(TARIFFS.Basic.priceUsd, input.variable_cost_basic_p95, taxCents);
  const complete = planMarginCents(
    TARIFFS.Complete.priceUsd,
    input.variable_cost_complete_p95,
    taxCents,
  );
  return input.basic_mix * basic + input.complete_mix * complete;
}

function breakEvenScans(input: EconForecastInput): number | null {
  const margin = weightedMarginCents(input);
  if (margin <= 0) {
    return null; // break-even не существует; отказ фиксирует marginFailures
  }
  const numeratorCents =
    toCents(input.fixed_costs) +
    toCents(input.support_reserve) +
    toCents(input.expected_refund_loss) +
    toCents(input.expected_chargeback_loss) +
    toCents(input.fx_buffer);
  return ceilWithEpsilon(numeratorCents / margin);
}

/** ceil, не «дотягивающий» вверх значения, отличающиеся от целого float-шумом. */
function ceilWithEpsilon(quotient: number): number {
  const nearest = Math.round(quotient);
  return Math.abs(quotient - nearest) <= EPSILON ? nearest : Math.ceil(quotient);
}

function toCents(usd: number): number {
  return Math.round(usd * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}
