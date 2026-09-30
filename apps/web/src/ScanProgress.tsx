// The progress window of a running scan, and the state it ends in.
//
// It polls the scan rather than the queue, and speaks in audit sections rather
// than modules: the owner watching it wants to know whether their report is
// coming, not what the worker is doing.

import { useEffect, useRef, useState } from 'react';

import { trackEvent } from './analytics';
import { apiRequest, type Scan, type ScanModule } from './api';
import { Button, EmptyState, FieldRow, Panel, ProgressBar, StatusChip, Window } from './components';
import { copy, fillCopy, type Language } from './i18n';
import { moduleStatusReasons } from './module-status';
import { PLAN_URL_LIMIT, planName } from './plan-modules';
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
  const [cancelBusy, setCancelBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<Scan | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const cancelTrigger = useRef<HTMLButtonElement>(null);
  const cancelDialog = useRef<HTMLElement>(null);
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
  useEffect(() => {
    if (
      props.scan === null ||
      (isTerminalScanStatus(props.scan.status) && props.scan.reportReady !== false)
    )
      return undefined;
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
        if (
          isTerminalScanStatus(scan.status) &&
          scan.reportReady !== false &&
          timer !== undefined
        ) {
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
  const reportFinalizing = terminal && scan.reportReady === false;
  const finishedAt = formatTimestamp(scan.completedAt, props.language);
  const paused = scan.status === 'Paused';
  const pausing = !paused && scan.pauseRequestedAt != null && !terminal;
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
    <Window title={`${t.windowTitle} · ${planName(scan.plan)}`} showInertClose={false}>
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
        {terminal && !reportFinalizing ? (
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
          <p role="status">
            {props.language === 'uk' ? 'Фіналізуємо звіт…' : 'Finalizing report…'}
          </p>
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
            <p className="muted">
              {props.language === 'uk'
                ? `Обсяг: до ${(scan.scope.maxPages ?? PLAN_URL_LIMIT[scan.plan]).toLocaleString()} сторінок. Після завершення розділів звіт буде фіналізовано.`
                : `Scope: up to ${(scan.scope.maxPages ?? PLAN_URL_LIMIT[scan.plan]).toLocaleString()} pages. Your report is finalized after the sections finish.`}
            </p>
            <p className="muted">
              {props.language === 'uk'
                ? 'Можна закрити цю сторінку — перевірка продовжиться.'
                : 'You can close this page; the scan continues.'}
            </p>
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
            {/* Pause before Cancel, and visually quieter: one of them can be
                undone and the other cannot. */}
            <Button
              onClick={() => void setPaused(paused ? 'resume' : 'pause')}
              variant={paused ? 'primary' : undefined}
              disabled={pauseBusy || pausing}
            >
              {pauseBusy ? t.pauseWorking : paused ? t.resume : t.pause}
            </Button>
            <details className="scan-secondary-actions">
              <summary className="button">
                {props.language === 'uk' ? 'Інші дії' : 'More actions'}
              </summary>
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
                {props.language === 'uk' ? 'Скасувати перевірку?' : 'Cancel this scan?'}
              </h2>
              <p>
                {confirmCancel.plan === 'Free'
                  ? props.language === 'uk'
                    ? 'Це неоплачена перевірка: списання не було. Перед скасуванням ми ще раз перевіримо її стан.'
                    : 'This is an unpaid check, so nothing was charged. We will check its state again before cancelling.'
                  : cancellationRefundCategory(confirmCancel) === 'pre-queue'
                    ? props.language === 'uk'
                      ? 'Цю перевірку ще не поставлено в чергу. Якщо її оплачено, скасування до старту має повне повернення. Перед дією ми ще раз перевіримо стан.'
                      : 'This scan has not entered the queue. If it was paid for, cancelling before it starts receives a full refund. We will check its state again before acting.'
                    : props.language === 'uk'
                      ? 'Цю перевірку вже поставлено в чергу або запущено: автоматичне повернення не передбачене. Перед дією ми ще раз перевіримо її стан.'
                      : 'This scan has entered the queue or started: no automatic refund is available. We will check its state again before acting.'}
              </p>
              <div className="button-row">
                <Button onClick={() => setConfirmCancel(null)} disabled={cancelBusy}>
                  {props.language === 'uk' ? 'Продовжити перевірку' : 'Keep scan'}
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

/** The cancellation policy follows the state a paused scan was paused from. */
function cancellationRefundCategory(scan: Scan): 'pre-queue' | 'after-queue' {
  return scan.status === 'Pending' || scan.statusReason === 'UserPausedBeforeQueue'
    ? 'pre-queue'
    : 'after-queue';
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
