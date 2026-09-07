// The progress window of a running scan, and the state it ends in.
//
// It polls the scan rather than the queue, and speaks in audit sections rather
// than modules: the owner watching it wants to know whether their report is
// coming, not what the worker is doing.

import { useEffect, useState } from 'react';

import { apiRequest, type Scan } from './api';
import { Button, EmptyState, FieldRow, Panel, ProgressBar, StatusChip, Window } from './components';
import { copy, fillCopy, type Language } from './i18n';
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
  useEffect(() => {
    if (props.scan === null || isTerminalScanStatus(props.scan.status)) return undefined;
    let cancelled = false;
    const scanId = props.scan.id;
    const poll = async () => {
      try {
        const scan = await apiRequest<Scan>(`/scans/${scanId}`);
        if (cancelled) return;
        props.onUpdate(scan);
        if (isTerminalScanStatus(scan.status) && timer !== undefined) {
          window.clearInterval(timer);
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
  return (
    <Window title={`${t.windowTitle} · ${scan.plan}`}>
      <Panel title={t.panelTitle}>
        <p className="muted">{fillCopy(t.reviewing, { domain: displayDomain(scan.domain) })}</p>
        <ProgressBar value={progress} label={t.progressLabel} />
        {terminal ? (
          <div className="scan-complete" role="status" aria-live="polite">
            <StatusChip
              status={scan.status}
              label={scanStateLabel(scan.status, props.language)}
            />
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
          <p className="muted">
            {fillCopy(t.running, {
              done: scan.progress.completedModules,
              total: scan.progress.totalModules,
            })}
          </p>
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
                value={sectionStatusLabel(module.status, props.language)}
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
          <Button onClick={() => void cancel()} variant="danger" disabled={cancelBusy}>
            {cancelBusy ? t.cancelling : t.cancel}
          </Button>
        )}
        <Button onClick={props.onReports}>{copy[props.language].reports.windowTitle}</Button>
      </div>
    </Window>
  );
}
