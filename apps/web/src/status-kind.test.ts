// The status ladder decides two things now — a chip's colour and a report
// card's accent edge — so the order of its rungs is behaviour, not detail.
// `Failed` has to be an error before the `high` rung can see it, and a severity
// of `High` has to be caught before `partial|warning|medium` claims it.

import { describe, expect, it } from 'vitest';

import { statusKind } from './status-kind';

describe('statusKind', () => {
  it('colours the scan statuses the reports list actually shows', () => {
    expect(statusKind('Completed')).toBe('ok');
    expect(statusKind('Partial')).toBe('warning');
    expect(statusKind('Failed')).toBe('error');
    expect(statusKind('Running')).toBe('info');
    expect(statusKind('Queued')).toBe('info');
    // Cancelled is not a failure and not a result: the design system has no
    // colour for it, and the neutral edge is the honest answer.
    expect(statusKind('Cancelled')).toBe('neutral');
    expect(statusKind('Pending')).toBe('neutral');
  });

  it('reads a severity as its own step between error and warning', () => {
    expect(statusKind('Critical')).toBe('error');
    expect(statusKind('High')).toBe('high');
    expect(statusKind('Medium')).toBe('warning');
    expect(statusKind('Low')).toBe('ok');
  });

  it('keeps the score verdicts the report dashboard hands it', () => {
    expect(statusKind('Provisional')).toBe('warning');
    expect(statusKind('Insufficient data')).toBe('neutral');
    expect(statusKind('Unavailable')).toBe('neutral');
  });

  it('matches the API vocabulary whatever case it arrives in', () => {
    expect(statusKind('completed')).toBe('ok');
    expect(statusKind('FAILED')).toBe('error');
  });

  it('never leaves a status without a colour family', () => {
    expect(statusKind('')).toBe('neutral');
    expect(statusKind('something-new-from-the-api')).toBe('neutral');
  });
});
