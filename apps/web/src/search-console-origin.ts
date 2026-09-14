// Turns a Google Search Console property into the https origin a FluxRadar
// profile is allowed to hold — or says, in a machine-readable way, why it
// cannot. A property is Google's identifier for a verified site, not a URL we
// may invent from: nothing here guesses a host, upgrades a scheme or drops a
// port, so a property that does not map onto a public https origin ends as a
// refusal the user can act on instead of a profile pointing somewhere else.

/** Why a property cannot become a profile. Each maps to its own sentence. */
export type SearchConsoleOriginProblem =
  /** A verified `http://` prefix property. Upgrading it would change the site. */
  | 'insecure_scheme'
  /** Not a public https site at all: android-app://, a bare host, junk input. */
  | 'unsupported';

export type SearchConsoleOriginResult =
  | { readonly ok: true; readonly origin: string; readonly host: string }
  | { readonly ok: false; readonly reason: SearchConsoleOriginProblem };

const DOMAIN_PROPERTY_PREFIX = 'sc-domain:';

/** A domain property (`sc-domain:example.com`) covers its host and every subdomain of it. */
export function isDomainProperty(siteUrl: string): boolean {
  return siteUrl.trim().toLowerCase().startsWith(DOMAIN_PROPERTY_PREFIX);
}

/** A public site needs a dotted host — `localhost` or a bare word cannot be one. */
function isPublicHost(host: string): boolean {
  return host.includes('.') && !host.startsWith('.') && !host.endsWith('.');
}

function originOf(url: URL): SearchConsoleOriginResult {
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'unsupported' };
  if (url.protocol === 'http:') return { ok: false, reason: 'insecure_scheme' };
  if (url.protocol !== 'https:') return { ok: false, reason: 'unsupported' };
  if (!isPublicHost(url.hostname)) return { ok: false, reason: 'unsupported' };
  return { ok: true, origin: url.origin, host: url.hostname };
}

/**
 * `sc-domain:example.com` → `https://example.com`; a URL-prefix property keeps
 * only its origin, so `https://example.com/shop/` also becomes
 * `https://example.com`. Every other shape is refused.
 */
export function originFromSearchConsoleProperty(siteUrl: string): SearchConsoleOriginResult {
  const trimmed = siteUrl.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return { ok: false, reason: 'unsupported' };

  if (isDomainProperty(trimmed)) {
    const host = trimmed.slice(DOMAIN_PROPERTY_PREFIX.length);
    // A domain property is a bare registrable host: anything carrying a path,
    // port, credentials or scheme is not the shape Google documents, and
    // guessing what was meant is exactly what this module must not do.
    if (host === '' || /[/@:?#]/.test(host)) return { ok: false, reason: 'unsupported' };
    try {
      return originOf(new URL(`https://${host}`));
    } catch {
      return { ok: false, reason: 'unsupported' };
    }
  }

  try {
    return originOf(new URL(trimmed));
  } catch {
    return { ok: false, reason: 'unsupported' };
  }
}
