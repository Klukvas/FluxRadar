import type { ScanRuntimeStatus } from './enums.js';

/**
 * Scan state machine §18. Partial → Running is the single free retry of a failing
 * module; Failed → Queued is the single platform retry. Refunded/Disputed are
 * billing overlays, not scan states, and are tracked on the purchase.
 */
export const SCAN_TRANSITIONS: Readonly<Record<ScanRuntimeStatus, readonly ScanRuntimeStatus[]>> = {
  Pending: ['Queued', 'Cancelled'],
  Queued: ['Running', 'Cancelled'],
  Running: ['Completed', 'Partial', 'Failed', 'Cancelled'],
  // Nothing enters Paused any more: the pause feature was removed. A legacy
  // paused row only leaves it — back to the queue on its own job (the automatic
  // resume sweep), or to Cancelled. Kept until no Paused rows remain; removed
  // with the schema in a follow-up.
  Paused: ['Queued', 'Cancelled'],
  Partial: ['Running'],
  Failed: ['Queued'],
  Completed: [],
  Cancelled: [],
};

export const canTransition = (from: ScanRuntimeStatus, to: ScanRuntimeStatus): boolean =>
  SCAN_TRANSITIONS[from].includes(to);

/**
 * No outgoing scan transitions at all. Partial and Failed are exportable terminal
 * snapshots too, but each still allows exactly one retry transition.
 */
export const isTerminalScanStatus = (status: ScanRuntimeStatus): boolean =>
  SCAN_TRANSITIONS[status].length === 0;
