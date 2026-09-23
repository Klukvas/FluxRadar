// What the Performance section measured, opened from its card.
//
// The audit measures a few pages on both emulated devices and runs each pair
// more than once, so this panel shows a page at a time rather than one column of
// numbers: which page, which device, the median, how many runs it came from and
// whether those runs agreed. A median from runs that disagreed by half is marked
// as such instead of being presented as a measurement.
//
// HOW MUCH OF THAT IT DID IS THE AUDIT'S TO SAY. A deployment without a PageSpeed
// API key measures one page, on one device, once, so the lead is composed from the
// stored sampling rather than describing the audit the product is capable of —
// which is what it used to do, directly above a row reading "1 of 1 runs usable".
//
// Lab and real-visitor numbers stay apart. A lab run is Lighthouse on Google's
// machines; the Chrome UX Report is what visitors actually got, and it is the
// only source of INP — when it has nothing, the panel says INP could not be
// measured rather than showing the lab proxy in its place.
//
// A report written before the audit existed still opens: it falls back to the
// single flat reading it stored.

import type { ScanModule } from './api';
import { CheckRow } from './CheckRow';
import { copy, fillCopy, type Language } from './i18n';
import {
  INSTABILITY_WARNING_RATIO,
  performanceAuditOf,
  performanceChecksOf,
  type DeviceReading,
  type FieldReading,
  type MetricName,
  type MetricUnit,
  type MetricVerdict,
  type PerformanceAuditReading,
  type PerformanceMeasurement,
  type UrlReading,
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
  const audit = performanceAuditOf(props.metadata);
  if (audit !== null) {
    return <AuditBody audit={audit} language={props.language} />;
  }
  return <LegacyBody metadata={props.metadata} language={props.language} />;
}

/**
 * What the audit did, in its own terms.
 *
 * The full audit measures a few pages on both emulated devices, repeatedly; a
 * deployment with no PageSpeed API key measures one page, on one device, once.
 * The lead is built from the stored sampling rather than stating the larger of the
 * two, which is what it used to do above a row reading "1 of 1 runs usable".
 */
function auditLead(audit: PerformanceAuditReading, language: Language): string {
  const t = copy[language].report.checks;
  const [device] = audit.sampling.devices;
  const devices =
    audit.sampling.devices.length > 1
      ? t.perfAuditDevicesBoth
      : // A row whose devices could not be read states neither one nor two.
        device === undefined
        ? t.perfAuditDevicesUnstated
        : fillCopy(t.perfAuditDevicesOne, {
            device: device === 'mobile' ? t.perfStrategyMobile : t.perfStrategyDesktop,
          });
  return fillCopy(audit.sampling.repeated ? t.perfAuditLeadRepeated : t.perfAuditLeadSingle, {
    devices,
  });
}

function AuditBody(props: { audit: PerformanceAuditReading; language: Language }) {
  const { audit } = props;
  return (
    <>
      <p className="muted">{auditLead(audit, props.language)}</p>
      <SourceNote audit={audit} language={props.language} />
      {audit.urls.map((entry) => (
        <UrlGroup key={entry.url} entry={entry} language={props.language} />
      ))}
      <FieldGroup field={audit.field} language={props.language} />
      <ComparisonGroup audit={audit} language={props.language} />
    </>
  );
}

/** The provider and version behind the numbers, plus what the run was allowed to spend. */
function SourceNote(props: { audit: PerformanceAuditReading; language: Language }) {
  const t = copy[props.language].report.checks;
  const lighthouse = props.audit.providers.find((provider) => provider.name === 'pagespeed');
  const budget = props.audit.budget;
  return (
    <p className="muted">
      {lighthouse?.version == null
        ? t.perfProviderUnknown
        : fillCopy(t.perfProvider, { version: lighthouse.version })}
      {budget === null
        ? null
        : ` · ${fillCopy(t.perfBudget, { used: budget.used, cap: budget.cap })}`}
      {budget?.capped === true ? ` · ${t.perfBudgetCapped}` : null}
    </p>
  );
}

function UrlGroup(props: { entry: UrlReading; language: Language }) {
  const t = copy[props.language].report.checks;
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">
        <span className="technical">{props.entry.url}</span>
        {props.entry.primary ? ` · ${t.perfPrimaryPage}` : ''}
      </h4>
      {props.entry.devices.map((device) => (
        <DeviceGroup key={device.strategy} device={device} language={props.language} />
      ))}
    </div>
  );
}

