// The storefront the Store Builder Library is initialised with.
//
// FastSpring's popup checkout is loaded by the SBL script, whose `data-storefront`
// attribute is "the full URL to your FastSpring checkout" as `{host}/{checkout}`
// — exactly the value the FastSpring app prints in **Checkouts → Popup Checkouts
// → Place on your Website** (developer.fastspring.com — Store Builder Overview).
// The browser receives this value from `/billing/checkout-config`; it is public
// by nature (every site that sells through FastSpring ships it in a script tag),
// but it decides which origin the buyer's card details are typed into, so it is
// validated here rather than trusted as typed into an environment file.

/** Every FastSpring-hosted storefront lives under this domain. */
const STOREFRONT_DOMAIN_SUFFIX = '.onfastspring.com';

/**
 * The label FastSpring inserts between the store name and the domain for the
 * test environment: `mystore.test.onfastspring.com`
 * (developer.fastspring.com — Add checkout to your site, "Preview and test").
 */
const TEST_HOST_LABEL = 'test';

export type PopupStorefrontResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/**
 * Validates one `data-storefront` value against the mode it will be used in.
 *
 * Two failures matter and neither is visible at a glance in an environment file:
 *
 *   * a host that is not a FastSpring storefront — the SBL would be pointed at a
 *     foreign origin, and our own Content-Security-Policy only allows
 *     `*.onfastspring.com` anyway, so this fails at boot instead of as a blank
 *     popup in front of a buyer;
 *   * a storefront from the *other* mode. A session created with `live: false`
 *     cannot be paid on the live storefront and vice versa, so a mode and a
 *     storefront that disagree produce a checkout that can never complete. The
 *     `.test.` label is the only thing that distinguishes the two hosts.
 *
 * @param raw       the value as configured, e.g. `mystore.test.onfastspring.com/popup`
 * @param liveMode  whether FASTSPRING_MODE is `live`
 */
export function readPopupStorefront(raw: string, liveMode: boolean): PopupStorefrontResult {
  if (/\s/.test(raw)) {
    return { ok: false, reason: 'must not contain whitespace' };
  }
  if (raw.includes('://')) {
    return {
      ok: false,
      reason:
        'must be the bare "{store}.onfastspring.com/{checkout}" value FastSpring prints in the ' +
        'popup checkout snippet, with no https:// prefix',
    };
  }
  if (raw.includes('?') || raw.includes('#') || raw.includes('@')) {
    return {
      ok: false,
      reason: 'must be a host and checkout path only, with no query, fragment or credentials',
    };
  }

  const separator = raw.indexOf('/');
  if (separator === -1) {
    return {
      ok: false,
      reason:
        'must name a checkout as "{store}.onfastspring.com/{checkout}", not the store host alone',
    };
  }
  const host = raw.slice(0, separator).toLowerCase();
  const checkout = raw.slice(separator + 1);

  if (!isStorefrontHost(host)) {
    return {
      ok: false,
      reason: `host must be a FastSpring storefront ending in ${STOREFRONT_DOMAIN_SUFFIX}`,
    };
  }
  if (!isUsableCheckoutSegments(checkout)) {
    return {
      ok: false,
      reason: 'checkout path must have no leading, trailing or doubled slash',
    };
  }

  const testHost = isTestHost(host);
  if (liveMode && testHost) {
    return { ok: false, reason: 'names the test storefront while FASTSPRING_MODE=live' };
  }
  if (!liveMode && !testHost) {
    return {
      ok: false,
      reason:
        `names the live storefront while FASTSPRING_MODE=test; insert ".${TEST_HOST_LABEL}." ` +
        'between the store name and onfastspring.com',
    };
  }

  return { ok: true, value: `${host}/${checkout}` };
}

/** A hostname under FastSpring's storefront domain, with no port. */
function isStorefrontHost(host: string): boolean {
  if (host.includes(':') || !host.endsWith(STOREFRONT_DOMAIN_SUFFIX)) {
    return false;
  }
  const labels = host.split('.');
  return (
    labels.length > 2 && labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label))
  );
}

/** Every segment is a real URL path segment — no empty one anywhere. */
function isUsableCheckoutSegments(checkout: string): boolean {
  return checkout !== '' && checkout.split('/').every((segment) => segment !== '');
}

/** `mystore.test.onfastspring.com` — the test twin of `mystore.onfastspring.com`. */
function isTestHost(host: string): boolean {
  return host.split('.').includes(TEST_HOST_LABEL);
}
