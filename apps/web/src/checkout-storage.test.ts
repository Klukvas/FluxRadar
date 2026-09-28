import { afterEach, describe, expect, it } from 'vitest';

import { readPendingCheckout, storePendingCheckout } from './checkout-storage';

// The pending-checkout slot in local storage.
//
// Everything read back is untrusted: the slot is shared with the whole origin
// and survives across sessions. A record written by an older bundle is read on
// its old terms; a record that does not hold together is dropped, never repaired.

const STORAGE_KEY = 'fluxradar.pendingCheckout';
const STOREFRONT = 'fluxradar.test.onfastspring.com/popup-checkout';

const stored = {
  accountId: 'account-1',
  reference: 'frcs_abc',
  sessionId: 'sess_abc',
  checkoutUrl: 'https://checkout.example/session/sess_abc',
  popupBlocked: false,
};

function write(record: Record<string, unknown>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

afterEach(() => {
  window.localStorage.clear();
});

describe('readPendingCheckout', () => {
  it('reads a record written before flows had a name as the FastSpring flow it was', () => {
    write(stored);
    expect(readPendingCheckout('account-1')).toMatchObject({ flow: 'tab', storefront: null });

    write({ ...stored, storefront: STOREFRONT });
    expect(readPendingCheckout('account-1')).toMatchObject({
      flow: 'popup',
      storefront: STOREFRONT,
    });
  });

  it('keeps the flow a record names', () => {
    write({ ...stored, flow: 'redirect', storefront: null });
    expect(readPendingCheckout('account-1')).toMatchObject({
      flow: 'redirect',
      // Whatever was written: a restored checkout only offers to reopen.
      restored: true,
    });
  });

  it('accepts a checkout with no page to offer', () => {
    write({ ...stored, checkoutUrl: null, flow: 'redirect', sessionId: '' });
    expect(readPendingCheckout('account-1')).toMatchObject({ checkoutUrl: null, sessionId: '' });
  });

  it('drops a record that belongs to a different account', () => {
    write({ ...stored, accountId: 'someone-else' });
    expect(readPendingCheckout('account-1')).toBeNull();
  });

  it.each([
    ['a flow it does not know', { flow: 'iframe' }],
    ['a checkout URL that is not http(s)', { checkoutUrl: 'javascript:alert(1)' }],
    ['a missing checkout URL', { checkoutUrl: undefined }],
    ['a storefront that is not FastSpring', { storefront: 'https://evil.example/popup' }],
    ['a reference that is not a string', { reference: 42 }],
  ])('drops a record with %s', (_case, tampered) => {
    write({ ...stored, ...tampered });
    expect(readPendingCheckout('account-1')).toBeNull();
  });

  it('reads back what was stored, marked as restored', () => {
    storePendingCheckout({
      ...stored,
      storefront: null,
      flow: 'redirect',
      restored: false,
      returned: true,
    });
    expect(readPendingCheckout('account-1')).toEqual({
      ...stored,
      storefront: null,
      flow: 'redirect',
      restored: true,
    });
  });
});
