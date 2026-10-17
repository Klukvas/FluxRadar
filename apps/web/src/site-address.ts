/**
 * A saved site's address the way a person reads it: "mysalon.com.ua", not
 * "https://mysalon.com.ua/". Display only — the profile keeps the full origin,
 * and that is what the scan and the reachability probe are sent.
 */
export function siteAddress(domain: string): string {
  return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}
