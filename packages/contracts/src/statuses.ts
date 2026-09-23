import type { ScanRuntimeStatus } from './enums.js';

/**
 * Scan state machine §18. Partial → Running is the single free retry of a failing
 * module; Failed → Queued is the single platform retry. Refunded/Disputed are
 * billing overlays, not scan states, and are tracked on the purchase.
 */
export const SCAN_TRANSITIONS: Readonly<Record<ScanRuntimeStatus, readonly ScanRuntimeStatus[]>> = {
  Pending: ['Queued', 'Paused', 'Cancelled'],
  Queued: ['Running', 'Paused', 'Cancelled'],
  Running: ['Completed', 'Partial', 'Failed', 'Paused', 'Cancelled'],
  // Resume re-enters the queue rather than jumping straight back to Running:
  // the same job is claimed again, so the run that was paid for continues
  // instead of a second one being created.
  Paused: ['Queued', 'Cancelled'],
  Partial: ['Running'],
  Failed: ['Queued'],
  Completed: [],
  Cancelled: [],
};

/**
 * Statuses a user may pause from. Pausing stops new outbound work; it neither
 * settles the scan nor spends anything, so it is not a result state.
 */
export const PAUSABLE_SCAN_STATUSES: readonly ScanRuntimeStatus[] = [
  'Pending',
  'Queued',
  'Running',
];

export const canTransition = (from: ScanRuntimeStatus, to: ScanRuntimeStatus): boolean =>
  SCAN_TRANSITIONS[from].includes(to);

/**
 * No outgoing scan transitions at all. Partial and Failed are exportable terminal
 * snapshots too, but each still allows exactly one retry transition.
 */
export const isTerminalScanStatus = (status: ScanRuntimeStatus): boolean =>
  SCAN_TRANSITIONS[status].length === 0;
