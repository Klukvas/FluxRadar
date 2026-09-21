import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT, testDatabaseUrl } from '../test-utils/template-db.ts';
import { createTestDb, seedAccountWithProfile, type TestDb } from '../test-utils/test-db.ts';

// DEPLOY-006: the rollback probe must not be able to change production.
//
// The deploy proves an automatic rollback is safe by starting the PREVIOUS
// release's image against the migrated database. It used to start it with the
// image's ordinary production command — a full API instance. That instance, on
// boot and on timers, sweeps data retention (deleting expired scans, reports and
// webhook rows), recovers and CLAIMS queued scan jobs, drains the queue (real
// crawls, real AI calls, real customer email) and sweeps pending refunds. All of
// it against the live database, from a container the deploy removes seconds
// later, while the release being deployed is doing the same work.
//
// So the container is now started with an inert command and the questions the
// readiness probe used to answer are asked directly, read-only. Two halves are
// checked here:
//   1. statically — the workflow's own `docker run` lines, extracted between
//      markers, override the entrypoint and never fall back to the image CMD;
//   2. against a real database — the probe passes on a healthy environment,
//      fails closed on one the previous release would reject, and writes
//      nothing, because its transaction is READ ONLY.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const RELEASE_SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'release.sh');
const PROBE_PATH = join(REPO_ROOT, 'deploy', 'rollback-readonly-probe.cjs');
const BEGIN_MARKER = '# fluxradar:rollback-probe-container';
const END_MARKER = '# fluxradar:end-rollback-probe-container';

const execFileAsync = promisify(execFile);

/** The release script's own probe-container lines, between the markers. */
function extractProbeContainerBlock(): string {
  const lines = readFileSync(RELEASE_SCRIPT_PATH, 'utf8').split('\n');
  const begin = lines.findIndex((line) => line.trim().startsWith(BEGIN_MARKER));
  const end = lines.findIndex((line) => line.trim().startsWith(END_MARKER));
  expect(begin, `${BEGIN_MARKER} is missing from deploy/release.sh`).toBeGreaterThan(-1);
  expect(end, `${END_MARKER} is missing from deploy/release.sh`).toBeGreaterThan(begin);
  const block = lines.slice(begin, end + 1);
  const indent = (block[0] ?? '').length - (block[0] ?? '').trimStart().length;
  return block.map((line) => line.slice(indent)).join('\n');
}

/** The whole release script, as it ships in deploy/release.sh. */
function startReleaseScript(): string {
  return readFileSync(RELEASE_SCRIPT_PATH, 'utf8');
}

/**
 * The gate itself: from the probe container to the line that starts the new
 * release's containers.
 *
 * The end marker is searched for AFTER the start, because `rollback()` — which
 * is defined earlier in the same script — contains the same `docker rm -f`
 * line, and an earlier match would silently produce an empty section that every
 * assertion then passes against.
 */
function rollbackGateSection(script: string): string {
  // Anchored on the gate's own banner rather than on the probe name: the
  // container name is now declared once at the top of the script, so the exit
  // handler can remove it on a path that never reached this gate.
  const start = script.indexOf('# ---- Rollback compatibility gate');
  expect(start).toBeGreaterThan(-1);
  const end = script.indexOf('docker rm -f "$API_CONTAINER" "$WEB_CONTAINER"', start);
  expect(end).toBeGreaterThan(start);
  return script.slice(start, end);
}

