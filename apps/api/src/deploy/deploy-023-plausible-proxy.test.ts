// DEPLOY-023: the Plausible proxy in deploy/Caddyfile.
//
// Plausible is served through this origin: the browser asks fluxradar.net for
// the tracker and posts events to fluxradar.net, and Caddy forwards both to
// plausible.io. That arrangement is what keeps the Content-Security-Policy
// unchanged — `script-src 'self'` already covers a first-party script — and it
// is also the part of this feature that nothing in the browser can check.
//
// Three ways it can break silently, which is why they are pinned here:
//
//   1. The site script id. The id lives in apps/web/src/plausible-config.ts;
//      Caddy has to rewrite the first-party path to that same file. Filling in
//      one and not the other ships a tracker that 404s, and only a browser
//      console would say so.
//   2. The event path, which has to be two different paths at once. Plausible
//      accepts events at `/api/event` and only there — a POST to
//      `https://plausible.io/js/event` answers 404 — while OUR `/api/*` is this
//      site's API, forwarded to the backend with the prefix stripped. Caddy
//      orders a named matcher such as `@plausible` by where it sits in the file
//      and NOT by how specific it is, so an `/api/event` of ours would be one
//      block move away from being answered by our own API. The public path is
//      therefore kept out of `/api/` entirely and rewritten to the upstream's
//      on the way through; both rewrites are pinned below. Nothing in the
//      browser would report either mistake: a 404 and a 202 are both silent to
//      the tracker, and a site that loses every event looks like a quiet one.
//   3. The forwarded address. Plausible drops an event whose X-Forwarded-For is
//      missing or holds the proxy's own address, and still answers 202
//      (https://plausible.io/docs/proxy/introduction). Caddy sends the real
//      peer by default here, because it terminates TLS directly and no
//      trusted_proxies is set; the explicit header_up pins that, and a
//      trusted_proxies appearing later would quietly make a client-supplied
//      X-Forwarded-For authoritative instead.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const CADDYFILE_PATH = join(REPO_ROOT, 'deploy', 'Caddyfile');
const PLAUSIBLE_CONFIG_PATH = join(REPO_ROOT, 'apps', 'web', 'src', 'plausible-config.ts');
const BLOG_SCRIPT_PATH = join(REPO_ROOT, 'apps', 'web', 'public', 'blog', 'blog.js');

const caddyfile = readFileSync(CADDYFILE_PATH, 'utf8');
/** The Caddyfile with its comments removed, for asking what it actually does. */
const caddyDirectives = caddyfile
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');
const plausibleConfig = readFileSync(PLAUSIBLE_CONFIG_PATH, 'utf8');
const blogScript = readFileSync(BLOG_SCRIPT_PATH, 'utf8');

/** A single-quoted string constant's value, read out of a TypeScript source. */
function constantFrom(source: string, name: string, path: string): string {
  const match = new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(source);
  if (match?.[1] === undefined) {
    expect.unreachable(`${name} is no longer a plain string constant in ${path}`);
  }
  return match[1];
}

/** A `var NAME = '...';` value, read out of the blog's own copy. */
function blogConstant(name: string): string {
  const match = new RegExp(`var ${name} = '([^']+)';`).exec(blogScript);
  if (match?.[1] === undefined) {
    expect.unreachable(`${name} is no longer a plain var in public/blog/blog.js`);
  }
  return match[1];
}

const SITE_SCRIPT = constantFrom(plausibleConfig, 'PLAUSIBLE_SITE_SCRIPT', PLAUSIBLE_CONFIG_PATH);
const SCRIPT_PATH = constantFrom(plausibleConfig, 'PLAUSIBLE_SCRIPT_PATH', PLAUSIBLE_CONFIG_PATH);
const EVENT_PATH = constantFrom(plausibleConfig, 'PLAUSIBLE_EVENT_PATH', PLAUSIBLE_CONFIG_PATH);
const UPSTREAM_EVENT_PATH = constantFrom(
  plausibleConfig,
  'PLAUSIBLE_UPSTREAM_EVENT_PATH',
  PLAUSIBLE_CONFIG_PATH,
);
const PLACEHOLDER = constantFrom(
  plausibleConfig,
  'PLAUSIBLE_SITE_SCRIPT_PLACEHOLDER',
  PLAUSIBLE_CONFIG_PATH,
);

/** The body of the `handle @plausible { … }` block. */
function plausibleBlock(): string {
  const start = caddyfile.indexOf('handle @plausible {');
  if (start === -1) expect.unreachable('deploy/Caddyfile no longer handles @plausible');
  const end = caddyfile.indexOf('\n    }', start);
  return caddyfile.slice(start, end);
}

