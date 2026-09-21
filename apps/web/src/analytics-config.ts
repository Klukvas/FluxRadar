/**
 * FluxRadar's own Google Analytics 4 web stream — the site's visitor statistics,
 * unrelated to the Google data customers connect to their reports.
 *
 * The Measurement ID is public by design: every page that loads the tag ships
 * it. Three places have to agree on these values, and tests hold them together:
 * `deploy/Caddyfile` allows GA_SCRIPT_ORIGIN in `script-src` (DEPLOY-008), and
 * the static blog's `public/blog/blog.js` carries its own copy because it is not
 * part of this bundle (blog-page.test.ts).
 */
export const GA_MEASUREMENT_ID = 'G-0N0B548CGE';

/** Where gtag.js is served from — the only script origin analytics adds to the CSP. */
export const GA_SCRIPT_ORIGIN = 'https://www.googletagmanager.com';

/**
 * Analytics runs on the production host only, so `vite dev`, a local Docker
 * build, previews and tests never report into the production property — even
 * when someone clicks "Allow all" there.
 */
export const ANALYTICS_HOSTNAME = 'fluxradar.net';
