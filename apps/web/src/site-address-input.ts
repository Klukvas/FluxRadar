// Turns the natural site address a non-technical owner types
// ("mysite.com", "www.mysite.com", "https://mysite.com/about?ref=1") into the
// strict HTTPS origin a profile stores. The server still re-validates the origin
// (defense in depth); this client step exists so people never have to think in
// terms of "HTTPS origins" and never see backend validation jargon.
//
// Rejection carries no message: every failure reads the same to the owner ("that
// is not a site address"), and that one sentence is localized, so it lives in
// the dictionary rather than here.

export interface NormalizedSiteAddress {
  readonly ok: true;
  readonly origin: string;
}

export interface InvalidSiteAddress {
  readonly ok: false;
}

export type SiteAddressResult = NormalizedSiteAddress | InvalidSiteAddress;

const INVALID: InvalidSiteAddress = { ok: false };

/**
 * Normalize a freeform site address to a valid HTTPS origin, or refuse it.
 * Accepts bare domains, www hosts, full URLs with a path/query/fragment and
 * http:// links (upgraded to https, because the audit only reads secure
 * origins), while rejecting clearly unsafe or invalid input (other schemes,
 * embedded credentials, non-domain text).
 */
export function normalizeSiteAddress(raw: string): SiteAddressResult {
  const trimmed = raw.trim();
  if (trimmed === '' || /\s/.test(trimmed)) {
    return INVALID;
  }

  let candidate = trimmed;
  const schemeWithSlashes = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(candidate);
  if (schemeWithSlashes !== null) {
    const scheme = schemeWithSlashes[1]!.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      // ftp://, file://, chrome:// and friends are not public sites.
      return INVALID;
    }
    // Upgrade http:// to https:// — the audit only reads secure origins.
    candidate = `https://${candidate.slice(schemeWithSlashes[0].length)}`;
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)/.test(candidate)) {
    // A scheme without "//" that is not host:port — e.g. mailto:, javascript:,
    // data:, tel:. These are never a site address.
    return INVALID;
  } else {
    // Bare domain or host:port — assume the secure scheme the product needs.
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return INVALID;
  }

  if (url.username !== '' || url.password !== '' || url.protocol !== 'https:') {
    return INVALID;
  }

  const host = url.hostname;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
    // A public site needs a dotted host; "localhost" or a bare word is a
    // typo for this audience.
    return INVALID;
  }

  return { ok: true, origin: url.origin };
}

/**
 * The profile name to suggest for an address the owner is typing.
 *
 * Owners call their site by its domain ("mysite.com"), so the domain — without
 * the scheme, a leading "www." or any path — is the name the form pre-fills
 * while the name field is still untouched. Returns null while the address is
 * not a site address yet, so a half-typed domain never leaves a stray name
 * behind.
 */
export function siteNameFromAddress(raw: string): string | null {
  const normalized = normalizeSiteAddress(raw);
  if (!normalized.ok) return null;

  const host = new URL(normalized.origin).hostname;
  const withoutWww = host.startsWith('www.') ? host.slice('www.'.length) : host;
  // "www.com" would collapse to a bare label, which is no longer a site name.
  return withoutWww.includes('.') ? withoutWww : host;
}
