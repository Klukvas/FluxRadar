// DEPLOY-008: the security headers the browser actually receives.
//
// Removing the script origin the Content-Security-Policy allows for Google
// Analytics breaks it in a way that is visible to nobody but a browser
// console. That was a known gap, not a design — nothing in this repository
// looked at the policy, so a widened `script-src`, a deleted `frame-ancestors`
// or a GA origin bumped in the TypeScript and forgotten in the Caddyfile all
// shipped silently.
//
// So this suite pins three things:
//
//   1. deploy/Caddyfile — the real production path — sets the whole header set,
//      and its CSP is restrictive in the ways that matter (no inline script, no
//      eval, no wildcard source, framing still forbidden). Creem's checkout is
//      a full-page redirect to Creem's own hosted page — never framed or
//      scripted on this one — so the policy grants it nothing at all.
//   2. deploy/nginx.conf carries the same policy byte for byte, and
//      deploy/public-smoke.sh asserts the header is present on the deployed
//      site — a policy nobody checks after a deploy is a policy that can be
//      dropped by a Caddyfile edit and never noticed.
//
// On the duplication: Caddy's `header` directive SETS a field, so on the public
// path Caddy's copy replaces nginx's and the browser sees one of each. The
// second copy exists because the web container is a complete web server whose
// port is private only by a loopback publish in docker-compose.yml. Requiring
// the two to be byte-identical is what makes the duplication safe: even if a
// future Caddy appended instead of setting, two identical policies intersect to
// the same policy.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const CADDYFILE_PATH = join(REPO_ROOT, 'deploy', 'Caddyfile');
const NGINX_PATH = join(REPO_ROOT, 'deploy', 'nginx.conf');
const SMOKE_PATH = join(REPO_ROOT, 'deploy', 'public-smoke.sh');
const ANALYTICS_CONFIG_PATH = join(REPO_ROOT, 'apps', 'web', 'src', 'analytics-config.ts');

const caddyfile = readFileSync(CADDYFILE_PATH, 'utf8');
const nginxConf = readFileSync(NGINX_PATH, 'utf8');
const smokeScript = readFileSync(SMOKE_PATH, 'utf8');

/** The value of one `Header "value"` line in the Caddyfile header block. */
function caddyHeader(field: string): string | null {
  const match = new RegExp(`^\\s*${field}\\s+"([^"]*)"\\s*$`, 'm').exec(caddyfile);
  return match?.[1] ?? null;
}

/** The value of one `add_header Field "value" always;` line in nginx.conf. */
function nginxHeader(field: string): string | null {
  const match = new RegExp(`^\\s*add_header\\s+${field}\\s+"([^"]*)"\\s+always;\\s*$`, 'm').exec(
    nginxConf,
  );
  return match?.[1] ?? null;
}

/** `{ 'script-src': ["'self'", 'https://…'] }` from a policy string. */
function parsePolicy(policy: string): ReadonlyMap<string, readonly string[]> {
  return new Map(
    policy
      .split(';')
      .map((directive) => directive.trim())
      .filter((directive) => directive !== '')
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name ?? '', sources] as const;
      }),
  );
}

/** A single-quoted string constant's value, read out of a TypeScript source. */
function constantFrom(path: string, name: string): string {
  const source = readFileSync(path, 'utf8');
  const match = new RegExp(`${name}\\s*=\\s*'([^']+)'`).exec(source);
  if (match?.[1] === undefined) {
    expect.unreachable(`${name} is no longer a plain string constant in ${path}`);
  }
  return match[1];
}

const CSP_FIELD = 'Content-Security-Policy';

/**
 * Where gtag.js sends hits. Google spreads collection across regional hosts
 * (`region1.google-analytics.com`, `region1.analytics.google.com`, …) and falls
 * back to image beacons, so these are subdomain patterns by necessity — which is
 * exactly why they are confined to `connect-src` and `img-src` and kept out of
 * `script-src`, where a wildcard would let any Google-hosted script run.
 */
const GA_COLLECTION_SOURCES = [
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
];
const policyText = caddyHeader(CSP_FIELD) ?? '';
const policy = parsePolicy(policyText);

