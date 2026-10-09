// One status block per saved site, each with that site's own next step.
//
// The desktop used to build "Next step" and "Site status" from the account's
// single newest scan. With a salon site and a developer's site saved, both
// cards talked about the developer's report while the salon's own checks had
// failed — and the owner read that as the salon being checked and fine. Each
// site now gets its own block, named in its heading, read from that site's own
// last scan, so no site is ever described by another site's report.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiRequest, apiRequestWithMeta, type Scan, type SiteProfile } from './api';
import { Button, FieldRow, SkeletonRows, StatusChip } from './components';
import { desktopCopy } from './desktop-copy';
import { copy, type Language } from './i18n';
import { NextStepActions, nextStepFor, type NewScanPlan } from './NextStep';
import { displayDomain, formatTimestamp, scanStateLabel } from './scan-status';
import './styles/site-next-steps.css';

/** What is known about one site's last scan. */
type SiteLatest =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly latest: Scan | null };

const LOADING: SiteLatest = { state: 'loading' };

export interface SiteNextStepsProps {
  readonly language: Language;
  /** Passed straight through: see `locked` on NextStepActionsProps. */
  readonly locked: boolean;
  readonly profiles: readonly SiteProfile[];
  readonly onAddSite: () => void;
  readonly onNewScan: (profile: SiteProfile, plan?: NewScanPlan) => void;
  readonly onOpenScan: (scanId: string) => void;
  readonly onRetryScan: (scanId: string) => Promise<void>;
  /**
   * Hands the screen the scan the panels below should follow: the newest of
   * every site's answer, or null when that cannot be known.
   */
  readonly onLatest?: (latest: Scan | null) => void;
}

/** A list row is only trusted once the fields this screen reads are present. */
function isScanRow(value: unknown): value is Scan {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return ['id', 'profileId', 'domain', 'status', 'plan', 'createdAt'].every(
    (key) => typeof row[key] === 'string',
  );
}

/** The last scan of one site; throws when the answer is not a list of scans. */
async function readSiteLatest(profileId: string): Promise<Scan | null> {
  const rows = await apiRequest<unknown>(
    `/profiles/${encodeURIComponent(profileId)}/scans?limit=1&offset=0`,
  );
  if (rows === null) return null;
  if (!Array.isArray(rows)) throw new Error(`Unexpected scan list for profile ${profileId}`);
  const first: unknown = rows[0];
  if (first === undefined) return null;
  if (!isScanRow(first)) throw new Error(`Unexpected scan row for profile ${profileId}`);
  return first;
}

async function settleSite(profileId: string): Promise<SiteLatest> {
  try {
    return { state: 'ready', latest: await readSiteLatest(profileId) };
  } catch (caught) {
    console.error('FluxRadar site status unavailable', { profileId, caught });
    return { state: 'failed' };
  }
}

/**
 * The scan the rest of the screen should follow, once every site has answered.
 *
 * `undefined` while any site is still loading. A site whose read failed makes
 * the answer null: the newest of the sites that did answer may not be the
 * account's newest, and a panel that quietly switched to another site would be
 * the mistake this component exists to stop. Null lets the screen fall back to
 * its first site, as it does for an account with no scans.
 */
function followedScan(results: readonly SiteLatest[]): Scan | null | undefined {
  if (results.some((result) => result.state === 'loading')) return undefined;
  if (results.some((result) => result.state === 'failed')) return null;
  return results.reduce<Scan | null>((newest, result) => {
    if (result.state !== 'ready' || result.latest === null) return newest;
    return newest === null || result.latest.createdAt > newest.createdAt ? result.latest : newest;
  }, null);
}

