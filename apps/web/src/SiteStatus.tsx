// What is actually true about this account's sites, on the Profiles screen.
//
// The panel this replaces was called "Subscription model" and showed three
// constants: the word "Pay-per-scan" and the two catalogue prices. It never read
// anything, so it said the same thing to an owner who had never run a check and
// to one whose last report had failed an hour earlier — and it described a
// subscription state the product does not have.
//
// Everything here is read from the API and nothing is inferred. The last check
// and how many there have been come from the reports list the Reports tab
// already pages through; the Google state comes from the binding stored for that
// site's profile. When a fact is not available it is named as unavailable rather
// than guessed at, and the three states a data screen must have — loading,
// empty, failed (§9 of the design system) — are all present.

import { useCallback, useEffect, useState } from 'react';

import {
  apiRequest,
  apiRequestWithMeta,
  ApiRequestError,
  type GoogleBinding,
  type Scan,
  type SiteProfile,
} from './api';
import { Button, FieldRow, Panel, SkeletonRows, StatusChip } from './components';
import { copy, type Language } from './i18n';
import { displayDomain, formatTimestamp, scanStateLabel } from './scan-status';

/** What the panel knows once both requests have settled. */
interface SiteStatusData {
  readonly latest: Scan | null;
  /**
   * How many reports the account's own list holds, from the list envelope's
   * count — which is deliberately NOT "every check ever run". An account that
   * has bought Basic but never Complete is shown one report by the history gate
   * (apps/api/src/scans/routes.ts), so the number here is what that owner can
   * open, and the row is labelled as that rather than as a total it is not.
   */
  readonly totalScans: number;
  /**
   * The Google properties bound to the last checked site: null when none are,
   * and undefined when the binding could not be read — an unreadable binding
   * must not read as "not connected".
   */
  readonly binding: GoogleBinding | null | undefined;
}

export interface SiteStatusPanelProps {
  readonly language: Language;
  /** The profiles already loaded by the screen; no second request for them. */
  readonly profiles: readonly SiteProfile[];
}

export function SiteStatusPanel(props: SiteStatusPanelProps) {
  const t = copy[props.language].siteStatus;
  const [data, setData] = useState<SiteStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * Whether the last read failed — which is all this panel needs to know.
   *
   * It used to keep the thrown message and show it. Every message an
   * `ApiRequestError` carries is written in English, by the API or by the
   * status-code fallbacks in `api.ts`, so a Ukrainian owner met a sentence of
   * English prose in the middle of a translated screen. The panel says what
   * happened in the language it is being read in, and the retry below is the
   * part that was ever actionable.
   */
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setFailed(false);
    try {
      // One row is all this panel shows; the envelope's `total` carries the rest.
      const page = await apiRequestWithMeta<Scan[] | null>('/scans?limit=1&offset=0');
      const scans = Array.isArray(page.data) ? page.data : [];
      const latest = scans[0] ?? null;
      setData({
        latest,
        totalScans: page.meta?.total ?? scans.length,
        binding: latest === null ? null : await readBinding(latest.profileId),
      });
    } catch {
      setData(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={t.title}>
      <SiteStatusBody
        language={props.language}
        profiles={props.profiles}
        data={data}
        loading={loading}
        failed={failed}
        onRetry={() => void load()}
      />
    </Panel>
  );
}

function SiteStatusBody(props: {
  language: Language;
  profiles: readonly SiteProfile[];
  data: SiteStatusData | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = copy[props.language].siteStatus;
  if (props.loading) return <SkeletonRows rows={3} />;
  if (props.failed) {
    return (
      <>
        <p className="muted" role="alert">
          {t.errorTitle}
        </p>
        <div className="button-row">
          <Button onClick={props.onRetry}>{t.retry}</Button>
        </div>
      </>
    );
  }
  const data = props.data;
  if (data === null || data.latest === null) {
    return (
      <>
        <FieldRow label={t.sitesSaved} value={String(props.profiles.length)} />
        <p className="muted">{props.profiles.length === 0 ? t.emptyNoSites : t.emptyNoChecks}</p>
        <p className="muted">
          <a href="/checks">{t.coverageLink}</a>
        </p>
      </>
    );
  }
  const scan = data.latest;
  const finished = formatTimestamp(scan.completedAt, props.language);
  const started = formatTimestamp(scan.startedAt ?? scan.createdAt, props.language);
  return (
    <>
      <FieldRow label={t.lastSite} value={displayDomain(scan.domain)} technical />
      <FieldRow
        label={t.lastResult}
        value={
          <StatusChip status={scan.status} label={scanStateLabel(scan.status, props.language)} />
        }
      />
      <FieldRow label={t.lastPlan} value={scan.plan} />
      <FieldRow
        label={finished === null ? t.startedLabel : t.finishedLabel}
        value={finished ?? started ?? t.unknownTime}
        technical
      />
      <FieldRow label={t.totalChecks} value={String(data.totalScans)} />
      <FieldRow label={t.sitesSaved} value={String(props.profiles.length)} />
      <FieldRow label={t.googleLabel} value={googleValue(data.binding, props.language)} />
    </>
  );
}

/** What the Google row says, from the binding alone — never from a guess. */
function googleValue(binding: GoogleBinding | null | undefined, language: Language): string {
  const t = copy[language].siteStatus;
  if (binding === undefined) return t.googleUnknown;
  if (binding === null) return t.googleNotLinked;
  const sources = [
    binding.searchConsoleSiteUrl === null ? null : t.googleSearchConsole,
    binding.ga4PropertyId === null ? null : (binding.ga4PropertyName ?? t.googleAnalytics),
  ].filter((source): source is string => source !== null);
  return sources.length === 0 ? t.googleNotLinked : sources.join(' · ');
}

/**
 * The Google binding for one profile, or `undefined` when it cannot be read.
 *
 * A 404 is a real answer — that profile is gone — and every other failure is the
 * panel not knowing. Neither is allowed to take down the rest of the panel: the
 * last check's status is the thing the owner came for.
 */
async function readBinding(profileId: string): Promise<GoogleBinding | null | undefined> {
  try {
    return await apiRequest<GoogleBinding | null>(
      `/profiles/${encodeURIComponent(profileId)}/google-binding`,
    );
  } catch (caught) {
    return caught instanceof ApiRequestError && caught.status === 404 ? null : undefined;
  }
}
