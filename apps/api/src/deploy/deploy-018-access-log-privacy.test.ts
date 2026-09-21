// DEPLOY-018: the access log is private by construction.
//
// deploy/Caddyfile writes every request fluxradar.net serves to a JSON log, so
// the owner has a cookieless count of traffic — GA4 sees only the visitors who
// accept analytics cookies — and can see which crawlers and AI bots visit. A
// log of every request is also the easiest place to leak what the Privacy
// Policy promises not to keep, so this suite pins the filter, not just its
// presence:
//
//   1. IPs are masked before a line is written, the query keys that carry
//      one-time secrets are deleted, the Referer and Location lose their query
//      string, and credentials are deleted outright. The secret keys are
//      cross-checked against the places the app builds those URLs.
//   2. Retention stays inside the Privacy Policy's 30 days (the arithmetic is
//      at the retention test: Caddy 2.10 rolls by size, not by time).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const CADDYFILE_PATH = join(REPO_ROOT, 'deploy', 'Caddyfile');
const COMPOSE_PATH = join(REPO_ROOT, 'docker-compose.yml');
const AUTH_ROUTES_PATH = join(REPO_ROOT, 'apps', 'api', 'src', 'auth', 'routes.ts');
const AUTH_SCREEN_PATH = join(REPO_ROOT, 'apps', 'web', 'src', 'AuthScreen.tsx');

// apps/web/src/legal/PrivacyPolicy.tsx: "Ordinary application and security
// logs: up to 30 days."
const PRIVACY_POLICY_LOG_DAYS = 30;

// OAuth 2.0 returns the authorization code and the CSRF state to the callback
// as query parameters (RFC 6749 §4.1.2), and an email address is personal data
// wherever it appears.
const STANDARD_SECRET_QUERY_KEYS = ['code', 'state', 'email'] as const;

// The fields GoAccess's CADDY format reads. Masked or trimmed is fine; deleted
// is a report with a hole in it.
const GOACCESS_FIELDS = [
  'ts',
  'status',
  'size',
  'duration',
  'request>method',
  'request>host',
  'request>uri',
  'request>proto',
  'request>client_ip',
  'request>headers>User-Agent',
  'request>headers>Referer',
] as const;

const caddyfile = readFileSync(CADDYFILE_PATH, 'utf8');

/** Non-comment lines of the Caddyfile from `opener` to its closing brace, trimmed. */
function blockOf(lines: readonly string[], opener: string): readonly string[] {
  const start = lines.indexOf(opener);
  expect(start, `deploy/Caddyfile has no \`${opener}\` block`).toBeGreaterThan(-1);
  const block: string[] = [];
  let depth = 0;
  for (const line of lines.slice(start)) {
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    block.push(line);
    if (depth === 0) break;
  }
  return block;
}

const caddyLines = caddyfile
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));
const logBlock = blockOf(caddyLines, 'log {');
const outputBlock = blockOf(logBlock, 'output file /data/logs/access.log {');

/** The filter a field is given in the `format filter` block, e.g. `delete`. */
function filterOf(field: string): string | null {
  const line = logBlock.find((entry) => entry.startsWith(`${field} `));
  return line?.slice(field.length + 1).split(/\s+/)[0] ?? null;
}

/** `{ ipv4: 24, ipv6: 48 }` from a field's `ip_mask { … }` block. */
function ipMaskOf(field: string): { ipv4: number; ipv6: number } {
  const block = blockOf(logBlock, `${field} ip_mask {`);
  const bits = (family: string): number =>
    Number(block.find((line) => line.startsWith(`${family} `))?.split(/\s+/)[1] ?? Number.NaN);
  return { ipv4: bits('ipv4'), ipv6: bits('ipv6') };
}