function DeviceGroup(props: { device: DeviceReading; language: Language }) {
  const t = copy[props.language].report.checks;
  const { device } = props;
  const strategy = device.strategy === 'mobile' ? t.perfStrategyMobile : t.perfStrategyDesktop;
  if (device.usableSamples === 0) {
    return (
      <div className="module-checks__group" role="status">
        <h5 className="google-panel__service">{strategy}</h5>
        <p className="muted">
          {fillCopy(t.perfDeviceUnmeasured, { requested: device.requestedSamples })}
          {device.failures.length === 0 ? '' : ` ${device.failures[0] ?? ''}`}
        </p>
      </div>
    );
  }
  return (
    <div className="module-checks__group">
      <h5 className="google-panel__service">
        {`${strategy} · ${fillCopy(t.perfRuns, {
          usable: device.usableSamples,
          requested: device.requestedSamples,
        })}`}
      </h5>
      <ul className="module-checks__list">
        {device.measurements.map((measurement) => (
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

/**
 * The real-visitor half. Every state gets its own sentence: "we did not ask",
 * "there is no record for this origin" and "the request failed" send a reader to
 * three different places, and INP exists in none of them.
 */
function FieldGroup(props: { field: FieldReading; language: Language }) {
  const t = copy[props.language].report.checks;
  const detail: Readonly<Record<FieldReading['state'], string>> = {
    available: '',
    not_configured: t.perfFieldNotConfigured,
    no_data: t.perfFieldNoData,
    request_failed: t.perfFieldFailed,
  };
  const period =
    props.field.periodStart === null || props.field.periodEnd === null
      ? ''
      : ` · ${props.field.periodStart} → ${props.field.periodEnd}`;
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{`${t.perfFieldHeading}${period}`}</h4>
      {props.field.state === 'available' && props.field.measurements.length > 0 ? (
        <ul className="module-checks__list">
          {props.field.measurements.map((measurement) => (
            <CheckRow
              key={measurement.metric}
              resultClass={VERDICT_CLASS[measurement.verdict]}
              resultLabel={verdictLabel(measurement.verdict, props.language)}
              title={metricTitle(measurement.metric, props.language)}
              detail={measurementDetail(measurement, props.language)}
            />
          ))}
        </ul>
      ) : (
        <p className="muted" role="status">
          {detail[props.field.state]}
        </p>
      )}
      {props.field.state === 'available' &&
      props.field.measurements.some((measurement) => measurement.metric === 'inp') ? null : (
        // Said in as many words, because the lab section deliberately does not
        // carry an INP row that a reader might take for one.
        <p className="muted">{t.perfInpUnavailable}</p>
      )}
    </div>
  );
}

/**
 * Why the two scans may not be compared, in the reader's language.
 *
 * The audit stores a code and an English sentence. The code is phrased here; the
 * sentence is what a reader still gets for a report written before the code
 * existed, or for a code a later release adds — a fact in the API's English beats
 * losing the fact.
 */
function incomparableClause(audit: PerformanceAuditReading, language: Language): string | null {
  const t = copy[language].report.checks;
  const detail = audit.incomparable;
  const templates: Readonly<Record<string, string>> = {
    AuditVersionChanged: t.perfIncomparableAuditVersion,
    LighthouseVersionUnrecorded: t.perfIncomparableVersionUnrecorded,
    LighthouseMajorChanged: t.perfIncomparableMajorChanged,
  };
  const template = detail === null ? undefined : templates[detail.code];
  if (template === undefined || detail === null) return audit.incomparableReason;
  return fillCopy(template, { previous: detail.previous ?? '—', current: detail.current ?? '—' });
}

function ComparisonGroup(props: { audit: PerformanceAuditReading; language: Language }) {
  const t = copy[props.language].report.checks;
  const { audit } = props;
  if (!audit.hasPrevious) return null;
  const incomparable = incomparableClause(audit, props.language);
  return (
    <div className="module-checks__group">
      <h4 className="module-checks__subheading">{t.perfRegressionsHeading}</h4>
      {incomparable !== null ? (
        <p className="muted" role="status">
          {fillCopy(t.perfNotCompared, { reason: incomparable })}
        </p>
      ) : audit.regressions.length === 0 ? (
        <p className="muted">{t.perfNoRegressions}</p>
      ) : (
        <ul className="module-checks__list">
          {audit.regressions.map((regression) => (
            <CheckRow
              key={`${regression.url}-${regression.strategy}-${regression.metric}`}
              resultClass="issues"
              resultLabel={t.perfRegressed}
              title={`${regression.metric} · ${
                regression.strategy === 'mobile' ? t.perfStrategyMobile : t.perfStrategyDesktop
              }`}
              detail={`${regression.url} · ${regression.previous} → ${regression.current}`}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A report written before the bounded audit: one page, one device, one run. */
function LegacyBody(props: { metadata: ScanModule['metadata']; language: Language }) {
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
    tbt: t.perfTbt,
    weight: t.perfWeight,
    htmlWeight: t.perfHtmlWeight,
    requests: t.perfRequests,
  };
  return titles[metric];
}

function measurementDetail(measurement: PerformanceMeasurement, language: Language): string {
  const t = copy[language].report.checks;
  // Absent, not zero: the provider did not report this metric for this run.
  if (measurement.value === null) return t.perfNoDataDetail;
  const value = formatMeasurement(measurement.value, measurement.unit, language);
  const parts = [
    measurement.thresholds === null
      ? measurement.unit === 'count' || measurement.unit === 'bytes'
        ? `${value} · ${t.perfBudgetNote}`
        : value
      : fillCopy(t.perfThresholds, {
          value,
          good: formatMeasurement(measurement.thresholds.good, measurement.unit, language),
          poor: formatMeasurement(measurement.thresholds.poor, measurement.unit, language),
        }),
  ];
  if ((measurement.instability ?? 0) >= INSTABILITY_WARNING_RATIO) {
    parts.push(
      fillCopy(t.perfUnstable, {
        spread: `${Math.round((measurement.instability ?? 0) * 100)}%`,
      }),
    );
  }
  return parts.join(' · ');
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
    case 'count':
      return number(value, 0);
    case 'bytes':
      return value >= 1_000_000
        ? fillCopy(t.unitMb, { value: number(value / 1_000_000, 1) })
        : fillCopy(t.unitKb, { value: number(value / 1000, 0) });
  }
}
