import { describe, expect, it } from 'vitest';

import { SCAN_RUNTIME_STATUSES } from './enums.js';
import { SCAN_TRANSITIONS, canTransition, isTerminalScanStatus } from './statuses.js';

describe('scan state machine §18', () => {
  it('covers every runtime status in the transition map', () => {
    expect(Object.keys(SCAN_TRANSITIONS).sort()).toEqual([...SCAN_RUNTIME_STATUSES].sort());
  });

  it('allows the §18 transitions', () => {
    expect(canTransition('Pending', 'Queued')).toBe(true);
    expect(canTransition('Pending', 'Cancelled')).toBe(true);
    expect(canTransition('Queued', 'Running')).toBe(true);
    expect(canTransition('Queued', 'Cancelled')).toBe(true);
    expect(canTransition('Running', 'Completed')).toBe(true);
    expect(canTransition('Running', 'Partial')).toBe(true);
    expect(canTransition('Running', 'Failed')).toBe(true);
    expect(canTransition('Running', 'Cancelled')).toBe(true);
    expect(canTransition('Partial', 'Running')).toBe(true);
    expect(canTransition('Failed', 'Queued')).toBe(true);
  });

  it('rejects forbidden transitions', () => {
    expect(canTransition('Pending', 'Running')).toBe(false);
    expect(canTransition('Queued', 'Completed')).toBe(false);
    expect(canTransition('Running', 'Queued')).toBe(false);
    expect(canTransition('Partial', 'Queued')).toBe(false);
    expect(canTransition('Partial', 'Completed')).toBe(false);
    expect(canTransition('Failed', 'Running')).toBe(false);
    expect(canTransition('Completed', 'Running')).toBe(false);
    expect(canTransition('Completed', 'Queued')).toBe(false);
    expect(canTransition('Cancelled', 'Queued')).toBe(false);
    expect(canTransition('Cancelled', 'Running')).toBe(false);
  });

  it('treats only Completed and Cancelled as fully terminal', () => {
    expect(isTerminalScanStatus('Completed')).toBe(true);
    expect(isTerminalScanStatus('Cancelled')).toBe(true);
    // Partial and Failed are exportable snapshots but still allow one retry each.
    expect(isTerminalScanStatus('Partial')).toBe(false);
    expect(isTerminalScanStatus('Failed')).toBe(false);
    expect(isTerminalScanStatus('Pending')).toBe(false);
    expect(isTerminalScanStatus('Queued')).toBe(false);
    expect(isTerminalScanStatus('Running')).toBe(false);
  });
});
