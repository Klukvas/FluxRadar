import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-007: the public smoke test has to be able to fail.
//
// The previous version could not. It ran `curl --insecure`, which accepts an
// expired, self-signed or wrong-host certificate; it asserted nothing about the
// status code or the body; and when the hostname did not resolve it printed
// "internal smoke test passed" and exited 0. Every failure it existed to catch —
// no DNS, no certificate, a proxy serving someone else's page — was reported as
// a successful deploy.
//
// So the checks are run here against a real TLS server with a self-signed
// certificate: trusted through --cacert for the passing cases, untrusted for the
// case that must fail. Status, body and header assertions are exercised by
// making the server answer wrongly, one way at a time.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'public-smoke.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

const execFileAsync = promisify(execFile);

interface Behaviour {
  status: number;
  healthBody: string;
  readyBody: string;
  documentBody: string;
  hstsHeader: boolean;
  cspHeader: boolean;
}

interface TlsSite {
  readonly baseUrl: string;
  readonly caPath: string;
  readonly behaviour: Behaviour;
  close: () => Promise<void>;
}

let certificateDirectory: string;

beforeAll(() => {
  certificateDirectory = mkdtempSync(join(tmpdir(), 'fluxradar-smoke-tls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(certificateDirectory, 'key.pem'),
      '-out',
      join(certificateDirectory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'pipe' },
  );
});

afterAll(() => {
  rmSync(certificateDirectory, { recursive: true, force: true });
});

const sites: TlsSite[] = [];

afterEach(async () => {
  for (const site of sites.splice(0)) await site.close();
});

/** A TLS site that answers the three endpoints the smoke test checks. */
async function startSite(overrides: Partial<Behaviour> = {}): Promise<TlsSite> {
  const behaviour: Behaviour = {
    status: 200,
    healthBody: JSON.stringify({ ok: true, data: { service: 'api', status: 'ok' }, error: null }),
    readyBody: JSON.stringify({ ok: true, data: { status: 'ready' }, error: null }),
    documentBody: '<!doctype html><html><head><title>FluxRadar — audits</title></head></html>',
    hstsHeader: true,
    cspHeader: true,
    ...overrides,
  };
  const server: Server = createServer(
    {
      key: readFileSync(join(certificateDirectory, 'key.pem')),
      cert: readFileSync(join(certificateDirectory, 'cert.pem')),
    },
    (request, response) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      let body: string;
      if (request.url === '/api/health') body = behaviour.healthBody;
      else if (request.url === '/api/health/ready') body = behaviour.readyBody;
      else if (request.url === '/') {
        body = behaviour.documentBody;
        headers['content-type'] = 'text/html';
        if (behaviour.hstsHeader) {
          headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
        }
        if (behaviour.cspHeader) {
          headers['content-security-policy'] = "default-src 'self'";
        }
      } else {
        response.writeHead(404).end('not found');
        return;
      }
      response.writeHead(behaviour.status, headers).end(body);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const site: TlsSite = {
    baseUrl: `https://localhost:${port}`,
    caPath: join(certificateDirectory, 'cert.pem'),
    behaviour,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  sites.push(site);
  return site;
}

async function runSmoke(args: readonly string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [SCRIPT_PATH, ...args], {
      encoding: 'utf8',
    });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

/** One attempt, no retry delay: every failing case here is deterministic. */
function fast(site: TlsSite, trusted = true): readonly string[] {
  return [
    '--host',
    'localhost',
    '--base-url',
    site.baseUrl,
    '--attempts',
    '1',
    '--delay',
    '1',
    ...(trusted ? ['--cacert', site.caPath] : []),
  ];
}

describe('DEPLOY-007 public smoke test', () => {
  describe('the shipped script', () => {
    const script = readFileSync(SCRIPT_PATH, 'utf8');
    /** Comments may name --insecure; the executable lines may not use it. */
    const executableLines = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    it('never disables certificate verification', () => {
      expect(executableLines).not.toMatch(/--insecure/);
      expect(executableLines).not.toMatch(/(^|\s)-k(\s|$)/);
      expect(executableLines).not.toMatch(/--proxy-insecure/);
      expect(executableLines).not.toMatch(/--ssl-no-revoke/);
    });

    it('pins https end to end', () => {
      expect(script).toContain("--proto '=https'");
      expect(script).toContain("--proto-redir '=https'");
    });

    it('passes on a healthy site, checking status, body and header', async () => {
      const site = await startSite();
      const result = await runSmoke(fast(site));
      expect(result.output).toContain('public smoke passed');
      expect(result.ok).toBe(true);
    });

    it('fails on a certificate it cannot verify', async () => {
      const site = await startSite();
      const result = await runSmoke(fast(site, false));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('TLS');
      expect(result.output).toContain('public smoke failed');
    });

    it('fails when the hostname does not resolve', async () => {
      const result = await runSmoke([
        '--host',
        'fluxradar-does-not-exist.invalid',
        '--attempts',
        '1',
        '--delay',
        '1',
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/does not resolve|DNS/);
      // The exact regression: this used to print a pass and exit 0.
      expect(result.output).not.toContain('passed');
    });

    it('fails on a non-200 status', async () => {
      const site = await startSite({ status: 503 });
      const result = await runSmoke(fast(site));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('HTTP 503');
    });

    it('fails when the API answers 200 with the wrong body', async () => {
      const site = await startSite({ healthBody: '{"ok":true,"data":{"status":"maintenance"}}' });
      const result = await runSmoke(fast(site));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('/api/health');
      expect(result.output).toContain('does not match');
    });

    it('fails when readiness reports the database is not reachable', async () => {
      const site = await startSite({ readyBody: '{"ok":false,"data":{"status":"not-ready"}}' });
      const result = await runSmoke(fast(site));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('/api/health/ready');
    });

    it('fails when the document is not FluxRadar', async () => {
      const site = await startSite({
        documentBody: '<!doctype html><html><head><title>Welcome to nginx</title></head></html>',
      });
      const result = await runSmoke(fast(site));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('does not match');
    });

    it('fails when the security header the Caddyfile sets is missing', async () => {
      const site = await startSite({ hstsHeader: false });
      const result = await runSmoke(fast(site));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('missing the header');
    });

    // The policy that keeps the paid checkout working and inline script out is
    // set in one file and read by nobody afterwards, so a Caddyfile edit could
    // drop it and every other check would still pass.
    it('fails when the Content-Security-Policy is missing', async () => {
      const site = await startSite({ cspHeader: false });
      const result = await runSmoke(fast(site));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('content-security-policy');
    });

    it('refuses a plaintext target outright', async () => {
      const result = await runSmoke(['--base-url', 'http://localhost:1', '--attempts', '1']);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('must be https://');
    });
  });

  describe('the deploy workflow step', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const begin = workflow.indexOf('# fluxradar:public-smoke-invocation');
    const end = workflow.indexOf('# fluxradar:end-public-smoke-invocation');
    const invocation = workflow.slice(begin, end);

    it('calls the script for the production hostname', () => {
      expect(begin).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(begin);
      expect(invocation).toContain('deploy/public-smoke.sh --host fluxradar.net');
    });

    it('runs it from the runner, not over SSH on the server itself', () => {
      expect(invocation).not.toContain('ssh ');
    });

    it('has no way left to pass while DNS or TLS is broken', () => {
      const step = workflow.slice(workflow.indexOf('      - name: Public smoke test'));
      expect(step).not.toContain('DNS for fluxradar.net is not configured yet');
      expect(step).not.toContain('internal smoke test passed');
      // The only `exit 0` is the one the script's own success produces.
      expect(step.split('exit 0')).toHaveLength(2);
      expect(step.trimEnd().endsWith('exit 1')).toBe(true);
    });
  });
});
