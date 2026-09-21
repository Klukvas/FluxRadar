// DEPLOY-018: the access log is private by construction, and the report reads it.
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
//   3. scripts/traffic-report.sh reads the container and directory production
//      actually uses, refuses bad arguments before it touches a server, and —
//      against a stubbed ssh, docker and goaccess — reports the right window
//      out of both the rotated and the live files.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const CADDYFILE_PATH = join(REPO_ROOT, 'deploy', 'Caddyfile');
const COMPOSE_PATH = join(REPO_ROOT, 'docker-compose.yml');
const NGINX_PATH = join(REPO_ROOT, 'deploy', 'nginx.conf');
const RELEASE_PATH = join(REPO_ROOT, 'deploy', 'release.sh');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'traffic-report.sh');
const AUTH_ROUTES_PATH = join(REPO_ROOT, 'apps', 'api', 'src', 'auth', 'routes.ts');
const AUTH_SCREEN_PATH = join(REPO_ROOT, 'apps', 'web', 'src', 'AuthScreen.tsx');
const AI_READINESS_PATH = join(REPO_ROOT, 'packages', 'rules', 'src', 'ai-readiness.ts');

// apps/web/src/legal/PrivacyPolicy.tsx: "Ordinary application and security
// logs: up to 30 days."
const PRIVACY_POLICY_LOG_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

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
const script = readFileSync(SCRIPT_PATH, 'utf8');

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

/** A `readonly NAME='value'` constant of the report script. */
function scriptConstant(name: string): string {
  const value = new RegExp(`^readonly ${name}='([^']*)'$`, 'm').exec(script)?.[1];
  if (value === undefined) expect.unreachable(`${name} is not a plain constant in ${SCRIPT_PATH}`);
  return value;
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

  // Caddy proxies every page request to the web container. Filtering Caddy's
  // log is pointless if nginx behind it writes the same request line — reset
  // token, full forwarded address — into Docker's unbounded stdout log.
  it('is the only access log: the web container behind it writes none', () => {
    expect(readFileSync(NGINX_PATH, 'utf8')).toMatch(/^\s*access_log\s+off;\s*$/m);
  });
});

