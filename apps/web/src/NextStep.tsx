// The owner's next step for one site, worked out from that site's last scan.
//
// It lived inside DesktopScreen and was fed the newest scan of the whole
// account, so an owner with two sites was told to "work through your report"
// for whichever one had been checked last. The decision is now about one site
// at a time: the single-site desktop still shows it as its own panel, and the
// multi-site desktop shows it once per site (see SiteNextSteps).

import { useState } from 'react';

import { canRetrySection, isReportReady, type Scan, type SiteProfile } from './api';
import { Button, Panel } from './components';
import { desktopCopy, type NextStepKind } from './desktop-copy';
import type { Language } from './i18n';
import { displayDomain, isTerminalScanStatus } from './scan-status';

export type NewScanPlan = 'Free' | 'WebsiteAudit' | 'Complete';

/**
 * The status reasons the API gives a scan whose crawl never read the site.
 *
 * `SITE_REACH_STATUS_REASONS` in @fluxradar/contracts, matched as literals
 * because the web app does not depend on the contracts package.
 */
const SITE_REACH_STATUS_REASONS: readonly string[] = [
  'SiteDeniedAccess',
  'SiteBlockedByRobots',
  'SiteUnreachable',
  'SiteReturnedNoReadablePage',
];

/**
 * Whether a failed scan could not read the site it was about.
 *
 * The API settles such a scan as Failed (no section had a page to work on), so
 * without this it read as the platform-side failure the generic copy
 * describes. The crawl summary is the direct answer; the status reason says
 * the same thing for a scan whose summary did not reach the list.
 */
function isUnreadScan(scan: Scan): boolean {
  // The API settles an unread site as Failed and nothing else: a scan the owner
  // cancelled may carry an unread first attempt, but it is not this case.
  if (scan.status !== 'Failed') return false;
  const summary = scan.crawlSummary;
  if (summary !== null && summary !== undefined && summary.reach !== 'reachable') return true;
  return scan.statusReason !== null && SITE_REACH_STATUS_REASONS.includes(scan.statusReason);
}

/** What the owner should do next, from their sites and one site's latest scan. */
export function nextStepFor(profiles: readonly SiteProfile[], latest: Scan | null): NextStepKind {
  if (profiles.length === 0) return 'noProfiles';
  if (latest === null) return 'noScans';
  if (!isTerminalScanStatus(latest.status) || !isReportReady(latest)) return 'running';
  // Ahead of the generic failure: a site that refused us or never answered is
  // the owner's to fix, not a platform fault to wait out.
  if (isUnreadScan(latest)) return 'unread';
  if (/failed|cancelled/i.test(latest.status)) return 'failed';
  // A Partial report reads, but a section came back incomplete and can be run
  // once more. Once that retry is spent, it is a finished report like any other.
  if (canRetrySection(latest)) return 'partial';
  return latest.plan === 'Free' ? 'freeDone' : 'paidDone';
}

export interface NextStepActionsProps {
  readonly language: Language;
  readonly kind: NextStepKind;
  /** The site the step is about; undefined only when there is no site at all. */
  readonly profile: SiteProfile | undefined;
  readonly latest: Scan | null;
  readonly onAddSite: () => void;
  readonly onNewScan: (profile: SiteProfile, plan?: NewScanPlan) => void;
  readonly onOpenScan: (scanId: string) => void;
  readonly onRetryScan: (scanId: string) => Promise<void>;
}

/** The address a step names: the scan's own, else the site's. */
export function stepDomain(profile: SiteProfile | undefined, latest: Scan | null): string {
  if (latest !== null) return displayDomain(latest.domain);
  return profile ? displayDomain(profile.domain) : '';
}

/** The step's body and buttons, without the panel around them. */
export function NextStepActions(props: NextStepActionsProps) {
  const d = desktopCopy[props.language].nextStep;
  const [retrying, setRetrying] = useState(false);
  const { kind, latest, profile } = props;
  const domain = stepDomain(profile, latest);
  const act = (): void => {
    if (kind === 'noProfiles') {
      props.onAddSite();
      return;
    }
    if (kind === 'noScans' && profile) {
      props.onNewScan(profile, 'Free');
      return;
    }
    if (kind === 'freeDone' && profile) {
      props.onNewScan(profile, 'Complete');
      return;
    }
    if (kind === 'partial' && latest !== null) {
      setRetrying(true);
      void props.onRetryScan(latest.id).finally(() => setRetrying(false));
      return;
    }
    if (latest !== null) props.onOpenScan(latest.id);
  };
  return (
    <>
      <p>{d.bodies[kind](domain)}</p>
      <div className="button-row">
        <Button variant="primary" onClick={act} disabled={retrying}>
          {d.actions[kind](domain)}
        </Button>
        {kind === 'freeDone' && latest !== null ? (
          <Button onClick={() => props.onOpenScan(latest.id)}>{d.freeReport(domain)}</Button>
        ) : null}
        {kind === 'partial' && latest !== null ? (
          <Button onClick={() => props.onOpenScan(latest.id)}>{d.openReport(domain)}</Button>
        ) : null}
      </div>
    </>
  );
}

/** The single-site desktop's next step: one panel, titled by the step. */
export function NextStep(
  props: Omit<NextStepActionsProps, 'profile'> & {
    readonly profiles: readonly SiteProfile[];
  },
) {
  const d = desktopCopy[props.language].nextStep;
  const profile =
    props.profiles.find((candidate) => candidate.id === props.latest?.profileId) ??
    props.profiles[0];
  return (
    <Panel title={d.titles[props.kind]} className="next-step">
      <NextStepActions {...props} profile={profile} />
    </Panel>
  );
}