describe('the Plausible proxy', () => {
  it('serves both first-party paths from this origin', () => {
    const matcher = /^\s*@plausible path (.+)$/m.exec(caddyfile)?.[1] ?? '';

    expect(matcher.split(/\s+/).sort()).toEqual([EVENT_PATH, SCRIPT_PATH].sort());
  });

  it('rewrites the first-party script to the site script the app names', () => {
    expect(plausibleBlock()).toContain(`rewrite ${SCRIPT_PATH} /js/${SITE_SCRIPT}.js`);
  });

  // The one that cannot be left out. Our public event path is deliberately not
  // the upstream's, so without this line every event is posted to a path
  // plausible.io answers 404 on — and the tracker reports neither the 404 nor
  // the 202 it would have got, so the dashboard would simply read zero.
  it('rewrites the first-party event path to the one the upstream answers', () => {
    expect(UPSTREAM_EVENT_PATH).not.toBe(EVENT_PATH);
    expect(plausibleBlock()).toContain(`rewrite ${EVENT_PATH} ${UPSTREAM_EVENT_PATH}`);
  });

  // Both paths the matcher accepts are rewritten: one left untouched would be
  // forwarded under its first-party name, which plausible.io does not serve.
  it('leaves neither matched path unrewritten', () => {
    const rewritten = [...plausibleBlock().matchAll(/^\s*rewrite (\S+) (\S+)$/gm)].map(
      (match) => match[1],
    );

    expect(rewritten.sort()).toEqual([EVENT_PATH, SCRIPT_PATH].sort());
  });

  it('forwards to plausible.io with the upstream Host', () => {
    expect(plausibleBlock()).toContain('reverse_proxy https://plausible.io');
    expect(plausibleBlock()).toContain('header_up Host {http.reverse_proxy.upstream.hostport}');
  });

  // The visitor's address, not the proxy's, and set rather than appended: an
  // X-Forwarded-For a client sent must never be what Plausible geolocates.
  it('sends the connecting peer as X-Forwarded-For', () => {
    expect(plausibleBlock()).toContain('header_up X-Forwarded-For {http.request.remote.host}');
  });

  // What makes the line above the real client address: with a trusted_proxies
  // Caddy would start believing a client-supplied forwarding header.
  it('trusts no proxy in front of it', () => {
    expect(caddyDirectives).not.toMatch(/trusted_proxies/);
  });

  it('keeps the event endpoint out of the API namespace', () => {
    expect(EVENT_PATH.startsWith('/api/')).toBe(false);
    expect(SCRIPT_PATH.startsWith('/api/')).toBe(false);
  });

  // Belt and braces for the ordering rule: `handle` blocks are mutually
  // exclusive and the first match wins, and a named matcher keeps its position
  // in the file rather than being sorted by specificity.
  it('is matched before the API and before the SPA fallback', () => {
    const plausibleAt = caddyfile.indexOf('handle @plausible {');
    const apiAt = caddyfile.indexOf('handle_path /api/* {');
    const fallbackAt = caddyfile.indexOf('\n    handle {');

    expect(plausibleAt).toBeGreaterThan(-1);
    expect(apiAt).toBeGreaterThan(plausibleAt);
    expect(fallbackAt).toBeGreaterThan(plausibleAt);
  });
});

describe('the Content-Security-Policy', () => {
  // The whole reason for proxying: a first-party script and a first-party
  // endpoint need no policy source of their own. A `plausible.io` appearing in
  // any directive means the proxy was bypassed somewhere.
  it('grants Plausible no source at all, because the proxy makes it first-party', () => {
    const policy = /^\s*Content-Security-Policy\s+"([^"]*)"\s*$/m.exec(caddyfile)?.[1] ?? '';

    expect(policy).not.toBe('');
    expect(policy.toLowerCase()).not.toContain('plausible');
  });
});

describe('the site script id', () => {
  // Three copies: the app's constant, the blog's own var, and this rewrite.
  // Filling in some of them and not the rest is the failure this catches.
  it('is the same in the app, the blog and the Caddyfile', () => {
    expect(blogConstant('PLAUSIBLE_SITE_SCRIPT')).toBe(SITE_SCRIPT);
    expect(blogConstant('PLAUSIBLE_SCRIPT_PATH')).toBe(SCRIPT_PATH);
    expect(blogConstant('PLAUSIBLE_EVENT_PATH')).toBe(EVENT_PATH);
    expect(caddyfile).toContain(`/js/${SITE_SCRIPT}.js`);
  });

  // Filled in for the fluxradar.net site on 28 October 2026, which is what
  // this assertion now holds: a build that went back to the placeholder loads
  // no tracker at all (apps/web/src/plausible.ts) and would read as a site with
  // no visitors rather than a broken one. A filled-in id that is malformed
  // fails the production build by name first (apps/web/vite.config.ts).
  it('is a real Plausible script id rather than the placeholder', () => {
    expect(SITE_SCRIPT).not.toBe(PLACEHOLDER);
    expect(SITE_SCRIPT).toMatch(/^pa-[A-Za-z0-9_-]{4,64}$/);
  });

  // Whichever of the two it is, all three copies have to agree on it: the
  // assertion above reads the app's own constant alone, so a Caddyfile or a
  // blog left behind on the placeholder would still pass it.
  it('is either filled in everywhere or the placeholder everywhere', () => {
    const filledIn = SITE_SCRIPT !== PLACEHOLDER;

    expect(blogConstant('PLAUSIBLE_SITE_SCRIPT') !== PLACEHOLDER).toBe(filledIn);
    expect(caddyfile.includes(`/js/${PLACEHOLDER}.js`)).toBe(!filledIn);
  });
});