describe('access log retention', () => {
  // Caddy 2.10 rolls by size only. An entry waits in the live file until it
  // fills (F), is rolled, and the rolled file is deleted by the first roll or
  // restart after it turns roll_keep_for old — within one more fill. The worst
  // case is 2F + roll_keep_for. Keeping roll_keep_for to half the policy
  // leaves 15 days for 2F; at 2 MiB of ~2 KB lines that holds for anything
  // above ~140 requests a day. The report script warns if it ever does not.
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

describe('scripts/traffic-report.sh', () => {
  it('reads the compose project and the directory production writes to', () => {
    const release = readFileSync(RELEASE_PATH, 'utf8');
    const project = scriptConstant('COMPOSE_PROJECT');

    expect(release).toContain(`-p ${project} up -d --no-deps --force-recreate caddy`);
    expect(readFileSync(COMPOSE_PATH, 'utf8')).toMatch(new RegExp(`^name: ${project}$`, 'm'));
    expect(scriptConstant('LOG_DIR')).toBe(dirname('/data/logs/access.log'));
  });

  // FluxRadar sells AI-crawler readiness; the report should show the owner
  // every agent the audit reports on. Google-Extended is a robots.txt token
  // only — no request ever carries it as a user agent.
  it('groups every AI agent the audit checks under AI Crawlers', () => {
    const audited = /AI_CRAWLER_USER_AGENTS = \[([^\]]*)\]/.exec(
      readFileSync(AI_READINESS_PATH, 'utf8'),
    )?.[1];
    const grouped = /^readonly AI_CRAWLERS=\(([^)]*)\)$/m.exec(script)?.[1]?.split(/\s+/) ?? [];
    const robotsOnlyTokens = ['Google-Extended'];

    const agents = [...(audited ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents.filter((name) => !robotsOnlyTokens.includes(name))) {
      expect(grouped).toContain(agent);
    }
  });
});

describe('scripts/traffic-report.sh, run', () => {
  const workspaces: string[] = [];

  afterEach(() => {
    for (const workspace of workspaces.splice(0))
      rmSync(workspace, { recursive: true, force: true });
  });

  // Runs the remote command on this machine: the script arrives on stdin, as
  // it does over a real connection.
  const SSH_STUB = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_RECORD_DIR/ssh-args"
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift 2
exec "$@"
`;

  // `docker exec <id> sh -c <script> sh /data/logs` runs the script against
  // the fixture directory instead of the container's.
  const DOCKER_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_RECORD_DIR/docker-calls"
case "$1" in
  ps) echo 0123456789ab ;;
  exec) shift 2; exec "$1" "$2" "$3" "$4" "$FAKE_LOG_DIR" ;;
  *) exit 1 ;;
esac
`;

  const GOACCESS_STUB = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_RECORD_DIR/goaccess-args"
for arg in "$@"; do
  case "$arg" in
    --output=*) output="\${arg#--output=}" ;;
    --browsers-file=*) cp "\${arg#--browsers-file=}" "$FAKE_RECORD_DIR/browsers.list" ;;
  esac
done
cp "$1" "$output"
`;

  interface Fixture {
    readonly bin: string;
    readonly records: string;
    readonly logs: string;
    readonly reports: string;
    readonly workspace: string;
  }

  function fixture(options: { withGoaccess: boolean }): Fixture {
    const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-traffic-report-'));
    workspaces.push(workspace);
    const paths = {
      bin: join(workspace, 'bin'),
      records: join(workspace, 'records'),
      logs: join(workspace, 'logs'),
      reports: join(workspace, 'reports'),
      workspace,
    };
    for (const dir of [paths.bin, paths.records, paths.logs]) mkdirSync(dir);
    const stubs = {
      ssh: SSH_STUB,
      docker: DOCKER_STUB,
      ...(options.withGoaccess ? { goaccess: GOACCESS_STUB } : {}),
    };
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(join(paths.bin, name), body);
      chmodSync(join(paths.bin, name), 0o755);
    }
    return paths;
  }

  function run(
    paths: Fixture,
    args: readonly string[],
    systemPath = '/usr/bin:/bin',
  ): { status: number; stdout: string; stderr: string } {
    const result = spawnSync('/bin/bash', [SCRIPT_PATH, ...args], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        PATH: systemPath === '' ? paths.bin : `${paths.bin}:${systemPath}`,
        TMPDIR: paths.workspace,
        TRAFFIC_REPORT_DIR: paths.reports,
        FAKE_RECORD_DIR: paths.records,
        FAKE_LOG_DIR: paths.logs,
      },
    });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  function accessLine(ageSeconds: number, uri: string): string {
    return JSON.stringify({
      level: 'info',
      ts: Date.now() / 1000 - ageSeconds,
      logger: 'http.log.access.log0',
      msg: 'handled request',
      request: {
        remote_ip: '203.0.113.0',
        client_ip: '203.0.113.0',
        proto: 'HTTP/2.0',
        method: 'GET',
        host: 'fluxradar.net',
        uri,
        headers: { 'User-Agent': ['Mozilla/5.0 (compatible; GPTBot/1.2)'] },
      },
      duration: 0.001,
      size: 512,
      status: 200,
    });
  }

  it.each([
    ['no arguments', []],
    ['too many arguments', ['deploy@example.test', '7', 'extra']],
    ['a target that ssh would read as an option', ['-oProxyCommand=touch /tmp/pwned']],
    ['a zero-day window', ['deploy@example.test', '0']],
    ['a window past the retention period', ['deploy@example.test', '31']],
    ['a window that is not a number', ['deploy@example.test', 'week']],
  ])('refuses %s before it touches the server', (_case, args) => {
    const paths = fixture({ withGoaccess: true });

    const result = run(paths, args);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Usage: scripts/traffic-report.sh <user@host> [days]');
    expect(existsSync(join(paths.records, 'ssh-args'))).toBe(false);
  });

  it('says how to install goaccess when it is missing, before touching the server', () => {
    const paths = fixture({ withGoaccess: false });

    // Only the stubs on PATH: everything up to the goaccess check is a builtin.
    const result = run(paths, ['deploy@example.test'], '');

    expect(result.status).toBe(127);
    expect(result.stderr).toContain('brew install goaccess');
    expect(existsSync(join(paths.records, 'ssh-args'))).toBe(false);
  });

  it('reports the last N days out of the rotated and the live logs, and warns about an overdue entry', () => {
    const paths = fixture({ withGoaccess: true });
    const expired = accessLine(40 * SECONDS_PER_DAY, '/expired');
    const rotated = accessLine(3 * SECONDS_PER_DAY, '/rotated');
    const live = accessLine(3600, '/live');
    writeFileSync(
      join(paths.logs, 'access-2026-09-18T00-00-00.000.log.gz'),
      gzipSync(`${expired}\n${rotated}\n`),
    );
    writeFileSync(join(paths.logs, 'access.log'), `${live}\n`);

    const result = run(paths, ['deploy@example.test', '7']);

    expect(result.stderr).toContain('past the 30 days the Privacy Policy allows');
    expect(result.status).toBe(0);
    const reportPath = /: (\/\S+\.html)$/m.exec(result.stdout)?.[1] ?? '';
    expect(result.stdout).toContain('Traffic report (2 requests, last 7 days)');
    expect(dirname(reportPath)).toBe(paths.reports);
    expect(readFileSync(reportPath, 'utf8')).toBe(`${rotated}\n${live}\n`);

    const sshArgs = readFileSync(join(paths.records, 'ssh-args'), 'utf8').split('\n');
    expect(sshArgs.slice(sshArgs.indexOf('--'), sshArgs.indexOf('--') + 6)).toEqual([
      '--',
      'deploy@example.test',
      'sh',
      '-s',
      '--',
      'fluxradar',
    ]);
    const dockerCalls = readFileSync(join(paths.records, 'docker-calls'), 'utf8');
    expect(dockerCalls).toContain('label=com.docker.compose.project=fluxradar');
    expect(dockerCalls).toContain('label=com.docker.compose.service=caddy');
    expect(dockerCalls).toMatch(/sh \/data\/logs$/m);
    expect(readFileSync(join(paths.records, 'goaccess-args'), 'utf8')).toContain(
      '--log-format=CADDY',
    );
    expect(readFileSync(join(paths.records, 'browsers.list'), 'utf8')).toContain(
      'GPTBot\tAI Crawlers\n',
    );
  });
});
