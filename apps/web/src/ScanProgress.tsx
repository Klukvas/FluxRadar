// The progress window of a running scan, and the state it ends in.
//
// It polls the scan rather than the queue, and speaks in audit sections rather
// than modules: the owner watching it wants to know whether their report is
// coming, not what the worker is doing.

import { useEffect, useRef, useState } from 'react';

import { apiRequest, type Scan, type ScanModule } from './api';
import { Button, EmptyState, FieldRow, Panel, ProgressBar, StatusChip, Window } from './components';
import { copy, fillCopy, type Language } from './i18n';
import { moduleStatusReasons } from './module-status';
import { planName } from './plan-modules';
import {
  finishedProgressPercent,
  nextLiveProgress,
  type LiveProgressMark,
} from './scan-progress-state';
import { ScanProgressStatus } from './ScanProgressStatus';
import { useScanPolling } from './use-scan-polling';
import { scanCancelCopy } from './scan-cancel-copy';
import {
  displayDomain,
  formatTimestamp,
  isTerminalScanStatus,
  scanOutcomeLabel,
  scanStateLabel,
  sectionStatusLabel,
} from './scan-status';

const FOCUSABLE = 'button:not([disabled]), a[href]';

export function ScanScreen(props: {
  scan: Scan | null;
  language: Language;
  onUpdate: (scan: Scan) => void;
  onDone: () => void;
  onReports: () => void;
  onError: (value: string) => void;
}) {
  const t = copy[props.language].scanProgress;
  const cancelCopy = scanCancelCopy[props.language];
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<Scan | null>(null);
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const cancelDialog = useRef<HTMLElement>(null);
  const liveMark = useRef<LiveProgressMark | null>(null);
  useEffect(() => {
    if (confirmCancel === null) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConfirmCancel(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = cancelDialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    const frame = window.requestAnimationFrame(() =>
      cancelDialog.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      (cancelTrigger.current ?? previousFocus)?.focus();
    };
  }, [confirmCancel]);
  const { connectionLost } = useScanPolling({
    scan: props.scan,
    onUpdate: props.onUpdate,
    onError: props.onError,
  });
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
  const terminal = isTerminalScanStatus(scan.status);
  const reportFinalizing = terminal && scan.reportReady === false;
  const settled = terminal && !reportFinalizing;
  // A live bar only moves forward within one attempt (`nextLiveProgress`); a
  // finished scan's bar is its measurement instead and is shown as it is.
  const live = nextLiveProgress(liveMark.current, scan);
  liveMark.current = live.mark;
  const progress = settled ? finishedProgressPercent(scan) : live.shown;
  const finishedAt = formatTimestamp(scan.completedAt, props.language);
  const cancel = async () => {
    setCancelBusy(true);
    try {
      // The state can change between opening this dialog and confirming it.
      // Re-read before cancellation so the refund wording is never stale.
      const current = await apiRequest<Scan>(`/scans/${scan.id}`);
      if (isTerminalScanStatus(current.status)) {
        props.onUpdate(current);
        setConfirmCancel(null);
        return;
      }
      if (
        confirmCancel !== null &&
        cancellationRefundCategory(current) !== cancellationRefundCategory(confirmCancel)
      ) {
        props.onUpdate(current);
        setConfirmCancel(current);
        return;
      }
      await apiRequest<{
        scanId: string;
        status: string;
        cancelledFrom: string;
        refundId: string | null;
      }>(`/scans/${scan.id}/cancel`, { method: 'POST' });
      props.onUpdate(await apiRequest<Scan>(`/scans/${scan.id}`));
      setConfirmCancel(null);
    } catch (caught) {
      props.onError(caught instanceof Error ? caught.message : 'Cancel failed');
    } finally {
      setCancelBusy(false);
    }
  };
  return (
    <Window
      title={`${t.windowTitle} · ${planName(scan.plan, props.language)}`}
      showInertClose={false}
    >
      <Panel title={t.panelTitle}>
        <p className="muted">{fillCopy(t.reviewing, { domain: displayDomain(scan.domain) })}</p>
        {/* A finished scan's bar is a measurement, not a running one: the
            zebra texture at 100% beside a "Your report is ready" line was the
            last thing on this screen still claiming work was in flight. Same
            geometry, no motion — see `.progress--result`. */}
        <ProgressBar
          value={progress}
          label={t.progressLabel}
          variant={settled ? 'result' : 'live'}
        />
        {connectionLost && !settled ? (
          <p className="muted" role="status">
            {t.connectionLost}
          </p>
        ) : null}
        {settled ? (
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
        ) : reportFinalizing ? (
          <p role="status">{t.finalizing}</p>
        ) : (
          <ScanProgressStatus scan={scan} language={props.language} now={Date.now()} />
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
                  <span
                    className={
                      module.status === 'Running'
                        ? 'section-status section-status--running'
                        : module.status === 'Completed'
                          ? 'section-status section-status--done'
                          : 'section-status'
                    }
                  >
                    {sectionStatusLabel(module.status, props.language)}
                    <SectionReasons module={module} language={props.language} />
                  </span>
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
            <details className="scan-secondary-actions">
              <summary className="button">{cancelCopy.moreActions}</summary>
              <button
                ref={cancelTrigger}
                className="button button--default"
                type="button"
                onClick={() => setConfirmCancel(scan)}
                disabled={cancelBusy}
              >
                {t.cancel}
              </button>
            </details>
          </>
        )}
        <Button onClick={props.onReports}>{copy[props.language].reports.windowTitle}</Button>
      </div>
      {confirmCancel !== null ? (
        <div className="modal-backdrop">
          <section
            ref={cancelDialog}
            className="window window--dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-scan-title"
          >
            <div className="window__content stack">
              <h2 id="cancel-scan-title" className="section-heading">
                {cancelCopy.title}
              </h2>
              <p>
                {confirmCancel.plan === 'Free'
                  ? cancelCopy.unpaid
                  : cancellationRefundCategory(confirmCancel) === 'pre-queue'
                    ? cancelCopy.beforeQueue
                    : cancelCopy.afterQueue}
              </p>
              <div className="button-row">
                <Button onClick={() => setConfirmCancel(null)} disabled={cancelBusy}>
                  {cancelCopy.keep}
                </Button>
                <Button onClick={() => void cancel()} variant="danger" disabled={cancelBusy}>
                  {cancelBusy ? t.cancelling : t.cancel}
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </Window>
  );
}

/** Only a scan that never entered the queue is cancelled under the pre-queue policy. */
function cancellationRefundCategory(scan: Scan): 'pre-queue' | 'after-queue' {
  return scan.status === 'Pending' ? 'pre-queue' : 'after-queue';
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
