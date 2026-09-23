// The transition table, tested as the safety property it is rather than as a
// table. Each case below is a way a refund could be sent twice, or a way a
// settlement nobody observed could be invented.

import { describe, expect, it } from 'vitest';

import {
  DISPATCHABLE_STATES,
  OPERATOR_STATES,
  REFUND_DISPATCH_STATES,
  canTransition,
  refundDispatchKey,
} from './states.ts';

describe('the refund dispatch state machine', () => {
  it('lets the dispatcher pick up exactly one state', () => {
    expect(DISPATCHABLE_STATES).toEqual([REFUND_DISPATCH_STATES.requested]);
  });

  it('never allows an automatic move back into the dispatchable state', () => {
    // `uncertain` is the state of a submission whose answer never arrived. Moving
    // it back to `requested` would send a second refund for the same purchase,
    // with no idempotency key at the provider to stop it.
    expect(canTransition(REFUND_DISPATCH_STATES.uncertain, REFUND_DISPATCH_STATES.requested)).toBe(
      false,
    );
    expect(canTransition(REFUND_DISPATCH_STATES.submitting, REFUND_DISPATCH_STATES.requested)).toBe(
      false,
    );
    expect(canTransition(REFUND_DISPATCH_STATES.submitted, REFUND_DISPATCH_STATES.requested)).toBe(
      false,
    );
  });

  it('allows a refusal to be re-queued, because no money moved', () => {
    expect(canTransition(REFUND_DISPATCH_STATES.failed, REFUND_DISPATCH_STATES.requested)).toBe(
      true,
    );
  });

  it('treats settled as terminal', () => {
    for (const state of Object.values(REFUND_DISPATCH_STATES)) {
      expect(canTransition(REFUND_DISPATCH_STATES.settled, state)).toBe(false);
    }
  });

  it('can reach settled from every non-terminal state, because the provider decides', () => {
    for (const state of Object.values(REFUND_DISPATCH_STATES)) {
      if (state === REFUND_DISPATCH_STATES.settled) continue;
      expect(canTransition(state, REFUND_DISPATCH_STATES.settled)).toBe(true);
    }
  });

  it('names every state that needs a person', () => {
    expect([...OPERATOR_STATES].sort()).toEqual(['failed', 'manual', 'submitting', 'uncertain']);
  });

  it('keys a dispatch by its purchase, so one purchase can only have one', () => {
    expect(refundDispatchKey('purchase-1')).toBe('refund-dispatch:purchase-1');
  });
});
