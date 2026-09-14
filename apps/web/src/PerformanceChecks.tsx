// What the Performance section measured, opened from its card.
//
// Lab and real-visitor numbers are listed apart: a lab run is one page load from
// Google's servers, the Chrome UX Report is what visitors actually got, and the
// two can disagree without either being wrong.

import type { ScanModule } from './api';
import { CheckRow } from './CheckRow';
import { copy, fillCopy, type Language } from './i18n';
import {
  performanceChecksOf,
  type MetricName,
  type MetricUnit,
  type MetricVerdict,
  type PerformanceMeasurement,
} from './performance-checks';

/**
 * Class suffix per verdict. The colour repeats the word beside it, never replaces
 * it. A measurement without a threshold is neutral: in the warning amber of
 * "needs improvement" it read as a second warning about the page's weight.
 */
const VERDICT_CLASS: Readonly<Record<MetricVerdict, string>> = {
  good: 'passed',
  needsImprovement: 'partial',
  poor: 'issues',
  measured: 'skipped',
  noData: 'skipped',
};

export function PerformanceChecksBody(props: {
  metadata: ScanModule['metadata'];
  language: Language;
}) {
  const checks = performanceChecksOf(props.metadata);
  if (checks === null) return null;
  const t = copy[props.language].report.checks;
  const strategy =
    checks.strategy === null
      ? null
      : checks.strategy === 'mobile'
        ? t.perfStrategyMobile
        : t.perfStrategyDesktop;
  return (
    <>
      <p className="muted">{t.perfLead}</p>
      <MeasurementGroup
        heading={strategy === null ? t.perfLabHeading : `${t.perfLabHeading} · ${strategy}`}
        measurements={checks.lab}
        language={props.language}
      />
      <MeasurementGroup
        heading={t.perfFieldHeading}
        measurements={checks.field}
        language={props.language}
      />
    </>
  );
}

function MeasurementGroup(props: {
  heading: string;
  measurements: readonly PerformanceMeasurement[];
  language: Language;
}) {
  if (props.measurements.length === 0) return null;
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{props.heading}</h4>
      <ul className="module-checks__list">
        {props.measurements.map((measurement) => (
          <CheckRow
            key={measurement.metric}
            resultClass={VERDICT_CLASS[measurement.verdict]}
            resultLabel={verdictLabel(measurement.verdict, props.language)}
            title={metricTitle(measurement.metric, props.language)}
            detail={measurementDetail(measurement, props.language)}
          />
        ))}
      </ul>
    </div>
  );
}

function verdictLabel(verdict: MetricVerdict, language: Language): string {
  const t = copy[language].report.checks;
  const labels: Readonly<Record<MetricVerdict, string>> = {
    good: t.perfGood,
    needsImprovement: t.perfNeedsImprovement,
    poor: t.perfPoor,
    measured: t.perfMeasured,
    noData: t.perfNoData,
  };
  return labels[verdict];
}

function metricTitle(metric: MetricName, language: Language): string {
  const t = copy[language].report.checks;
  const titles: Readonly<Record<MetricName, string>> = {
    lcp: t.perfLcp,
    inp: t.perfInp,
    cls: t.perfCls,
    ttfb: t.perfTtfb,
    weight: t.perfWeight,
  };
  return titles[metric];
}

function measurementDetail(measurement: PerformanceMeasurement, language: Language): string {
  const t = copy[language].report.checks;
  if (measurement.value === null) return t.perfNoDataDetail;
  const value = formatMeasurement(measurement.value, measurement.unit, language);
  if (measurement.thresholds === null) return value;
  return fillCopy(t.perfThresholds, {
    value,
    good: formatMeasurement(measurement.thresholds.good, measurement.unit, language),
    poor: formatMeasurement(measurement.thresholds.poor, measurement.unit, language),
  });
}

function formatMeasurement(value: number, unit: MetricUnit, language: Language): string {
  const t = copy[language].report.checks;
  const number = (amount: number, fractionDigits: number): string =>
    new Intl.NumberFormat(language, { maximumFractionDigits: fractionDigits }).format(amount);
  switch (unit) {
    case 'ms':
      return value >= 1000
        ? fillCopy(t.unitSeconds, { value: number(value / 1000, 1) })
        : fillCopy(t.unitMs, { value: number(value, 0) });
    case 'score':
      return number(value, 3);
    case 'bytes':
      return value >= 1_000_000
        ? fillCopy(t.unitMb, { value: number(value / 1_000_000, 1) })
        : fillCopy(t.unitKb, { value: number(value / 1000, 0) });
  }
}
