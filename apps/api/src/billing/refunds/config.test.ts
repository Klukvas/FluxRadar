// The activation gate for outbound refunds. Every case here is "does this
// configuration move money?", and the answer is no for all but one of them.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REFUND_DISPATCH_MODE,
  REFUND_DISPATCH_ACK_ENV,
  REFUND_DISPATCH_ENV,
  readRefundDispatchConfig,
  submitsRefundsTo,
} from './config.ts';

describe('readRefundDispatchConfig', () => {
  it('is inactive, on the manual policy, when nothing is configured', () => {
    expect(readRefundDispatchConfig({})).toEqual({
      state: 'inactive',
      mode: DEFAULT_REFUND_DISPATCH_MODE,
    });
    expect(DEFAULT_REFUND_DISPATCH_MODE).toBe('manual');
  });

  it.each(['off', 'manual'])('is inactive for mode %s', (mode) => {
    expect(readRefundDispatchConfig({ [REFUND_DISPATCH_ENV]: mode }).state).toBe('inactive');
  });

  it('refuses auto without the acknowledgement naming the provider', () => {
    const config = readRefundDispatchConfig({ [REFUND_DISPATCH_ENV]: 'auto' });
    expect(config.state).toBe('invalid');
    expect(config.state === 'invalid' && config.reason).toContain(REFUND_DISPATCH_ACK_ENV);
  });

  it('is active only for auto plus the acknowledgement', () => {
    expect(
      readRefundDispatchConfig({
        [REFUND_DISPATCH_ENV]: 'auto',
        [REFUND_DISPATCH_ACK_ENV]: 'fastspring',
      }),
    ).toEqual({ state: 'active', mode: 'auto', provider: 'fastspring' });
  });

  it.each(['Auto', 'on', 'true', '1', 'yes'])(
    'refuses %p rather than reading it as either on or off',
    (value) => {
      expect(readRefundDispatchConfig({ [REFUND_DISPATCH_ENV]: value }).state).toBe('invalid');
    },
  );

  it('only submits to the provider the acknowledgement names', () => {
    const env = { [REFUND_DISPATCH_ENV]: 'auto', [REFUND_DISPATCH_ACK_ENV]: 'fastspring' };
    expect(submitsRefundsTo('fastspring', env)).toBe(true);
    expect(submitsRefundsTo('paddle', env)).toBe(false);
    expect(submitsRefundsTo('fastspring', {})).toBe(false);
  });
});