/** The pattern and replacement of a field's `regexp "…" "…"` filter. */
function regexpOf(field: string): { pattern: RegExp; replacement: string } {
  const line = logBlock.find((entry) => entry.startsWith(`${field} regexp `)) ?? '';
  const match = /^\S+ regexp "([^"]*)" "([^"]*)"$/.exec(line);
  if (match?.[1] === undefined || match[2] === undefined) {
    expect.unreachable(`${field} has no quoted \`regexp "pattern" "replacement"\` filter`);
  }
  // Go's ReplaceAllString replaces every match; the patterns used here are in
  // the subset RE2 and JavaScript read the same way.
  return { pattern: new RegExp(match[1], 'g'), replacement: match[2] };
}

function rollSetting(name: string): string | null {
  return outputBlock.find((line) => line.startsWith(`${name} `))?.split(/\s+/)[1] ?? null;
}

describe('the production access log', () => {
  // The caddy container is recreated on every deploy; only the volume keeps
  // the file, and the report script reads it from there.
  it('is JSON on the caddy_data volume, which outlives every deploy', () => {
    expect(logBlock).toContain('wrap json');
    expect(readFileSync(COMPOSE_PATH, 'utf8')).toMatch(/^\s*- caddy_data:\/data$/m);
  });

  it.each(['request>remote_ip', 'request>client_ip'])(
    'masks %s to its /24 or /48 network',
    (field) => {
      const mask = ipMaskOf(field);

      expect(mask.ipv4).toBeGreaterThan(0);
      expect(mask.ipv4).toBeLessThanOrEqual(24);
      expect(mask.ipv6).toBeGreaterThan(0);
      expect(mask.ipv6).toBeLessThanOrEqual(48);
    },
  );

  // The cross-check: a new mailed link with a different parameter name would
  // otherwise be written to disk in full for the next two weeks.
  it('deletes every query key the app puts a one-time secret in', () => {
    const mailedLinkKeys = [
      ...readFileSync(AUTH_ROUTES_PATH, 'utf8').matchAll(/\}\/\?(\w+)=\$\{/g),
    ].map((match) => match[1]);
    const verifyCallKeys = [
      ...readFileSync(AUTH_SCREEN_PATH, 'utf8').matchAll(/\/auth\/verify-email\?(\w+)=/g),
    ].map((match) => match[1]);
    const deleted = blockOf(logBlock, 'request>uri query {')
      .filter((line) => line.startsWith('delete '))
      .map((line) => line.split(/\s+/)[1]);

    expect(mailedLinkKeys.sort()).toEqual(['reset_token', 'verify_email']);
    expect(verifyCallKeys).toEqual(['token']);
    for (const key of [...mailedLinkKeys, ...verifyCallKeys, ...STANDARD_SECRET_QUERY_KEYS]) {
      expect(deleted).toContain(key);
    }
  });

  // Referrer-Policy is strict-origin-when-cross-origin, so a same-origin
  // navigation away from a reset link sends that whole link as the Referer.
  it.each([
    [
      'request>headers>Referer',
      'https://fluxradar.net/?reset_token=abc123&x=1',
      'https://fluxradar.net/',
    ],
    ['request>headers>Referer', 'https://fluxradar.net/pricing', 'https://fluxradar.net/pricing'],
    [
      'resp_headers>Location',
      'https://accounts.google.com/o/oauth2/v2/auth?state=s3cret&client_id=1',
      'https://accounts.google.com/o/oauth2/v2/auth',
    ],
  ])('strips the query string from %s', (field, input, expected) => {
    const { pattern, replacement } = regexpOf(field);

    expect(input.replace(pattern, replacement)).toBe(expected);
  });

  // Caddy writes these as "REDACTED" by default, but a `log_credentials`
  // server option would turn that off for every site at once.
  it.each([
    'request>headers>Cookie',
    'request>headers>Authorization',
    'request>headers>Proxy-Authorization',
    'resp_headers>Set-Cookie',
    'request>headers>X-Forwarded-For',
  ])('deletes %s outright', (field) => {
    expect(filterOf(field)).toBe('delete');
  });

  it('keeps every field the GoAccess CADDY format reads', () => {
    for (const field of GOACCESS_FIELDS) {
      expect(filterOf(field), field).not.toBe('delete');
    }
    expect(filterOf('request>headers>User-Agent')).toBeNull();
  });
});

describe('access log retention', () => {
  // Caddy 2.10 rolls by size only. An entry waits in the live file until it
  // fills (F), is rolled, and the rolled file is deleted by the first roll or
  // restart after it turns roll_keep_for old — within one more fill. The worst
  // case is 2F + roll_keep_for. Keeping roll_keep_for to half the policy
  // leaves 15 days for 2F; at 2 MiB of ~2 KB lines that holds for anything
  // above ~140 requests a day.
  it('keeps rolled files for at most half the Privacy Policy window', () => {
    const keepFor = /^(\d+)([hd])$/.exec(rollSetting('roll_keep_for') ?? '');
    if (keepFor?.[1] === undefined) expect.unreachable('roll_keep_for is not set in hours or days');
    // Caddy rounds a partial day up.
    const days = keepFor[2] === 'd' ? Number(keepFor[1]) : Math.ceil(Number(keepFor[1]) / 24);

    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(PRIVACY_POLICY_LOG_DAYS / 2);
  });

  it('rolls small files, so an entry never waits long in the live one', () => {
    const size = /^(\d+)MiB$/.exec(rollSetting('roll_size') ?? '');

    expect(Number(size?.[1] ?? Number.NaN)).toBeLessThanOrEqual(2);
    expect(outputBlock).not.toContain('roll_disabled');
  });

  it('bounds the number of rolled files, so a crawler storm cannot fill the disk', () => {
    expect(Number(rollSetting('roll_keep'))).toBeGreaterThan(0);
  });
});
