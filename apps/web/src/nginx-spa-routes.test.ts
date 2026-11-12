// deploy/nginx.conf answers a path that is neither a file nor an address of the
// app with a 404. Its `$spa_route` list is therefore a copy of the app's own
// routes: a screen added to app-routes.ts without an entry there would work in
// `vite dev` and 404 in production. This holds the two together.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ADMIN_STATS_PATH } from './admin-stats';
import { pathForScreen, readInitialRoute, type Screen } from './app-routes';
import { WORKSPACE_PATHS } from './workspace-paths';

const NGINX_CONF = resolve(process.cwd(), '../../deploy/nginx.conf');

/** The regular expressions of `map $uri $spa_route { … }`, one per `~regex 1;` line. */
function spaRoutePatterns(): readonly RegExp[] {
  const conf = readFileSync(NGINX_CONF, 'utf8');
  const block = /map \$uri \$spa_route \{([^}]*)\}/.exec(conf)?.[1];
  if (block === undefined) throw new Error('deploy/nginx.conf has no `map $uri $spa_route` block');
  return [...block.matchAll(/^\s*~(\S+)\s+1;/gm)].map((match) => new RegExp(match[1] ?? ''));
}

function nginxServesShell(path: string): boolean {
  return spaRoutePatterns().some((pattern) => pattern.test(path));
}

function clientScreenAt(path: string): Screen {
  window.history.replaceState(null, '', path);
  return readInitialRoute().screen;
}

const SCREENS_WITH_PATHS: readonly Screen[] = [
  'desktop',
  'new-scan',
  'reports',
  'integrations',
  'scan',
  'results',
  'issues',
  'print',
  'account',
  'admin-stats',
];

// Public documents (/faq, /uk/faq…), the blog and the knowledge base are files
// under `$uri/index.html`, so nginx never consults this list for them.
const APP_ADDRESSES: readonly string[] = [
  '/',
  '/uk',
  '/ru',
  '/login',
  '/plans',
  '/account',
  '/checkout/return',
  ADMIN_STATS_PATH,
  ...Object.values(WORKSPACE_PATHS),
  ...SCREENS_WITH_PATHS.map((screen) => pathForScreen(screen, 'abc')),
];

describe('deploy/nginx.conf and the routes of the app', () => {
  it.each([...new Set(APP_ADDRESSES)])('serves the app shell at %s', (path) => {
    expect(clientScreenAt(path)).not.toBe('not-found');
    expect(nginxServesShell(path)).toBe(true);
  });

  it.each(['/nope-404', '/uk/nope', '/scans', '/scans/a/b/c', '/profiles/extra', '/blog/missing'])(
    'answers %s with a 404 in both places',
    (path) => {
      expect(clientScreenAt(path)).toBe('not-found');
      expect(nginxServesShell(path)).toBe(false);
    },
  );
});
