// The progress window of a running scan, and the state it ends in.
//
// It polls the scan rather than the queue, and speaks in audit sections rather
// than modules: the owner watching it wants to know whether their report is
// coming, not what the worker is doing.

import { useEffect, useState } from 'react';

import { trackEvent } from './analytics';
import { apiRequest, type Scan, type ScanModule } from './api';
import { Button, EmptyState, FieldRow, Panel, ProgressBar, StatusChip, Window } from './components';
import { copy, fillCopy, type Language } from './i18n';
import { moduleStatusReasons } from './module-status';
import { planName } from './plan-modules';
import {
  displayDomain,
  formatTimestamp,
  isTerminalScanStatus,
  scanOutcomeLabel,
  scanStateLabel,
  sectionStatusLabel,
} from './scan-status';

export function ScanScreen(props: {
  scan: Scan | null;
  language: Language;
  onUpdate: (scan: Scan) => void;
  onDone: () => void;
  onReports: () => void;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].scanProgress;
  const [cancelBusy, setCancelBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  useEffect(() => {
    if (props.scan === null || isTerminalScanStatus(props.scan.status)) return undefined;
    let cancelled = false;
    // Polls overlap when a request outlasts the interval, and two of them can
    // both see the scan finish.
    let completionReported = false;
    const scanId = props.scan.id;
    const poll = async () => {
      try {
        const scan = await apiRequest<Scan>(`/scans/${scanId}`);
        if (cancelled) return;
        props.onUpdate(scan);
        if (isTerminalScanStatus(scan.status) && timer !== undefined) {
          window.clearInterval(timer);
          // Only a scan watched to the end is reported: this effect never polls
          // one that was already finished when the screen opened.
          if (!completionReported) {
            completionReported = true;
            trackEvent('scan_completed', { plan: scan.plan, status: scan.status });
          }
        }
      } catch (caught) {
        if (!cancelled)
          props.onError(caught instanceof Error ? caught.message : 'Scan status unavailable');
      }
    };
    const timer = window.setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [props.scan?.id, props.onError, props.onUpdate]);
  if (props.scan === null)
    return (
      <Window title={t.windowTitle}>
        <EmptyState
          title={t.noScanTitle}
          description={t.noScanBody}
          action={
            <Button variant="primary" onClick={props.onReports}>
              {t.noScanAction}
            </Button>
          }
        />
      </Window>
    );
  const scan = props.scan;
  const progress =
    scan.progress.totalModules === 0
      ? 0
      : (scan.progress.completedModules / scan.progress.totalModules) * 100;
  const terminal = isTerminalScanStatus(scan.status);
  const finishedAt = formatTimestamp(scan.completedAt, props.language);
  const paused = scan.status === 'Paused';
  const pausing = !paused && scan.pauseRequestedAt != null && !terminal;
  const cancel = async () => {
    setCancelBusy(true);
    try {
      props.onUpdate(await apiRequest<Scan>(`/scans/${scan.id}/cancel`, { method: 'POST' }));
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Cancel failed');
    } finally {
      setCancelBusy(false);
    }
  };
  /**
   * Stops the run, or starts it again — on the same scan.
   *
   * Neither call creates anything: a pause parks the work that has already been
   * paid for and a resume picks it up where the last one stopped, so the button
   * pair is deliberately separate from Cancel, which ends the run for good. The
   * response is not the scan, so the screen re-reads it rather than guessing
   * what the new state is.
   */
  const setPaused = async (next: 'pause' | 'resume') => {
    setPauseBusy(true);
    try {
      await apiRequest(`/scans/${scan.id}/${next}`, { method: 'POST' });
      props.onUpdate(await apiRequest<Scan>(`/scans/${scan.id}`));
    } catch (caught) {
      props.onError(
        caught instanceof Error
          ? caught.message
          : next === 'pause'
            ? 'Pause failed'
            : 'Resume failed',
      );
    } finally {
      setPauseBusy(false);
    }
  };
  return (
    <Window title={`${t.windowTitle} · ${planName(scan.plan)}`}>
      <Panel title={t.panelTitle}>
        <p className="muted">{fillCopy(t.reviewing, { domain: displayDomain(scan.domain) })}</p>
        {/* A finished scan's bar is a measurement, not a running one: the
            zebra texture at 100% beside a "Your report is ready" line was the
            last thing on this screen still claiming work was in flight. Same
            geometry, no motion — see `.progress--result`. */}
        <ProgressBar
          value={progress}
          label={t.progressLabel}
          variant={terminal ? 'result' : 'live'}
        />
        {terminal ? (
          <div className="scan-complete" role="status" aria-live="polite">
            <StatusChip status={scan.status} label={scanStateLabel(scan.status, props.language)} />
            <div>
              <strong>{scanOutcomeLabel(scan.status, props.language)}</strong>
              <p className="muted">
                {finishedAt === null
                  ? t.finishedUnknown
                  : fillCopy(t.finishedAt, { time: finishedAt })}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="muted">
              {/* Before the sections are planned there is nothing to count, and
                  "0 of 0 audit sections done" read like a scan with no work. */}
              {paused
                ? t.pausedBody
                : scan.progress.totalModules === 0
                  ? t.runningPreparing
                  : fillCopy(t.running, {
                      done: scan.progress.completedModules,
                      total: scan.progress.totalModules,
                    })}
            </p>
            {/* The sections above say which parts of the audit are done; this
                says how much of the site has actually been read, which is the
                number that moves on a large crawl. */}
            {(scan.progress.scannedUrls ?? 0) > 0 ? (
              <p className="muted">
                {fillCopy(t.scannedUrls, {
                  scanned: scan.progress.scannedUrls ?? 0,
                  discovered: Math.max(
                    scan.progress.discoveredUrls ?? 0,
                    scan.progress.scannedUrls ?? 0,
                  ),
                })}
              </p>
            ) : null}
            {pausing ? <p className="muted">{t.pausing}</p> : null}
          </>
        )}
      </Panel>
      <Panel title={t.sectionsTitle}>
        {scan.modules.length === 0 ? (
          <p className="muted">{t.sectionsPreparing}</p>
        ) : (
          <div aria-label={t.sectionsLabel}>
            {scan.modules.map((module) => (
              <FieldRow
                key={module.module}
                label={module.module}
                value={
                  <>
                    {sectionStatusLabel(module.status, props.language)}
                    <SectionReasons module={module} language={props.language} />
                  </>
                }
              />
            ))}
          </div>
        )}
      </Panel>
      <div className="button-row">
        {terminal ? (
          <Button onClick={props.onDone} variant="primary">
            {t.openReport}
          </Button>
        ) : (
          <>
            {/* Pause before Cancel, and visually quieter: one of them can be
                undone and the other cannot. */}
            <Button
              onClick={() => void setPaused(paused ? 'resume' : 'pause')}
              variant={paused ? 'primary' : undefined}
              disabled={pauseBusy || pausing}
            >
              {pauseBusy ? t.pauseWorking : paused ? t.resume : t.pause}
            </Button>
            <Button onClick={() => void cancel()} variant="danger" disabled={cancelBusy}>
              {cancelBusy ? t.cancelling : t.cancel}
            </Button>
          </>
        )}
        <Button onClick={props.onReports}>{copy[props.language].reports.windowTitle}</Button>
      </div>
    </Window>
  );
}

/**
 * Why one section ended where it did, right after the status word it explains.
 *
 * The status word alone answered "Unavailable" for a Performance section with
 * no measurement service configured and for one whose provider had just gone
 * down — two different things to do about it, spelled the same way. Nothing is
 * rendered for a section that simply finished.
 */
function SectionReasons({ module, language }: { module: ScanModule; language: Language }) {
  const reasons = moduleStatusReasons(module, language);
  if (reasons.length === 0) return null;
  return <span className="section-status__reason"> — {reasons.join(' ')}</span>;
}