describe('the production Caddyfile', () => {
  it.each([
    ['Strict-Transport-Security', /^max-age=(\d+)/],
    ['X-Content-Type-Options', /^nosniff$/],
    ['X-Frame-Options', /^DENY$/],
    ['Referrer-Policy', /^strict-origin-when-cross-origin$/],
    ['Permissions-Policy', /camera=\(\)/],
    [CSP_FIELD, /default-src/],
  ])('sets %s', (field, shape) => {
    expect(caddyHeader(field)).toMatch(shape);
  });

  it('asks for a year of HSTS across every subdomain', () => {
    const value = caddyHeader('Strict-Transport-Security') ?? '';
    const maxAge = Number(/max-age=(\d+)/.exec(value)?.[1] ?? '0');

    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    expect(value).toContain('includeSubDomains');
  });

  // Caddy adds its own `Server: Caddy` otherwise, which names the proxy and its
  // version to anyone who asks.
  it('removes the Server banner', () => {
    expect(caddyfile).toMatch(/^\s*-Server\s*$/m);
  });
});

describe('the Content-Security-Policy', () => {
  it.each([
    ['default-src', "'self'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['object-src', "'none'"],
  ])('keeps %s at %s', (directive, expected) => {
    expect(policy.get(directive)).toEqual([expected]);
  });

  // The one that fails open. An 'unsafe-inline' or 'unsafe-eval' here turns the
  // policy into decoration, and neither the deploy nor a buyer would notice.
  it('allows no inline script, no eval and no wildcard', () => {
    const scriptSrc = policy.get('script-src') ?? [];

    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain('*');
    expect(scriptSrc).not.toContain('data:');
    expect(scriptSrc.filter((source) => source.includes('*'))).toEqual([]);
  });

  it('names every directive it relies on rather than leaning on default-src', () => {
    for (const directive of ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src']) {
      expect(policy.has(directive)).toBe(true);
    }
  });

  // Creem hosts the checkout page itself: the browser is redirected there and
  // comes back to our own return page afterwards. Nothing on this page ever
  // frames, scripts or calls a Creem origin, so the policy grants Creem
  // nothing — and no onfastspring.com survivor is left in any directive.
  it('grants Creem no CSP source at all, and frames nothing', () => {
    expect(policy.get('frame-src')).toEqual(["'none'"]);
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get('connect-src')).toEqual(["'self'", ...GA_COLLECTION_SOURCES]);
    for (const [, sources] of policy) {
      for (const source of sources) {
        expect(source.toLowerCase()).not.toContain('onfastspring.com');
        expect(source.toLowerCase()).not.toContain('creem.io');
      }
    }
  });

  // Google Analytics loads only after a visitor allows it (apps/web/src/analytics.ts),
  // but the policy cannot know that, so what it grants Google stays enumerated:
  // one exact script origin, and the collection hosts for hits and beacons.
  it('grants Google Analytics a script origin and its collection hosts, and nothing else', () => {
    const gaOrigin = constantFrom(ANALYTICS_CONFIG_PATH, 'GA_SCRIPT_ORIGIN');
    const withGoogle = [...policy]
      .filter(([, sources]) =>
        sources.some((source) =>
          /google-analytics\.com|analytics\.google\.com|googletagmanager\.com/.test(source),
        ),
      )
      .map(([directive]) => directive);

    expect(withGoogle.sort()).toEqual(['connect-src', 'img-src', 'script-src']);
    expect((policy.get('script-src') ?? []).filter((source) => source.includes('google'))).toEqual([
      gaOrigin,
    ]);
    expect(policy.get('img-src')).toEqual([
      "'self'",
      'data:',
      'https://*.google-analytics.com',
      'https://*.googletagmanager.com',
    ]);
  });
});

describe('the web container', () => {
  it.each([
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    CSP_FIELD,
  ])('repeats %s, so a document served straight off it still carries it', (field) => {
    expect(nginxHeader(field)).toBe(caddyHeader(field));
  });

  // Without `always`, nginx omits add_header on 4xx/5xx — precisely the
  // responses where an unprotected document matters most.
  it('emits them on error responses too', () => {
    const added = nginxConf.match(/^\s*add_header\s+\S+/gm) ?? [];
    const always = nginxConf.match(/^\s*add_header\s+\S+.*\salways;\s*$/gm) ?? [];

    expect(added.length).toBeGreaterThan(0);
    expect(always).toHaveLength(added.length);
  });

  it('does not announce its version', () => {
    expect(nginxConf).toMatch(/^\s*server_tokens\s+off;\s*$/m);
  });
});

describe('the public smoke test', () => {
  // A policy nobody looks at after a deploy is one a Caddyfile edit can drop in
  // silence. The smoke test runs from outside the server and is the last gate.
  it('asserts the Content-Security-Policy reaches the browser', () => {
    expect(smokeScript.toLowerCase()).toContain('content-security-policy');
  });

  it('still asserts HSTS as well', () => {
    expect(smokeScript.toLowerCase()).toContain('strict-transport-security');
  });
});
