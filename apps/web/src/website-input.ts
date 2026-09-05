// Turns the natural website input a non-technical owner types
// ("mysite.com", "www.mysite.com", "https://mysite.com/about?ref=1") into the
// strict HTTPS origin the API stores. The server still re-validates the origin
// (defense in depth); this client step exists so people never have to think in
// terms of "HTTPS origins" and never see backend validation jargon.

export interface NormalizedWebsite {
  readonly ok: true;
  readonly origin: string;
}

export interface InvalidWebsite {
  readonly ok: false;
  readonly error: string;
}

export type WebsiteInputResult = NormalizedWebsite | InvalidWebsite;

// Friendly, jargon-free copy reused by the onboarding and workspace forms.
export const WEBSITE_INPUT_LABEL = 'Website address';
export const WEBSITE_INPUT_PLACEHOLDER = 'mysite.com';
export const WEBSITE_INPUT_HINT =
  'Enter your homepage domain, for example mysite.com. No CMS access or passwords needed.';
export const WEBSITE_INPUT_ERROR =
  'That does not look like a website address. Enter your domain, like mysite.com.';

/**
 * Normalize freeform website input to a valid HTTPS origin, or explain — in
 * plain language — why it cannot be used. Accepts bare domains, www hosts,
 * full URLs with a path/query/fragment and http:// links (upgraded to https),
 * while rejecting clearly unsafe or invalid input (other schemes, embedded
 * credentials, non-domain text).
 */
export function normalizeWebsiteInput(raw: string): WebsiteInputResult {
  const trimmed = raw.trim();
  if (trimmed === '' || /\s/.test(trimmed)) {
    return { ok: false, error: WEBSITE_INPUT_ERROR };
  }

  let candidate = trimmed;
  const schemeWithSlashes = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(candidate);
  if (schemeWithSlashes !== null) {
    const scheme = schemeWithSlashes[1]!.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      // ftp://, file://, chrome:// and friends are not public websites.
      return { ok: false, error: WEBSITE_INPUT_ERROR };
    }
    // Upgrade http:// to https:// — the audit only reads secure origins.
    candidate = `https://${candidate.slice(schemeWithSlashes[0].length)}`;
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:(?!\d)/.test(candidate)) {
    // A scheme without "//" that is not host:port — e.g. mailto:, javascript:,
    // data:, tel:. These are never a website address.
    return { ok: false, error: WEBSITE_INPUT_ERROR };
  } else {
    // Bare domain or host:port — assume the secure scheme the product needs.
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: WEBSITE_INPUT_ERROR };
  }

  if (url.username !== '' || url.password !== '' || url.protocol !== 'https:') {
    return { ok: false, error: WEBSITE_INPUT_ERROR };
  }

  const host = url.hostname;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
    // A public website needs a dotted host; "localhost" or a bare word is a
    // typo for this audience.
    return { ok: false, error: WEBSITE_INPUT_ERROR };
  }

  return { ok: true, origin: url.origin };
}
