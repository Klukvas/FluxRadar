import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-011: the rollback itself.
//
// deploy/rollback-release.sh is the single rollback both callers run — the
// release script's exit handler while it is still running, and the public smoke
// test on the GitHub runner after that script has exited successfully. It is a
// file rather than a shell function precisely because of the second caller.
//
// What it replaced was inline and guarded by
// `[ -f "$PREVIOUS_RELEASE/docker-compose.yml" ]`. A previous release whose
// directory had been swept off the disk failed that test, so the entire rollback
// silently did nothing while the deploy log announced one — Caddy kept the
// failed release's upstreams, whose containers had just been removed. The
// property under test everywhere below is therefore not "it tried", but:
//
//   * either the previous release is serving again — PROVEN by a probe, not
//     assumed from a rewritten Caddyfile — and it says ROLLBACK OK,
//   * or it says why it could not and exits non-zero.
//
// Never both, and never neither. The script is run for real against a recorded
// `docker` and `curl`, so what is asserted is the state an operator would find
// afterwards.
//
// Two later regressions are pinned here as well:
//
//   * a rollback with NO target (the first deploy of a host) removed the only
//     API and web containers on the box and exited 1, so a failed smoke test
//     became a host serving nothing at all. It must now change nothing and exit
//     3, which is the code both callers branch on;
//   * with the target's images missing and no usable recorded upstreams, the
//     script rewrote Caddy to a dead `api:3310` / `web:80` and exited 0 —
//     ROLLBACK OK for a production that answered nothing.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'rollback-release.sh');

const TARGET_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FAILED_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const RECORDED_API_UPSTREAM = '10.9.9.1:3310';
const RECORDED_WEB_UPSTREAM = '10.9.9.2:80';
/** Addresses a container that had to be recreated comes back on. */
const REBUILT_API_UPSTREAM = '10.9.9.71:3310';
const REBUILT_WEB_UPSTREAM = '10.9.9.72:80';
const FAILED_API_UPSTREAM = '10.10.0.5:3310';
const FAILED_WEB_UPSTREAM = '10.10.0.5:80';
/** Exit code that means "there was nothing to roll back to, so nothing changed". */
const NO_TARGET_EXIT_CODE = 3;

/**
 * A `docker` that records every call and answers the questions the rollback
 * asks. Each switch below is one real-world state the rollback has to survive.
 */
const DOCKER_RECORDER = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$1" in
  compose)
    case "$*" in
      *"ps -q postgres"*)
        if [ "$NO_POSTGRES" != "1" ]; then printf 'postgres-container\n'; fi ;;
      *"force-recreate caddy"*)
        if [ "$FAIL_CADDY_UP" = "1" ]; then echo 'compose refused to start caddy' >&2; exit 1; fi ;;
    esac ;;
  image)
    if [ "$MISSING_IMAGES" = "1" ]; then exit 1; fi ;;
  container)
    # "docker container inspect" is how the script asks whether the previous
    # release's container is still there at all. After a SUCCESSFUL deploy it is
    # not: the release script removes it, which is the state the public smoke
    # test's rollback finds.
    if [ "$MISSING_CONTAINERS" = "1" ]; then exit 1; fi ;;
  start)
    if [ "$FAIL_START" = "1" ]; then echo 'container refused to start' >&2; exit 1; fi ;;
  exec)
    # The readiness probes the rollback runs inside the restored containers,
    # answered the way a container that is gone or wedged answers them.
    case "$*" in
      *health/ready*|*wget*)
        if [ "$DEAD_CONTAINERS" = "1" ]; then exit 1; fi ;;
    esac ;;
  inspect)
    case "$*" in
      *IPAddress*)
        case "$*" in
          *"fluxradar-api-$TARGET_RELEASE_ID"*)
            if [ "$MISSING_CONTAINERS" = "1" ]; then printf '%s\n' "$REBUILT_API_IP"
            else printf '%s\n' "$RECORDED_API_IP"; fi ;;
          *"fluxradar-web-$TARGET_RELEASE_ID"*)
            if [ "$MISSING_CONTAINERS" = "1" ]; then printf '%s\n' "$REBUILT_WEB_IP"
            else printf '%s\n' "$RECORDED_WEB_IP"; fi ;;
          *) printf '%s\n' "$FAILED_CONTAINER_IP" ;;
        esac ;;
      *"State.Running"*)
        if [ "$STOPPED_CONTAINERS" = "1" ]; then printf 'false\n'; else printf 'true\n'; fi ;;
      *NetworkSettings.Networks*) printf 'fluxradar_default\n' ;;
    esac ;;