async function runProbe(
  databaseUrl: string,
  env: Readonly<Record<string, string>> = {},
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [PROBE_PATH], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'production',
        FLUXRADAR_PROBE_APP_DIR: REPO_ROOT,
        DATABASE_URL: databaseUrl,
        INTEGRATION_ENCRYPTION_KEY: 'probe-test-integration-key',
        ...env,
      },
    });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('DEPLOY-006 rollback probe is read-only', () => {
  describe('the container the workflow starts', () => {
    const block = extractProbeContainerBlock();

    it('overrides the image entrypoint instead of running the production command', () => {
      expect(block).toContain('--entrypoint node');
      // The command is an idle timer, not the API. `node apps/api/dist/index.js`
      // is what must never appear here.
      expect(block).toContain('setInterval');
      expect(block).not.toContain('dist/index.js');
    });

    it('still gives the previous release the environment it would boot with', () => {
      expect(block).toContain('--env-file "$RELEASE_DIR/.env.production"');
      expect(block).toContain('--env NODE_ENV=production');
      expect(block).toContain('--network "$FLUXRADAR_NETWORK"');
    });

    it('runs no migration and no restart policy on the probe container', () => {
      expect(block).not.toContain('migrate deploy');
      expect(block).not.toContain('--restart');
    });
  });

  describe('the deploy step around it', () => {
    const script = startReleaseScript();

    it('executes both probes inside that container', () => {
      expect(script).toContain('node /tmp/rollback-readonly-probe.cjs');
      expect(script).toContain('node /tmp/rollback-schema-probe.cjs');
    });

    it('no longer waits on the previous release answering /health/ready', () => {
      // The old gate booted the server to reach this endpoint. The API container
      // of the release being deployed is still probed this way — that one is
      // supposed to serve traffic — so the assertion is specifically that the
      // ROLLBACK probe container is not.
      const probeSection = rollbackGateSection(script);
      expect(probeSection.length).toBeGreaterThan(0);
      expect(probeSection).not.toContain('health/ready');
    });

    it('removes the probe container on every exit path', () => {
      const probeSection = rollbackGateSection(script);
      const failures = probeSection.split('exit 1').length - 1;
      expect(failures).toBeGreaterThan(0);
      const removals = probeSection.split('docker rm -f "$ROLLBACK_PROBE"').length - 1;
      // One removal per failure path, plus the one after a successful probe.
      expect(removals).toBeGreaterThanOrEqual(failures + 1);
    });

    it('is still a hard gate: a failing probe stops the deploy before any switch', () => {
      const probeIndex = script.indexOf('node /tmp/rollback-schema-probe.cjs');
      const switchIndex = script.indexOf('atomic_switch "$RELEASE_DIR"');
      expect(probeIndex).toBeGreaterThan(-1);
      expect(switchIndex).toBeGreaterThan(probeIndex);
    });
  });

  describe('against a database', () => {
    let db: TestDb;

    beforeEach(async () => {
      db = await createTestDb();
    });

    afterEach(async () => {
      await db.cleanup();
    });

    it('passes when the previous release would accept this environment', async () => {
      const result = await runProbe(testDatabaseUrl());
      expect(result.output).toContain('boot-surface probe OK');
      expect(result.output).toContain('read-only transaction');
      expect(result.ok).toBe(true);
    });

    it('writes nothing while it runs', async () => {
      const account = await seedAccountWithProfile(db.prisma);
      const before = {
        accounts: await db.prisma.account.count(),
        profiles: await db.prisma.siteProfile.count(),
        scans: await db.prisma.scan.count(),
      };

      const result = await runProbe(testDatabaseUrl());
      expect(result.ok).toBe(true);

      expect(await db.prisma.account.count()).toBe(before.accounts);
      expect(await db.prisma.siteProfile.count()).toBe(before.profiles);
      expect(await db.prisma.scan.count()).toBe(before.scans);
      // The row the probe ran beside is still exactly where it was — the old
      // gate's retention sweep is the thing that could have removed it.
      expect(await db.prisma.siteProfile.count({ where: { id: account.siteProfileId } })).toBe(1);
    });

    it('fails closed when the previous release requires a variable this env lacks', async () => {
      const result = await runProbe(testDatabaseUrl(), { INTEGRATION_ENCRYPTION_KEY: '' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain('boot-surface probe FAILED');
      expect(result.output).toContain('INTEGRATION_ENCRYPTION_KEY');
    });

    it('fails closed on a half-configured integration', async () => {
      const result = await runProbe(testDatabaseUrl(), { FASTSPRING_MODE: 'test' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain('boot-surface probe FAILED');
      expect(result.output).toContain('FASTSPRING_API_USERNAME');
    });

    it('fails closed when the database cannot be reached with this env file', async () => {
      const unreachable = testDatabaseUrl().replace(/:\d+\//, ':5999/');
      const result = await runProbe(unreachable);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('boot-surface probe could not run');
    });

    it('names no secret value in its output', async () => {
      const secret = `sentinel-${randomUUID()}`;
      const result = await runProbe(testDatabaseUrl(), {
        INTEGRATION_ENCRYPTION_KEY: secret,
      });
      expect(result.ok).toBe(true);
      expect(result.output).not.toContain(secret);
    });
  });
});
