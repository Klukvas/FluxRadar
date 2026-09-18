// Reading what the Analytics checks concluded, beside the Google snapshot the
// section stores (D-219). A report from before the checks existed has only the
// snapshot, so every reader answers null or an empty list rather than throwing.

import { asRecord, numberValue } from './module-metadata';

export interface AnalyticsTrend {
  readonly metric: 'clicks' | 'impressions';
  readonly previous: number;
  readonly current: number;
}

export interface QueryOpportunity {
  readonly query: string;
  readonly impressions: number;
  readonly position: number;
}

export interface TopPageFindings {
  readonly url: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly findings: number;
  /** The most severe finding on the page, as the API names it; null when none. */
  readonly highestSeverity: string | null;
  /** The checks that found them, most severe first; empty on older reports. */
  readonly ruleIds: readonly string[];
}

export interface AnalyticsAnalysis {
  /** Null when there was too little search traffic to call a trend. */
  readonly trend: AnalyticsTrend | null;
  readonly nearTop: readonly QueryOpportunity[];
  readonly topPages: readonly TopPageFindings[];
}

export function analyticsAnalysisOf(
  metadata: Readonly<Record<string, unknown>> | undefined,
): AnalyticsAnalysis | null {
  const analysis = asRecord(metadata?.analysis);
  if (analysis === null) return null;
  return {
    trend: trendOf(analysis.trend),
    nearTop: listOf(analysis.nearTop, queryOf),
    topPages: listOf(analysis.topPages, topPageOf),
  };
}

function trendOf(value: unknown): AnalyticsTrend | null {
  const record = asRecord(value);
  const previous = numberValue(record?.previous);
  const current = numberValue(record?.current);
  const metric = record?.metric;
  if ((metric !== 'clicks' && metric !== 'impressions') || previous === null || current === null) {
    return null;
  }
  return { metric, previous, current };
}

function queryOf(record: Record<string, unknown>): QueryOpportunity | null {
  const impressions = numberValue(record.impressions);
  const position = numberValue(record.position);
  if (typeof record.query !== 'string' || impressions === null || position === null) return null;
  return { query: record.query, impressions, position };
}

function topPageOf(record: Record<string, unknown>): TopPageFindings | null {
  const impressions = numberValue(record.impressions);
  const clicks = numberValue(record.clicks);
  const findings = numberValue(record.findings);
  if (
    typeof record.url !== 'string' ||
    impressions === null ||
    clicks === null ||
    findings === null
  ) {
    return null;
  }
  return {
    url: record.url,
    impressions,
    clicks,
    findings,
    highestSeverity: typeof record.highestSeverity === 'string' ? record.highestSeverity : null,
    ruleIds: Array.isArray(record.ruleIds)
      ? record.ruleIds.filter((ruleId): ruleId is string => typeof ruleId === 'string')
      : [],
  };
}

function listOf<T>(value: unknown, read: (record: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const record = asRecord(entry);
    const parsed = record === null ? null : read(record);
    return parsed === null ? [] : [parsed];
  });
}