esac
exit 0
`;

/**
 * The loopback probe through Caddy: the rollback asks the public hostname,
 * resolved to 127.0.0.1, whether the restored upstreams answer. DEAD_UPSTREAMS
 * is a Caddy that is up and proxying to nothing — the state the script used to
 * call ROLLBACK OK.
 */
const CURL_RECORDER = String.raw`#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$DOCKER_LOG"
if [ "$DEAD_UPSTREAMS" = "1" ]; then exit 22; fi
printf '{"status":"ok"}\n'
`;

/** GNU "mv -T" where the platform has none; the script needs it for `current`. */
const MV_SHIM = String.raw`#!/usr/bin/env bash
if [ "$MV_EMULATE_T" = "1" ]; then
  case "$1" in
    -Tf|-fT) shift; rm -f -- "$2"; exec /bin/mv -f -- "$1" "$2" ;;
  esac
fi
exec /bin/mv "$@"
`;

const CADDYFILE_TEMPLATE = [
  'fluxradar.net {',
  '  reverse_proxy /api/* {$FLUXRADAR_API_UPSTREAM}',
  '  reverse_proxy {$FLUXRADAR_WEB_UPSTREAM}',
  '}',
  '',
].join('\n');

/** A template with nothing to substitute: the rendered file cannot be right. */
const CADDYFILE_WITHOUT_PLACEHOLDERS = 'fluxradar.net {\n  reverse_proxy 127.0.0.1:1\n}\n';

interface Rollback {
  readonly exitCode: number;
  readonly output: string;
  currentReleaseId: () => string;
  runtimeCaddyfile: () => string;
  stateFile: () => string;
  dockerCalls: () => readonly string[];
}

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function makeRelease(appDir: string, releaseId: string, caddyfile: string): string {
  const releaseDir = join(appDir, 'releases', releaseId);
  mkdirSync(join(releaseDir, 'deploy'), { recursive: true });
  writeFileSync(join(releaseDir, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(releaseDir, '.env.production'), 'POSTGRES_DB=fluxradar\n');
  writeFileSync(join(releaseDir, 'deploy', 'Caddyfile'), caddyfile);
  return releaseDir;
}

interface Options {
  /** The failed release's directory is gone too (both were swept). */
  readonly pruneTarget?: boolean;
  readonly recordTarget?: boolean;
  /**
   * runtime/rollback.env exists and names an EMPTY release — which is exactly
   * what the release script writes on the first deploy of a host, because there
   * was no previous release to record.
   */
  readonly emptyTarget?: boolean;
  readonly recordUpstreams?: boolean;
  readonly failedCaddyfile?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * A server where FAILED_ID is live and TARGET_ID is the release before it —
 * the state every rollback starts from.
 */
function runRollback(options: Options = {}): Rollback {
  const appDir = realpathSync(mkdtempSync(join(tmpdir(), 'fluxradar-rollback-')));
  workspaces.push(appDir);

  const targetDir = makeRelease(appDir, TARGET_ID, CADDYFILE_TEMPLATE);
  const failedDir = makeRelease(appDir, FAILED_ID, options.failedCaddyfile ?? CADDYFILE_TEMPLATE);
  symlinkSync(failedDir, join(appDir, 'current'));
  if (options.pruneTarget) rmSync(targetDir, { recursive: true, force: true });

  const runtimeDir = join(appDir, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  // Production as the failed release left it: Caddy on the failed upstreams.
  writeFileSync(
    join(runtimeDir, 'Caddyfile'),
    CADDYFILE_TEMPLATE.replace('{$FLUXRADAR_API_UPSTREAM}', FAILED_API_UPSTREAM).replace(
      '{$FLUXRADAR_WEB_UPSTREAM}',
      FAILED_WEB_UPSTREAM,
    ),
  );
  writeFileSync(
    join(runtimeDir, 'active.env'),
    [
      `FLUXRADAR_ACTIVE_RELEASE=${failedDir}`,
      `FLUXRADAR_API_UPSTREAM=${FAILED_API_UPSTREAM}`,
      `FLUXRADAR_WEB_UPSTREAM=${FAILED_WEB_UPSTREAM}`,
      `FLUXRADAR_API_CONTAINER=fluxradar-api-${FAILED_ID}`,
      `FLUXRADAR_WEB_CONTAINER=fluxradar-web-${FAILED_ID}`,
      '',
    ].join('\n'),
  );
  if (options.emptyTarget) {
    // Byte for byte what record_rollback_target writes when PREVIOUS_RELEASE is
    // empty: every key present, every value blank.
    writeFileSync(
      join(runtimeDir, 'rollback.env'),
      [
        'FLUXRADAR_ROLLBACK_RELEASE=',
        'FLUXRADAR_ROLLBACK_RELEASE_ID=',
        'FLUXRADAR_ROLLBACK_API_UPSTREAM=',
        'FLUXRADAR_ROLLBACK_WEB_UPSTREAM=',
        'FLUXRADAR_ROLLBACK_API_CONTAINER=',
        'FLUXRADAR_ROLLBACK_WEB_CONTAINER=',
        '',
      ].join('\n'),
    );
  } else if (options.recordTarget !== false) {
    writeFileSync(
      join(runtimeDir, 'rollback.env'),
      [
        `FLUXRADAR_ROLLBACK_RELEASE=${targetDir}`,
        `FLUXRADAR_ROLLBACK_RELEASE_ID=${TARGET_ID}`,
        `FLUXRADAR_ROLLBACK_API_UPSTREAM=${options.recordUpstreams === false ? '' : RECORDED_API_UPSTREAM}`,
        `FLUXRADAR_ROLLBACK_WEB_UPSTREAM=${options.recordUpstreams === false ? '' : RECORDED_WEB_UPSTREAM}`,
        `FLUXRADAR_ROLLBACK_API_CONTAINER=fluxradar-api-${TARGET_ID}`,
        `FLUXRADAR_ROLLBACK_WEB_CONTAINER=fluxradar-web-${TARGET_ID}`,
        '',
      ].join('\n'),
    );
  }

  const binDir = join(appDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(join(binDir, 'docker'), DOCKER_RECORDER);
  writeExecutable(join(binDir, 'curl'), CURL_RECORDER);
  writeExecutable(join(binDir, 'mv'), MV_SHIM);
  const dockerLog = join(appDir, 'docker.log');

  // spawnSync, not execFileSync: the warnings and refusals under test are
  // written to stderr, and they matter as much on the success path as on the
  // failure one — a DEGRADED rollback exits 0 and still has to say so.
  const result = spawnSync('bash', [SCRIPT_PATH, appDir, failedDir], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      HOME: appDir,
      DOCKER_LOG: dockerLog,
      TARGET_RELEASE_ID: TARGET_ID,
      RECORDED_API_IP: RECORDED_API_UPSTREAM.split(':')[0] as string,
      RECORDED_WEB_IP: RECORDED_WEB_UPSTREAM.split(':')[0] as string,
      REBUILT_API_IP: REBUILT_API_UPSTREAM.split(':')[0] as string,
      REBUILT_WEB_IP: REBUILT_WEB_UPSTREAM.split(':')[0] as string,
      FAILED_CONTAINER_IP: FAILED_API_UPSTREAM.split(':')[0] as string,
      MV_EMULATE_T: process.platform === 'linux' ? '0' : '1',
      MISSING_CONTAINERS: '',
      STOPPED_CONTAINERS: '',
      MISSING_IMAGES: '',
      NO_POSTGRES: '',
      FAIL_CADDY_UP: '',
      FAIL_START: '',
      DEAD_UPSTREAMS: '',
      DEAD_CONTAINERS: '',
      // The probe's production bound is 15 attempts two seconds apart. Here the
      // answer never changes between attempts, so a few of them with no delay
      // exercises the same loop without spending 30s per failing case.
      FLUXRADAR_ROLLBACK_PROBE_ATTEMPTS: '3',
      FLUXRADAR_ROLLBACK_PROBE_DELAY: '0',
      ...options.env,
    },
  });

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    currentReleaseId: () => {
      try {
        const target = readlinkSync(join(appDir, 'current'));
        return target.slice(target.lastIndexOf('/') + 1);
      } catch {
        return '';
      }
    },
    runtimeCaddyfile: () => readFileSync(join(runtimeDir, 'Caddyfile'), 'utf8'),
    stateFile: () => readFileSync(join(runtimeDir, 'active.env'), 'utf8'),
    dockerCalls: () => {
      try {
        return readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

/** The failed release must never keep running, whatever else happened. */
function removedFailedContainers(calls: readonly string[]): boolean {
  return calls.some(
    (call) => call.startsWith('rm -f') && call.includes(`fluxradar-api-${FAILED_ID}`),
  );
}

/** The rollback asked the restored site whether it answers, from this host. */
function probedThroughCaddy(calls: readonly string[]): boolean {
  return calls.some((call) => call.startsWith('curl ') && call.includes('fluxradar.net'));
}

function expectRestored(rollback: Rollback, api: string, web: string): void {
  expect(rollback.exitCode).toBe(0);
  expect(rollback.output).toContain('ROLLBACK OK');
  expect(rollback.runtimeCaddyfile()).toContain(api);
  expect(rollback.runtimeCaddyfile()).toContain(web);
  expect(rollback.runtimeCaddyfile()).not.toContain(FAILED_API_UPSTREAM);
  expect(rollback.currentReleaseId()).toBe(TARGET_ID);
  expect(rollback.stateFile()).toContain(`FLUXRADAR_API_UPSTREAM=${api}`);
  expect(rollback.stateFile()).toContain(`FLUXRADAR_ACTIVE_RELEASE=`);
  expect(removedFailedContainers(rollback.dockerCalls())).toBe(true);
  // ROLLBACK OK is a statement about production, so it is never printed on the
  // strength of a rewritten configuration file alone.
  expect(probedThroughCaddy(rollback.dockerCalls())).toBe(true);
}

/** It could not restore, and it is not pretending otherwise. */
function expectRefused(rollback: Rollback, reason: string): void {
  expect(rollback.exitCode).not.toBe(0);
  expect(rollback.output).toContain(reason);
  expect(rollback.output).not.toContain('ROLLBACK OK');
  // Even a refusal removes the release that failed — it is being replaced, and
  // it runs against the production database. The one exception is a rollback
  // with no target at all, which replaces nothing; see expectNothingTouched.
  expect(removedFailedContainers(rollback.dockerCalls())).toBe(true);
}

/**
 * The first-deploy contract: a rollback that has nowhere to go changes NOTHING.
 * No container removed, no Caddy recreated, no state rewritten — the release
 * that failed is still whatever is in front of traffic, and the log says so.
 */
function expectNothingTouched(rollback: Rollback): void {
  expect(rollback.exitCode).toBe(NO_TARGET_EXIT_CODE);
  expect(rollback.output).toContain('ROLLBACK IMPOSSIBLE');
  expect(rollback.output).toContain('CRITICAL');
  expect(rollback.output).toContain('NOTHING has been changed');
  expect(rollback.output).not.toContain('ROLLBACK OK');
  expect(rollback.dockerCalls()).toEqual([]);
  expect(rollback.runtimeCaddyfile()).toContain(FAILED_API_UPSTREAM);
  expect(rollback.stateFile()).toContain(`FLUXRADAR_API_UPSTREAM=${FAILED_API_UPSTREAM}`);
  expect(rollback.currentReleaseId()).toBe(FAILED_ID);
}

describe('DEPLOY-011 rollback-release.sh', () => {
  it('puts the previous release back while its containers are still running', () => {
    const rollback = runRollback();
    expectRestored(rollback, RECORDED_API_UPSTREAM, RECORDED_WEB_UPSTREAM);
    expect(rollback.stateFile()).toContain(`FLUXRADAR_API_CONTAINER=fluxradar-api-${TARGET_ID}`);
  });

  // The case the public smoke test hits: the release script finished, so it has
  // already removed the previous release's containers. A rollback that only
  // repointed Caddy would point it at containers that no longer exist.
  it('recreates the previous release when its containers are gone, and uses their new addresses', () => {
    const rollback = runRollback({ env: { MISSING_CONTAINERS: '1' } });
    expectRestored(rollback, REBUILT_API_UPSTREAM, REBUILT_WEB_UPSTREAM);
    const started = rollback
      .dockerCalls()
      .filter((call) => call.startsWith('run -d') && call.includes(`fluxradar-api-${TARGET_ID}`));
    expect(started).toHaveLength(1);
    expect(started[0]).toContain(`fluxradar-api:${TARGET_ID}`);
    expect(started[0]).toContain('--restart unless-stopped');
    // On the env file the deploy's rollback gate already started this image
    // against — the failed release's — not the one it happened to run on before
    // the migration.
    expect(started[0]).toContain(`releases/${FAILED_ID}/.env.production`);
    // The recorded addresses are stale after a recreate; they must not be used.
    expect(rollback.runtimeCaddyfile()).not.toContain(RECORDED_API_UPSTREAM);
  });

  it('starts the previous release again when its containers are merely stopped', () => {
    const rollback = runRollback({ env: { STOPPED_CONTAINERS: '1' } });
    expectRestored(rollback, RECORDED_API_UPSTREAM, RECORDED_WEB_UPSTREAM);
    expect(rollback.dockerCalls().some((call) => call === `start fluxradar-api-${TARGET_ID}`)).toBe(
      true,
    );
  });

  // THE REGRESSION. The previous implementation checked for exactly this file
  // and, not finding it, returned without doing anything at all.
  it('still restores traffic when the target release directory was swept off disk', () => {
    const rollback = runRollback({ pruneTarget: true });
    expect(rollback.output).toContain('no longer holds docker-compose.yml');
    expect(rollback.output).toContain('ROLLBACK OK (DEGRADED)');
    expect(rollback.exitCode).toBe(0);
    expect(rollback.runtimeCaddyfile()).toContain(RECORDED_API_UPSTREAM);
    expect(rollback.runtimeCaddyfile()).not.toContain(FAILED_API_UPSTREAM);
    expect(rollback.currentReleaseId()).toBe(TARGET_ID);
  });

  // THE FIRST-DEPLOY REGRESSION. The failed release's containers were removed
  // before anything checked whether a rollback target existed, so on the first
  // deploy of a host — where it never does — a failed public smoke test deleted
  // the only API and web containers on the box and exited 1. The deploy failed
  // either way; the difference is that the host then served nothing at all.
  describe('when there is no release to roll back to', () => {
    it('tears nothing down and says so, for a rollback.env that names no release', () => {
      // The exact first-deploy artefact: record_rollback_target ran with an
      // empty PREVIOUS_RELEASE, so every key is present and blank.
      const rollback = runRollback({ emptyTarget: true });
      expectNothingTouched(rollback);
      expect(rollback.output).toContain('manual action required');
    });

    it('tears nothing down when rollback.env was never written at all', () => {
      const rollback = runRollback({ recordTarget: false });
      expectNothingTouched(rollback);
    });

    it('exits 3 so a caller can tell it apart from a rollback that failed', () => {
      // 1 means "it tried and could not"; 3 means "there was nothing to try and
      // the release you deployed is still up". deploy.yml branches on this.
      expect(runRollback({ emptyTarget: true }).exitCode).toBe(NO_TARGET_EXIT_CODE);
      expect(runRollback({ env: { FAIL_CADDY_UP: '1' } }).exitCode).toBe(1);
    });
  });

  it('refuses when the target has neither its own images nor a recorded address', () => {
    const rollback = runRollback({
      pruneTarget: true,
      recordUpstreams: false,
      env: { MISSING_IMAGES: '1' },
    });
    expectRefused(rollback, 'ROLLBACK FAILED');
    expect(rollback.output).toContain('upstreams of the rollback target are unknown');
  });

  it('falls back to the recorded addresses when the target images are gone', () => {
    const rollback = runRollback({ env: { MISSING_IMAGES: '1' } });
    expectRestored(rollback, RECORDED_API_UPSTREAM, RECORDED_WEB_UPSTREAM);
  });

  it('reports a Caddy that refuses to come back up instead of exiting 0', () => {
    const rollback = runRollback({ env: { FAIL_CADDY_UP: '1' } });
    expectRefused(rollback, 'ROLLBACK FAILED');
    expect(rollback.output).toContain('Caddy could not be recreated');
    expect(rollback.output).toContain('Production is not being served');
  });

  it('reports a rendered Caddyfile that does not name the previous upstreams', () => {
    // The failed release's template is the one used once the target's is gone,
    // and this one substitutes nothing.
    const rollback = runRollback({
      pruneTarget: true,
      failedCaddyfile: CADDYFILE_WITHOUT_PLACEHOLDERS,
    });
    expectRefused(rollback, 'ROLLBACK FAILED');
    expect(rollback.output).toContain('does not name the previous release');
  });

  it('refuses when the application network cannot be determined', () => {
    const rollback = runRollback({ env: { MISSING_CONTAINERS: '1', NO_POSTGRES: '1' } });
    expectRefused(rollback, 'ROLLBACK FAILED');
    expect(rollback.output).toContain('Docker network');
  });

  // THE "ROLLBACK OK" REGRESSION. Reproduced with the target's images missing
  // and no usable recorded upstreams, the script fell through to the legacy
  // compose service names, rewrote Caddy to a dead `api:3310` / `web:80`, found
  // those names in the file it had just written and exited 0. Everything it
  // checked was about itself; nothing asked production a question.
  describe('proving the restored release actually serves', () => {
    it('fails, and never says ROLLBACK OK, when the restored upstreams are dead', () => {
      const rollback = runRollback({ env: { DEAD_UPSTREAMS: '1' } });
      expectRefused(rollback, 'ROLLBACK FAILED');
      expect(rollback.output).toContain('did not answer a readiness probe');
      expect(rollback.output).toContain('CRITICAL');
      expect(rollback.output).not.toContain('serving again');
      // The probe was actually attempted, and bounded: it does not spin.
      const probes = rollback
        .dockerCalls()
        .filter((call) => call.startsWith('curl ') && call.includes('/api/health'));
      expect(probes.length).toBeGreaterThan(0);
      expect(probes.length).toBeLessThanOrEqual(3);
    });

    it('leaves current and the state file describing the release that was live', () => {
      // A rollback that could not restore service must not leave bookkeeping
      // claiming it did — the next deploy reads both of these.
      const rollback = runRollback({ env: { DEAD_UPSTREAMS: '1' } });
      expect(rollback.currentReleaseId()).toBe(FAILED_ID);
      expect(rollback.stateFile()).toContain(`FLUXRADAR_API_UPSTREAM=${FAILED_API_UPSTREAM}`);
    });

    it('fails when Caddy answers but the restored container is not ready', () => {
      // The container is back and has an address, so every check the script
      // makes about ITSELF passes; the release inside it never came up.
      const rollback = runRollback({ env: { DEAD_CONTAINERS: '1' } });
      expectRefused(rollback, 'ROLLBACK FAILED');
      expect(rollback.output).toContain('did not answer a readiness probe');
    });

    it('probes the restored containers and the site through Caddy, not one or the other', () => {
      const rollback = runRollback();
      const calls = rollback.dockerCalls();
      expect(calls.some((call) => call.startsWith('exec') && call.includes('health/ready'))).toBe(
        true,
      );
      expect(calls.some((call) => call.startsWith('exec') && call.includes('wget'))).toBe(true);
      expect(calls.some((call) => call.includes('https://fluxradar.net/api/health'))).toBe(true);
      expect(calls.some((call) => call.includes('--resolve fluxradar.net:443:127.0.0.1'))).toBe(
        true,
      );
    });

    it('accepts a restored release that answers, on the addresses it restored', () => {
      const rollback = runRollback({ env: { MISSING_CONTAINERS: '1' } });
      expectRestored(rollback, REBUILT_API_UPSTREAM, REBUILT_WEB_UPSTREAM);
      expect(rollback.output).toContain('serving again');
    });
  });

  it('rewrites the runtime Caddyfile in place, never replacing the mounted file', () => {
    // Caddy bind-mounts runtime/Caddyfile. Replacing the file breaks the mount,
    // so the rollback has to write through the existing inode.
    const script = readFileSync(SCRIPT_PATH, 'utf8');
    expect(script).toContain('cat "$RUNTIME_DIR/Caddyfile.next" > "$RUNTIME_DIR/Caddyfile"');
  });

  it('never runs a destructive database command', () => {
    const rollback = runRollback();
    for (const call of rollback.dockerCalls()) {
      expect(call).not.toMatch(/\b(psql|pg_restore|dropdb|DROP |DELETE )/);
    }
  });
});
