import { afterEach, describe, expect, it } from 'vitest';

import { readPendingCheckout, storePendingCheckout } from './checkout-storage';

// The pending-checkout slot in local storage.
//
// Everything read back is untrusted: the slot is shared with the whole origin
// and survives across sessions. A record that does not hold together is
// dropped, never repaired.

const STORAGE_KEY = 'fluxradar.pendingCheckout';

const stored = {
  accountId: 'account-1',
  reference: 'frcs_abc',
  checkoutUrl: 'https://checkout.example/session/sess_abc',
};

function write(record: Record<string, unknown>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

afterEach(() => {
  window.localStorage.clear();
});

describe('readPendingCheckout', () => {
  it('reads back a stored record, marked as restored', () => {
    write(stored);
    expect(readPendingCheckout('account-1')).toEqual({ ...stored, restored: true });
  });

  it('accepts a checkout with no page to offer', () => {
    write({ ...stored, checkoutUrl: null });
    expect(readPendingCheckout('account-1')).toMatchObject({ checkoutUrl: null });
  });

  it('drops a record that belongs to a different account', () => {
    write({ ...stored, accountId: 'someone-else' });
    expect(readPendingCheckout('account-1')).toBeNull();
  });

  it.each([
    ['a checkout URL that is not http(s)', { checkoutUrl: 'javascript:alert(1)' }],
    ['a missing checkout URL', { checkoutUrl: undefined }],
    ['a reference that is not a string', { reference: 42 }],
  ])('drops a record with %s', (_case, tampered) => {
    write({ ...stored, ...tampered });
    expect(readPendingCheckout('account-1')).toBeNull();
  });

  it('reads back what was stored, marked as restored', () => {
    storePendingCheckout({ ...stored, restored: false, returned: true });
    expect(readPendingCheckout('account-1')).toEqual({ ...stored, restored: true });
  });

  // Regression: a record written by a previous release still sits in some
  // buyers' local storage. Its extra fields must be tolerated, not required —
  // readPendingCheckout reads only accountId, reference and checkoutUrl.
  it.each([
    [
      'the popup-flow fields (sessionId, storefront, flow, popupBlocked)',
      {
        ...stored,
        sessionId: 'sess_abc',
        storefront: 'https://fluxradar.test.onfastspring.com',
        flow: 'popup',
        popupBlocked: true,
      },
    ],
    ['the tab-flow field', { ...stored, sessionId: 'sess_abc', flow: 'tab' }],
    ['no flow name at all, from before flows existed', { ...stored }],
  ])('reads a legacy record carrying %s', (_case, legacy) => {
    write(legacy);
    expect(readPendingCheckout('account-1')).toEqual({ ...stored, restored: true });
  });
});
