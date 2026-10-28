/**
 * Plausible Cloud (EU) — the cookieless page count every visitor is part of.
 *
 * This is the second, consent-free analytics beside the consent-gated Google
 * Analytics 4 in `analytics-config.ts`, and the two share nothing but the host
 * check: GA4 waits for the analytics category, Plausible does not need it,
 * because it writes nothing to the device and keeps no identifier that could be
 * read back (see the Cookie Policy and `PrivacyPolicy.tsx`).
 *
 * Everything Plausible is given is first-party. The script is served from this
 * origin at PLAUSIBLE_SCRIPT_PATH and the events go to PLAUSIBLE_EVENT_PATH,
 * both proxied to plausible.io by `deploy/Caddyfile`; that is what lets the
 * production `script-src`/`connect-src` stay at `'self'` with no Plausible
 * origin added to the policy at all.
 *
 * Three places have to agree on PLAUSIBLE_SITE_SCRIPT, and tests hold them
 * together: this file is the source of truth, `deploy/Caddyfile` rewrites the
 * first-party script path to it (DEPLOY-023), and the static blog carries its
 * own copy because it is not part of this bundle (blog-page.test.ts).
 */

/**
 * The site's own Plausible script, named as Plausible names it: the `pa-XXXXX`
 * part of the `https://plausible.io/js/pa-XXXXX.js` snippet shown under
 * Site Installation, in the General section of the site's settings. It is the
 * only site-specific value the new script format needs — the domain is baked
 * into the script Plausible serves, so there is no `data-domain` anywhere.
 *
 * Filled in on 28 October 2026, for the `fluxradar.net` site in the Plausible
 * account: every production page is counted from here on. The same id also has
 * to be in `deploy/Caddyfile` and `public/blog/blog.js` — one of the three left
 * behind ships a tracker that 404s, so DEPLOY-023 and blog-page.test.ts fail
 * while they disagree. While it reads PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER
 * instead, Plausible is off: `startPlausible` returns without requesting
 * anything, which is how a build with no site of its own counts nothing rather
 * than requesting a script that does not exist.
 */
export const PLAUSIBLE_SITE_SCRIPT = 'pa-RdP8FeGFozbbu7f5BnXd1';

/** The placeholder, by name, so a check can tell "not set up yet" from "set up wrong". */
export const PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER = 'pa-REPLACE-WITH-PLAUSIBLE-SITE-SCRIPT-ID';

/**
 * Where the browser asks for the tracker: this origin, not plausible.io.
 *
 * A first-party path is what keeps the script out of the blocklists that match
 * on Plausible's own hostname, and what keeps `script-src 'self'` sufficient.
 */
export const PLAUSIBLE_SCRIPT_PATH = '/js/script.js';

/**
 * Where the browser posts events: this origin again, proxied on to
 * PLAUSIBLE_UPSTREAM_EVENT_PATH on plausible.io.
 *
 * Deliberately NOT the `/api/event` of Plausible's own Caddy guide. `/api/*` is
 * already this site's API, forwarded to the backend with the prefix stripped,
 * and Caddy orders a named matcher like `@plausible` by where it sits in the
 * file rather than by how specific it is — so a `/api/event` of ours would
 * reach Plausible only as long as nobody moved the block, and would otherwise
 * be answered by our API with a 404 that the tracker never reports. Keeping the
 * event path out of the `/api/` namespace removes that failure mode instead of
 * documenting it.
 */
export const PLAUSIBLE_EVENT_PATH = '/js/event';

/**
 * The upstream path the proxy rewrites PLAUSIBLE_EVENT_PATH to.
 *
 * Plausible receives events here and nowhere else: a POST to
 * `https://plausible.io/js/event` answers 404, not 202. So the two paths differ
 * on purpose — ours has to stay out of `/api/`, the upstream's cannot be
 * anything else — and `deploy/Caddyfile` bridges them with a rewrite that
 * DEPLOY-023 pins. Missing that rewrite loses every event while looking exactly
 * like a site with no visitors, which is why it is pinned rather than trusted.
 */
export const PLAUSIBLE_UPSTREAM_EVENT_PATH = '/api/event';

/** A real script id: `pa-` and the token Plausible generated after it. */
const SITE_SCRIPT_SHAPE = /^pa-[A-Za-z0-9_-]{4,64}$/;

/**
 * Whether this build counts page views at all. False while the id is still the
 * placeholder, which is the only reason Plausible is ever silently off.
 */
export function plausibleConfigured(siteScript: string = PLAUSIBLE_SITE_SCRIPT): boolean {
  return siteScript !== PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER && siteScript.trim() !== '';
}

/**
 * Why this script id cannot be used, or null when it can.
 *
 * Shaped after `sentryDsnProblem`, and used the same way: an id left at the
 * placeholder is "not set up", which is allowed and simply measures nothing,
 * while an id that has been set and is malformed fails the production build by
 * name (vite.config.ts). The failure this guards against is a half-pasted
 * value — `pa-` alone, the whole `https://plausible.io/js/pa-XXXXX.js` URL, or
 * the `.js` left on the end — which would otherwise ship a site whose tracker
 * 404s on every page.
 */
export function plausibleSiteScriptProblem(siteScript: string): string | null {
  const trimmed = siteScript.trim();
  if (!plausibleConfigured(trimmed)) return null;
  if (trimmed !== siteScript) return 'it has leading or trailing whitespace';
  if (trimmed.includes('/')) {
    return `it looks like a URL or a path (${trimmed}); use only the "pa-XXXXX" file name, without "/js/" and without ".js"`;
  }
  if (trimmed.endsWith('.js')) {
    return `it still ends with ".js" (${trimmed}); use the bare "pa-XXXXX" name`;
  }
  if (!trimmed.startsWith('pa-')) {
    return `it does not start with "pa-" (${trimmed})`;
  }
  if (!SITE_SCRIPT_SHAPE.test(trimmed)) {
    return `it is not a "pa-" name followed by 4 to 64 letters, digits, "-" or "_" (${trimmed})`;
  }
  return null;
}

/** The upstream file name the Caddy proxy rewrites the first-party path to. */
export function plausibleUpstreamScriptPath(siteScript: string = PLAUSIBLE_SITE_SCRIPT): string {
  return `/js/${siteScript}.js`;
}
