import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckoutConfig, CheckoutSession, CheckoutStatus } from './api';
import { trackBeginCheckout, trackPurchase } from './checkout-analytics';

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('./analytics', () => ({ trackEvent }));

function config(mode: 'test' | 'live'): CheckoutConfig {
  return {
    provider: 'fastspring',
    available: true,
    mode,
    unavailableReason: null,
    popup: null,
    plans: [
      { plan: 'Basic', priceUsd: 55, currency: 'USD' },
      { plan: 'Complete', priceUsd: 120, currency: 'USD' },
    ],
  };
}

const confirmed: CheckoutStatus = {
  reference: 'ref_1',
  plan: 'Complete',
  status: 'completed',
  reasonCode: null,
  scanId: 'scan_1',
  purchaseId: 'purchase_1',
  expiresAt: null,
};

function session(mode: 'test' | 'live'): CheckoutSession {
  return {
    reference: 'ref_1',
    sessionId: 'session_1',
    checkoutUrl: 'https://example.test/checkout',
    plan: 'Basic',
    amount: 55,
    currency: 'USD',
    mode,
    expiresAt: null,
  };
}

beforeEach(() => {
  trackEvent.mockClear();
});

describe('checkout milestones sent to analytics', () => {
  it('reports a confirmed live purchase with its id, plan and price', () => {
    trackPurchase(confirmed, config('live'));

    expect(trackEvent).toHaveBeenCalledWith('purchase', {
      transaction_id: 'purchase_1',
      currency: 'USD',
      value: 120,
      items: [{ item_id: 'Complete', item_name: 'FluxRadar Complete' }],
    });
  });

  // A test-card order in GA is revenue that can never be taken out again.
  it('never reports a test-mode purchase or checkout', () => {
    trackPurchase(confirmed, config('test'));
    trackBeginCheckout(session('test'));

    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('waits for the config and for a purchase id before reporting anything', () => {
    trackPurchase(confirmed, null);
    trackPurchase({ ...confirmed, purchaseId: null }, config('live'));

    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('reports a live checkout start with the quoted amount', () => {
    trackBeginCheckout(session('live'));

    expect(trackEvent).toHaveBeenCalledWith('begin_checkout', {
      currency: 'USD',
      value: 55,
      items: [{ item_id: 'Basic', item_name: 'FluxRadar Basic' }],
    });
  });
});
