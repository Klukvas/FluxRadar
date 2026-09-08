// The name a profile gets when nobody typed one.
//
// A scan can now start from a raw address with no profile behind it, so the
// profile is created by the server rather than by the add-profile form — and it
// still has to be called something the owner recognises in a list. Owners call
// their site by its domain, so that is the name: the hostname, without the
// scheme and without a leading "www.".
//
// It is a SUGGESTION, not an identity. The name is editable and is written
// exactly once, when the profile is created; `resolveOwnProfile` never applies
// it to a profile that already exists, so a name the owner chose is never
// replaced by a derived one.

/**
 * A display name for a stored https origin.
 *
 * The origin has already been through `httpsOriginSchema`, so it parses; the
 * guard exists because this must never throw on stored data — a profile with an
 * unexpected domain gets its domain as its name instead of blocking the scan.
 */
export function siteProfileNameFor(origin: string): string {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return origin;
  }
  const withoutWww = host.startsWith('www.') ? host.slice('www.'.length) : host;
  // "www.com" would collapse to a bare label, which is no longer a site name.
  return withoutWww.includes('.') ? withoutWww : host;
}