/** Every site's last scan, with a re-read for one site at a time. */
function useSiteLatest(profileIds: readonly string[]) {
  const [results, setResults] = useState<ReadonlyMap<string, SiteLatest>>(new Map());
  // The newest request per site: an older answer for the same site, or any
  // answer after unmount, is dropped rather than written over a newer state.
  const requests = useRef<Readonly<Record<string, number>>>({});
  const nextRequest = useRef(0);
  const mounted = useRef(true);

  const read = useCallback((profileId: string) => {
    nextRequest.current += 1;
    const request = nextRequest.current;
    requests.current = { ...requests.current, [profileId]: request };
    setResults((previous) => new Map(previous).set(profileId, LOADING));
    void settleSite(profileId).then((result) => {
      if (!mounted.current || requests.current[profileId] !== request) return;
      setResults((previous) => new Map(previous).set(profileId, result));
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Keyed on the ids, not the array: a refreshed list of the same sites is not
  // a reason to read every site again.
  const idsKey = profileIds.join('\n');
  useEffect(() => {
    if (idsKey !== '') idsKey.split('\n').forEach(read);
  }, [idsKey, read]);

  return { results, read };
}

/** How many reports the account's own list holds, from the list envelope. */
function useReportsListed(): number | null {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    apiRequestWithMeta<unknown>('/scans?limit=1&offset=0')
      .then((page) => {
        const value = page.meta?.total;
        if (current && typeof value === 'number' && Number.isFinite(value)) setTotal(value);
      })
      .catch((caught: unknown) => {
        // The row is left out; the per-site blocks are what the owner came for.
        console.error('FluxRadar report count unavailable', caught);
      });
    return () => {
      current = false;
    };
  }, []);
  return total;
}

export function SiteNextSteps(props: SiteNextStepsProps) {
  const t = copy[props.language].siteStatus;
  const profileIds = useMemo(() => props.profiles.map((profile) => profile.id), [props.profiles]);
  const { results, read } = useSiteLatest(profileIds);
  const reportsListed = useReportsListed();

  const siteResults = profileIds.map((id) => results.get(id) ?? LOADING);
  const followed = followedScan(siteResults);
  const { onLatest } = props;
  useEffect(() => {
    if (followed !== undefined) onLatest?.(followed);
  }, [followed, onLatest]);

  return (
    <div className="site-next-steps">
      {props.profiles.map((profile, index) => (
        <SiteBlock
          key={profile.id}
          language={props.language}
          locked={props.locked}
          profile={profile}
          result={siteResults[index] ?? LOADING}
          onRetryLoad={() => read(profile.id)}
          onAddSite={props.onAddSite}
          onNewScan={props.onNewScan}
          onOpenScan={props.onOpenScan}
          onRetryScan={props.onRetryScan}
        />
      ))}
      {/* Facts about the account as a whole, not about any one site. The Google
          data row stays single-site only (SiteStatusPanel): it is per site. */}
      <div className="site-status__rows site-next-steps__account">
        <FieldRow label={t.sitesSaved} value={String(props.profiles.length)} />
        {reportsListed === null ? null : (
          <FieldRow label={t.totalChecks} value={String(reportsListed)} />
        )}
      </div>
    </div>
  );
}

interface SiteBlockProps {
  readonly language: Language;
  readonly locked: boolean;
  readonly profile: SiteProfile;
  readonly result: SiteLatest;
  readonly onRetryLoad: () => void;
  readonly onAddSite: () => void;
  readonly onNewScan: (profile: SiteProfile, plan?: NewScanPlan) => void;
  readonly onOpenScan: (scanId: string) => void;
  readonly onRetryScan: (scanId: string) => Promise<void>;
}

function SiteBlock(props: SiteBlockProps) {
  const d = desktopCopy[props.language];
  const headingId = `site-next-step-${props.profile.id}`;
  return (
    <section className="panel next-step site-next-step" aria-labelledby={headingId}>
      <h2 className="site-next-step__heading" id={headingId}>
        {d.siteHeading(props.profile.name, displayDomain(props.profile.domain))}
      </h2>
      <SiteBlockBody
        language={props.language}
        locked={props.locked}
        profile={props.profile}
        result={props.result}
        onRetryLoad={props.onRetryLoad}
        onAddSite={props.onAddSite}
        onNewScan={props.onNewScan}
        onOpenScan={props.onOpenScan}
        onRetryScan={props.onRetryScan}
      />
    </section>
  );
}

function SiteBlockBody(props: SiteBlockProps) {
  const t = copy[props.language].siteStatus;
  const d = desktopCopy[props.language].nextStep;
  const { result } = props;
  if (result.state === 'loading') return <SkeletonRows rows={2} />;
  if (result.state === 'failed') {
    return (
      <>
        <p className="muted" role="alert">
          {t.errorTitle}
        </p>
        <div className="button-row">
          <Button onClick={props.onRetryLoad}>{t.retry}</Button>
        </div>
      </>
    );
  }
  const kind = nextStepFor([props.profile], result.latest);
  return (
    <>
      {result.latest === null ? null : <ScanFacts scan={result.latest} language={props.language} />}
      <p className="site-next-step__title">
        <strong>{d.titles[kind]}</strong>
      </p>
      <NextStepActions
        language={props.language}
        locked={props.locked}
        kind={kind}
        profile={props.profile}
        latest={result.latest}
        onAddSite={props.onAddSite}
        onNewScan={props.onNewScan}
        onOpenScan={props.onOpenScan}
        onRetryScan={props.onRetryScan}
      />
    </>
  );
}

/** Result, plan and time of one scan — the per-site share of "Site status". */
function ScanFacts(props: { readonly scan: Scan; readonly language: Language }) {
  const t = copy[props.language].siteStatus;
  const { scan } = props;
  const finished = formatTimestamp(scan.completedAt, props.language);
  const started = formatTimestamp(scan.startedAt ?? scan.createdAt, props.language);
  return (
    <div className="site-status__rows">
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
    </div>
  );
}
