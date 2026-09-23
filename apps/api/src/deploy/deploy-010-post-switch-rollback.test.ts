import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
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

// DEPLOY-010: a failed deploy must never be able to leave a broken release in
// front of production.
//
// The release step is one long shell script that starts the new containers,
// switches Caddy onto them and then verifies the result. Two properties matter,
// and both were broken:
//
//   * every failure AFTER the traffic switch must roll back to the previous
//     release. It did not: `exit 1` does not raise ERR, so "Caddy never came
//     up", "the generated Caddyfile does not name the new upstreams" and
//     "`caddy validate` refused it" all exited straight past the rollback trap.
//     And without `set -E` an ERR trap is not inherited by shell functions, so a
//     failure inside ensure_network_attachment/render_caddyfile/atomic_switch
//     killed the script through errexit without running the trap AT ALL.
//   * every failure BEFORE it must NOT roll back — the previous release is
//     still serving, and recreating its proxy would be an outage caused by the
//     deploy that failed safely. It must, however, remove the new containers,
//     which are started with `--restart unless-stopped` and would otherwise keep
//     claiming jobs and sending customer email from a release nobody released.
//
// The script below is not a copy of the workflow: it is EXTRACTED from it
// between the markers and RUN, once per failure path, against a recorded
// `docker`/`curl` on PATH. So this suite cannot drift away from what ships, and
// it asserts the outcome an operator actually cares about — which release
// `current` points at, which upstreams the runtime Caddyfile names, and what the
// state file says — rather than the presence of a trap keyword.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const RELEASE_SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'release.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');
const ROLLBACK_SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'rollback-release.sh');
const BEGIN_MARKER = '# fluxradar:release-script';
const END_MARKER = '# fluxradar:end-release-script';

const PREVIOUS_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const RELEASE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PREVIOUS_API_UPSTREAM = '10.9.9.1:3310';
const PREVIOUS_WEB_UPSTREAM = '10.9.9.2:80';
const PREVIOUS_RUNTIME_API_UPSTREAM = `fluxradar-api-${PREVIOUS_ID}:3310`;
const PREVIOUS_RUNTIME_WEB_UPSTREAM = `fluxradar-web-${PREVIOUS_ID}:80`;
const NEW_CONTAINER_IP = '10.10.0.5';
const NEW_API_CONTAINER = `fluxradar-api-${RELEASE_ID}`;
const NEW_WEB_CONTAINER = `fluxradar-web-${RELEASE_ID}`;
const NEW_API_UPSTREAM = `${NEW_API_CONTAINER}:3310`;
const NEW_WEB_UPSTREAM = `${NEW_WEB_CONTAINER}:80`;
const NETWORK = 'fluxradar_default';

/** The workflow's own release script, dedented out of the YAML block scalar. */
function extractReleaseScript(): string {
  const lines = readFileSync(RELEASE_SCRIPT_PATH, 'utf8').split('\n');
  const begin = lines.findIndex((line) => line.trim().startsWith(BEGIN_MARKER));
  const end = lines.findIndex((line) => line.trim().startsWith(END_MARKER));
  expect(begin, `${BEGIN_MARKER} is missing from deploy/release.sh`).toBeGreaterThan(-1);
  expect(end, `${END_MARKER} is missing from deploy/release.sh`).toBeGreaterThan(begin);
  const block = lines.slice(begin, end + 1);
  const indent = (block[0] ?? '').length - (block[0] ?? '').trimStart().length;
  return block.map((line) => line.slice(indent)).join('\n');
}

/**
 * A fake `docker` that records every invocation and answers the handful of
 * questions the release script asks. One failure at a time is injected through
 * FAIL_STEP, which is how each post-switch path is reached without a daemon.
 */
const DOCKER_RECORDER = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
fail="$FAIL_STEP"
case "$1" in
  compose)
    case "$*" in
      *"ps -q postgres"*) printf 'postgres-container\n' ;;
      *"ps -q caddy"*)
        # An empty id is exactly what compose prints when the container is not
        # there, which is how "Caddy never came up" is simulated.
        if [ "$fail" != "caddy_running" ] || [ "$(grep -c 'force-recreate caddy' "$DOCKER_LOG")" -gt 1 ]; then
          printf 'caddy-container\n'
        fi ;;
      *"force-recreate caddy"*)
        if [ "$fail" = "caddy_up" ] && [ "$(grep -c 'force-recreate caddy' "$DOCKER_LOG")" -eq 1 ]; then
          echo 'compose refused to start caddy' >&2
          exit 1
        fi ;;
    esac ;;
  run)
    case "$*" in
      *migrate*) if [ "$fail" = "migrate" ]; then exit 1; fi ;;
      *rollback-probe*) printf 'probe-container\n' ;;
    esac ;;
  inspect)
    case "$*" in
      *IPAddress*)
        # One address per container, so a rollback that reads the addresses of
        # the containers that are running NOW gets the previous release's, not
        # the new one's.
        case "$*" in
          *"fluxradar-api-$PREVIOUS_RELEASE_ID"*) printf '%s\n' "$PREVIOUS_API_IP" ;;
          *"fluxradar-web-$PREVIOUS_RELEASE_ID"*) printf '%s\n' "$PREVIOUS_WEB_IP" ;;
          *) printf '%s\n' "$FAKE_CONTAINER_IP" ;;
        esac ;;
      *"State.Running"*) printf 'true\n' ;;
      *"State.Status"*) printf 'status=exited running=false exitCode=1\n' ;;
      *NetworkSettings.Networks*)
        # The caddy container is reported off the application network when the
        # attachment failure is being exercised, so the script calls
        # "docker network connect" from inside a shell function, which is the
        # case an ERR trap silently missed.
        if [ "$fail" = "network_connect_caddy" ]; then
          case "$*" in *caddy-container*) printf 'bridge\n'; exit 0 ;; esac
        fi
        printf '%s\n' "$FAKE_NETWORK" ;;
    esac ;;
  exec)
    case "$*" in
      *"caddy validate"*) if [ "$fail" = "caddy_validate" ]; then exit 1; fi ;;
      *rollback-readonly-probe*) if [ "$fail" = "probe_readonly" ]; then exit 1; fi ;;
      *rollback-schema-probe*) if [ "$fail" = "probe_schema" ]; then exit 1; fi ;;
      *health/ready*|*wget*) if [ "$fail" = "readiness" ]; then exit 1; fi ;;
    esac ;;
  network)
    if [ "$fail" = "network_connect_caddy" ]; then
      echo 'network connect refused' >&2
      exit 1
    fi ;;
esac
exit 0
`;

/**
 * The local Caddy smoke test, and — after a rollback — the readiness probe the
 * rollback makes through Caddy on the same loopback.
 *
 * "caddy_smoke" fails only the FIRST call, which is the release's own check
 * against the new upstreams. The calls after it come from the rollback and ask
 * about the release it restored, which is up: a shim that failed every call
 * would be simulating two broken releases, not the failure under test.
 */
const CURL_RECORDER = String.raw`#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$DOCKER_LOG"
if [ "$FAIL_STEP" = "caddy_smoke" ] && [ "$(grep -c '^curl ' "$DOCKER_LOG")" -eq 1 ]; then
  exit 22
fi
if [ "$FAIL_STEP" = "post_cleanup_smoke" ] && [ "$(grep -c '^curl ' "$DOCKER_LOG")" -eq 2 ]; then
  exit 22
fi
printf '{"status":"ok"}\n'
`;

/** Readiness and start-up polling; the deploy would otherwise take minutes. */
const SLEEP_STUB = '#!/usr/bin/env bash\nexit 0\n';

/**
 * Test scaffolding, present only on the fake PATH:
 *
 *   * it fails the `current` rename on demand, which is the only way to reach
 *     the atomic_switch failure path without a real filesystem fault;
 *   * it emulates GNU `mv -T` where the platform has none (macOS), so the
 *     extracted production script — which needs `-T` to replace a symlink that
 *     points at a directory — runs unmodified there. Production is Linux, where
 *     the real `mv -T` is used.
 */
const MV_SHIM = String.raw`#!/usr/bin/env bash
if [ "$FAIL_STEP" = "atomic_switch" ]; then
  case "$*" in
    *current*)
      mv_count_file="$HOME/mv-current-count"
      mv_count=0
      if [ -f "$mv_count_file" ]; then mv_count="$(cat "$mv_count_file")"; fi
      if [ "$mv_count" -eq 0 ]; then
        echo 1 > "$mv_count_file"
        echo 'mv: injected failure' >&2
        exit 1
      fi ;;
  esac
fi
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

// A template with no placeholders renders a Caddyfile that cannot name the new
// upstreams, which is the "generated Caddyfile is wrong" guard in the script.
const CADDYFILE_WITHOUT_PLACEHOLDERS = 'fluxradar.net {\n  reverse_proxy 127.0.0.1:1\n}\n';

interface Deployment {
  readonly appDir: string;
  readonly exitCode: number;
  readonly output: string;
  /** Release id `$APP_DIR/current` points at afterwards, or '' when unset. */
  currentReleaseId: () => string;
  runtimeCaddyfile: () => string;
  stateFile: () => string;
  /** runtime/rollback.env, the rollback target a later step would read. */
  rollbackTarget: () => string;
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
  for (const probe of ['rollback-readonly-probe.cjs', 'rollback-schema-probe.cjs']) {
    writeFileSync(join(releaseDir, 'deploy', probe), '// probe\n');
  }
  // The rollback the release script runs is the one that ships, not a stand-in:
  // it is a file in the release, so the release under test carries the real one.
  copyFileSync(ROLLBACK_SCRIPT_PATH, join(releaseDir, 'deploy', 'rollback-release.sh'));
  return releaseDir;
}

/**
 * A server that already runs PREVIOUS_ID: releases on disk, `current` pointing
 * at it, and a runtime state file and Caddyfile naming its upstreams.
 */
function runDeploy(
  options: {
    failStep?: string;
    newReleaseCaddyfile?: string;
    /** The rollback target's directory is gone, as a retention sweep leaves it. */
    prunePreviousRelease?: boolean;
    /** No `current`, no state file: the very first deploy of a host. */
    firstDeploy?: boolean;
  } = {},
): Deployment {
  // realpath up front: mkdtemp hands back /var/... on macOS while the script's
  // own `readlink -f` resolves /private/var/..., and the assertions compare paths.
  const appDir = realpathSync(mkdtempSync(join(tmpdir(), 'fluxradar-release-')));
  workspaces.push(appDir);

  const previousDir = makeRelease(appDir, PREVIOUS_ID, CADDYFILE_TEMPLATE);
  makeRelease(appDir, RELEASE_ID, options.newReleaseCaddyfile ?? CADDYFILE_TEMPLATE);
  if (!options.firstDeploy) symlinkSync(previousDir, join(appDir, 'current'));

  const runtimeDir = join(appDir, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  if (!options.firstDeploy) {
    writeFileSync(
      join(runtimeDir, 'active.env'),
      [
        `FLUXRADAR_ACTIVE_RELEASE=${previousDir}`,
        `FLUXRADAR_API_UPSTREAM=${PREVIOUS_API_UPSTREAM}`,
        `FLUXRADAR_WEB_UPSTREAM=${PREVIOUS_WEB_UPSTREAM}`,
        `FLUXRADAR_API_CONTAINER=fluxradar-api-${PREVIOUS_ID}`,
        `FLUXRADAR_WEB_CONTAINER=fluxradar-web-${PREVIOUS_ID}`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(runtimeDir, 'Caddyfile'),
      CADDYFILE_TEMPLATE.replace('{$FLUXRADAR_API_UPSTREAM}', PREVIOUS_API_UPSTREAM).replace(
        '{$FLUXRADAR_WEB_UPSTREAM}',
        PREVIOUS_WEB_UPSTREAM,
      ),
    );
  }
  // The release directory a retention sweep removed while `current` still points
  // at it: the rollback target exists as a release id and an image, but its
  // docker-compose.yml and Caddyfile are gone.
  if (options.prunePreviousRelease) rmSync(previousDir, { recursive: true, force: true });

  const binDir = join(appDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(join(binDir, 'docker'), DOCKER_RECORDER);
  writeExecutable(join(binDir, 'curl'), CURL_RECORDER);
  writeExecutable(join(binDir, 'sleep'), SLEEP_STUB);
  writeExecutable(join(binDir, 'mv'), MV_SHIM);

  const scriptPath = join(appDir, 'release.sh');
  writeFileSync(scriptPath, extractReleaseScript());
  const dockerLog = join(appDir, 'docker.log');

  // stdout on the success path, stdout+stderr on a failure — which is where the
  // handler's "AFTER/BEFORE the traffic switch" line is written.
  let output: string;
  let exitCode = 0;
  try {
    output = execFileSync('bash', [scriptPath, appDir, RELEASE_ID, 'false'], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        HOME: appDir,
        DOCKER_LOG: dockerLog,
        FAKE_NETWORK: NETWORK,
        FAKE_CONTAINER_IP: NEW_CONTAINER_IP,
        PREVIOUS_RELEASE_ID: PREVIOUS_ID,
        PREVIOUS_API_IP: PREVIOUS_API_UPSTREAM.split(':')[0] as string,
        PREVIOUS_WEB_IP: PREVIOUS_WEB_UPSTREAM.split(':')[0] as string,
        MV_EMULATE_T: process.platform === 'linux' ? '0' : '1',
        FAIL_STEP: options.failStep ?? '',
      },
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    exitCode = failure.status ?? 1;
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }

  return {
    appDir,
    exitCode,
    output,
    currentReleaseId: () => {
      // readlink, not existsSync: a symlink whose target directory was pruned is
      // exactly the state one of these cases creates, and existsSync follows it.
      try {
        const target = readlinkSync(join(appDir, 'current'));
        return target.slice(target.lastIndexOf('/') + 1);
      } catch {
        return '';
      }
    },
    runtimeCaddyfile: () => readFileSync(join(runtimeDir, 'Caddyfile'), 'utf8'),
    stateFile: () => readFileSync(join(runtimeDir, 'active.env'), 'utf8'),
    rollbackTarget: () => {
      try {
        return readFileSync(join(runtimeDir, 'rollback.env'), 'utf8');
      } catch {
        return '';
      }
    },
    dockerCalls: () => {
      try {
        return readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

function caddyRecreations(calls: readonly string[]): number {
  return calls.filter((call) => call.includes('force-recreate caddy')).length;
}

function lastIndexMatching(calls: readonly string[], predicate: (call: string) => boolean): number {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (predicate(calls[index] as string)) return index;
  }
  return -1;
}

/**
 * Whether the new containers were removed AFTER they were started.
 *
 * The script also removes them once *before* starting them, so a bare "was
 * `docker rm -f` called" would be satisfied by that. What matters is the
 * removal that follows the start: without it a failed deploy leaves the new API
 * container running with `--restart unless-stopped` against the production
 * database, claiming jobs and sending customer email from a release nobody
 * released. A deploy that never got as far as starting them is clean too.
 */
function cleanedUpNewContainers(calls: readonly string[]): boolean {
  const started = lastIndexMatching(
    calls,
    (call) => call.startsWith('run -d') && call.includes(`--name fluxradar-api-${RELEASE_ID}`),
  );
  const removed = lastIndexMatching(
    calls,
    (call) => call.startsWith('rm -f') && call.includes(`fluxradar-api-${RELEASE_ID}`),
  );
  return removed > started;
}

/** Everything a rollback has to have put back, asserted as one state. */
function expectRolledBack(deployment: Deployment): void {
  expect(deployment.exitCode).not.toBe(0);
  expect(deployment.currentReleaseId()).toBe(PREVIOUS_ID);
  expect(deployment.runtimeCaddyfile()).toContain(PREVIOUS_RUNTIME_API_UPSTREAM);
  expect(deployment.runtimeCaddyfile()).toContain(PREVIOUS_RUNTIME_WEB_UPSTREAM);
  expect(deployment.runtimeCaddyfile()).not.toContain(NEW_API_UPSTREAM);
  expect(deployment.stateFile()).toContain(
    `FLUXRADAR_API_UPSTREAM=${PREVIOUS_RUNTIME_API_UPSTREAM}`,
  );
  expect(deployment.stateFile()).toContain(`FLUXRADAR_API_CONTAINER=fluxradar-api-${PREVIOUS_ID}`);
  expect(cleanedUpNewContainers(deployment.dockerCalls())).toBe(true);
  // The switch recreated Caddy once; the rollback recreated it once more. A
  // third would mean the rollback ran twice for one failure.
  expect(caddyRecreations(deployment.dockerCalls())).toBe(2);
}

/** Nothing that serves traffic may have been touched. */
function expectNoRollback(deployment: Deployment): void {
  expect(deployment.exitCode).not.toBe(0);
  expect(deployment.currentReleaseId()).toBe(PREVIOUS_ID);
  expect(deployment.runtimeCaddyfile()).toContain(PREVIOUS_API_UPSTREAM);
  expect(deployment.stateFile()).toContain(`FLUXRADAR_API_UPSTREAM=${PREVIOUS_API_UPSTREAM}`);
  expect(caddyRecreations(deployment.dockerCalls())).toBe(0);
  expect(cleanedUpNewContainers(deployment.dockerCalls())).toBe(true);
  expect(deployment.output).toContain('BEFORE any traffic was switched');
}

describe('DEPLOY-010 release switch and rollback', () => {
  // The script ships with the release, like rollback-release.sh. What the
  // release stage runs has to be THAT copy — extracted by the package stage
  // for this commit — and there must be no second, inline copy left to drift.
  it('is run from the release directory by the release stage, never inlined', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(workflow).toContain('RELEASE_SCRIPT="$1/releases/$2/deploy/release.sh"');
    expect(workflow).toContain('exec bash "$RELEASE_SCRIPT" "$1" "$2" "$3"');
    expect(workflow).not.toContain(BEGIN_MARKER);
  });

  it('uses stable Docker network identities for Caddy upstreams', () => {
    const script = extractReleaseScript();
    expect(script).toContain('--network-alias "$API_CONTAINER"');
    expect(script).toContain('--network-alias "$WEB_CONTAINER"');
    expect(script).toContain('NEW_API_UPSTREAM="$API_CONTAINER:3310"');
    expect(script).toContain('NEW_WEB_UPSTREAM="$WEB_CONTAINER:80"');
    expect(script).not.toContain('API_IP="$(docker inspect');
    expect(script).not.toContain('WEB_IP="$(docker inspect');
  });

  it('installs an exit handler instead of an ERR trap that misses `exit` and functions', () => {
    const script = extractReleaseScript();
    expect(script).toContain('trap on_exit EXIT');
    expect(script).not.toMatch(/^\s*trap\s+\S+\s+ERR\s*$/m);
    // The flag has to be set before the first write that moves traffic.
    const switched = script.indexOf('TRAFFIC_SWITCHED=1');
    const rendered = script.indexOf('render_caddyfile "$NEW_API_UPSTREAM"');
    const recreated = script.indexOf('--force-recreate caddy\n');
    expect(switched).toBeGreaterThan(-1);
    expect(switched).toBeLessThan(rendered);
    expect(rendered).toBeLessThan(recreated);
  });

  it('switches traffic and records the new release when every step passes', () => {
    const deployment = runDeploy();
    expect(deployment.exitCode).toBe(0);
    expect(deployment.currentReleaseId()).toBe(RELEASE_ID);
    expect(deployment.runtimeCaddyfile()).toContain(NEW_API_UPSTREAM);
    expect(deployment.runtimeCaddyfile()).toContain(NEW_WEB_UPSTREAM);
    expect(deployment.stateFile()).toContain(`FLUXRADAR_API_UPSTREAM=${NEW_API_UPSTREAM}`);
    expect(deployment.stateFile()).toContain(`FLUXRADAR_API_CONTAINER=fluxradar-api-${RELEASE_ID}`);
    // The previous release's containers are the ones that go, not the new ones.
    expect(
      deployment.dockerCalls().some((call) => call.includes(`fluxradar-api-${PREVIOUS_ID}`)),
    ).toBe(true);
    expect(caddyRecreations(deployment.dockerCalls())).toBe(1);
    // A release that is serving traffic is never torn down again.
    expect(cleanedUpNewContainers(deployment.dockerCalls())).toBe(false);
  });

  // One case per command that can fail once traffic is on the new release. The
  // remaining post-switch statements are the two `export`s, `cd $RELEASE_DIR`
  // and the state-file write, which cannot fail without the filesystem itself
  // failing; the exit handler covers those by construction, since it runs on
  // errexit as well as on an explicit `exit`.
  const postSwitchFailures: readonly { readonly name: string; readonly failStep: string }[] = [
    { name: 'Caddy refuses to be recreated', failStep: 'caddy_up' },
    { name: 'Caddy never reports itself running', failStep: 'caddy_running' },
    {
      name: 'the network attachment fails inside a shell function',
      failStep: 'network_connect_caddy',
    },
    { name: '`caddy validate` rejects the configuration', failStep: 'caddy_validate' },
    { name: 'the local HTTPS smoke test fails', failStep: 'caddy_smoke' },
    {
      name: 'the post-cleanup smoke test fails',
      failStep: 'post_cleanup_smoke',
    },
    { name: 'the `current` symlink cannot be moved into place', failStep: 'atomic_switch' },
  ];

  for (const failure of postSwitchFailures) {
    it(`rolls back to the previous release when ${failure.name}`, () => {
      const deployment = runDeploy({ failStep: failure.failStep });
      expect(deployment.output).toContain('AFTER traffic was switched');
      expectRolledBack(deployment);
    });
  }

  it('rolls back when the generated Caddyfile does not name the new upstreams', () => {
    const deployment = runDeploy({ newReleaseCaddyfile: CADDYFILE_WITHOUT_PLACEHOLDERS });
    expect(deployment.output).toContain('does not reference the new release upstreams');
    expect(deployment.exitCode).not.toBe(0);
    expect(deployment.currentReleaseId()).toBe(PREVIOUS_ID);
    expect(deployment.stateFile()).toContain(
      `FLUXRADAR_API_UPSTREAM=${PREVIOUS_RUNTIME_API_UPSTREAM}`,
    );
    expect(cleanedUpNewContainers(deployment.dockerCalls())).toBe(true);
    expect(caddyRecreations(deployment.dockerCalls())).toBe(2);
  });

  const preSwitchFailures: readonly { readonly name: string; readonly failStep: string }[] = [
    { name: 'the migration fails', failStep: 'migrate' },
    { name: 'the rollback target would not start on this environment', failStep: 'probe_readonly' },
    { name: 'the rollback target cannot read the migrated schema', failStep: 'probe_schema' },
    { name: 'the new containers never become ready', failStep: 'readiness' },
  ];

  for (const failure of preSwitchFailures) {
    it(`leaves production untouched when ${failure.name}`, () => {
      const deployment = runDeploy({ failStep: failure.failStep });
      expectNoRollback(deployment);
    });
  }

  it('removes the new containers when the deploy fails before the switch', () => {
    // They run with `--restart unless-stopped` against the production database,
    // so leaving them behind means a release nobody released keeps claiming
    // jobs and sending customer email.
    const deployment = runDeploy({ failStep: 'readiness' });
    expect(cleanedUpNewContainers(deployment.dockerCalls())).toBe(true);
  });

  // The rollback used to be inline and guarded by
  // `[ -f "$PREVIOUS_RELEASE/docker-compose.yml" ]`. When the retention sweep of
  // an earlier deploy had removed that directory, the guard was false and the
  // WHOLE rollback became a no-op — while the line above it had already
  // announced "rolling back to <id>". Caddy kept the failed release's upstreams,
  // whose containers had just been deleted, so the deploy log claimed a rollback
  // and production served 502.
  describe('when the rollback target directory has been pruned', () => {
    it('still puts the previous release back, and says the rollback was degraded', () => {
      const deployment = runDeploy({ failStep: 'caddy_validate', prunePreviousRelease: true });
      expect(deployment.exitCode).not.toBe(0);
      expect(deployment.output).toContain('no longer holds docker-compose.yml');
      expect(deployment.output).toContain('ROLLBACK OK (DEGRADED)');
      // The outcome that matters: traffic is on the previous release again.
      expect(deployment.runtimeCaddyfile()).toContain(PREVIOUS_RUNTIME_API_UPSTREAM);
      expect(deployment.runtimeCaddyfile()).toContain(PREVIOUS_RUNTIME_WEB_UPSTREAM);
      expect(deployment.runtimeCaddyfile()).not.toContain(NEW_API_UPSTREAM);
      expect(deployment.currentReleaseId()).toBe(PREVIOUS_ID);
      expect(deployment.stateFile()).toContain(
        `FLUXRADAR_API_UPSTREAM=${PREVIOUS_RUNTIME_API_UPSTREAM}`,
      );
      expect(cleanedUpNewContainers(deployment.dockerCalls())).toBe(true);
      expect(caddyRecreations(deployment.dockerCalls())).toBe(2);
    });

    it('never reports a rollback it did not perform', () => {
      const deployment = runDeploy({ failStep: 'caddy_validate', prunePreviousRelease: true });
      const claimedSuccess = deployment.output.includes('serving again');
      const restored = deployment.runtimeCaddyfile().includes(PREVIOUS_RUNTIME_API_UPSTREAM);
      expect(claimedSuccess).toBe(restored);
    });
  });

  // A first deploy has no rollback target at all. Silence there is the same bug
  // in a different disguise: the log has to say what happened. What it must NOT
  // do is tear the release down anyway — the rollback removed the failed
  // release's containers before it checked whether a target existed, so a first
  // deploy that failed after the switch ended with a host serving nothing at
  // all. There is nothing better than the release that just failed, so it stays
  // up and the failure is escalated instead.
  describe('when a first deploy fails after the switch', () => {
    it('reports that no rollback is possible, as a CRITICAL needing manual action', () => {
      const deployment = runDeploy({ failStep: 'caddy_validate', firstDeploy: true });
      expect(deployment.exitCode).not.toBe(0);
      expect(deployment.output).toContain('ROLLBACK IMPOSSIBLE');
      expect(deployment.output).toContain('CRITICAL');
      expect(deployment.output).toContain('no earlier release on this host to roll back to');
      expect(deployment.output).not.toContain('serving again');
      expect(deployment.currentReleaseId()).toBe('');
    });

    it('leaves the only release on the host running instead of deleting it', () => {
      const deployment = runDeploy({ failStep: 'caddy_validate', firstDeploy: true });
      expect(cleanedUpNewContainers(deployment.dockerCalls())).toBe(false);
      // The rollback stops at the missing target: Caddy is recreated by the
      // traffic switch and by nothing else.
      expect(caddyRecreations(deployment.dockerCalls())).toBe(1);
    });
  });

  // The rollback that runs after this script has exited — the public smoke test
  // on the runner — can only find its target in a file on the server.
  describe('the recorded rollback target', () => {
    it('is written before traffic moves, naming the release being replaced', () => {
      const deployment = runDeploy();
      expect(deployment.exitCode).toBe(0);
      expect(deployment.rollbackTarget()).toContain(`FLUXRADAR_ROLLBACK_RELEASE_ID=${PREVIOUS_ID}`);
      expect(deployment.rollbackTarget()).toContain(
        `FLUXRADAR_ROLLBACK_API_UPSTREAM=${PREVIOUS_API_UPSTREAM}`,
      );
      // It survives the successful deploy on purpose: that is the only moment a
      // later step can still learn what to roll back to.
      expect(deployment.rollbackTarget()).toContain(`FLUXRADAR_ROLLBACK_WEB_CONTAINER=`);
    });

    it('is recorded before the first write that moves traffic', () => {
      const script = extractReleaseScript();
      const recorded = script.indexOf('\nrecord_rollback_target\n');
      const switched = script.indexOf('TRAFFIC_SWITCHED=1');
      expect(recorded).toBeGreaterThan(-1);
      expect(recorded).toBeLessThan(switched);
    });
  });

  // Past DEPLOY_COMPLETED the release has passed every check the script makes
  // and only the disk-retention sweep is left. The comment there claimed no
  // failure could roll back from that point; the handler did not implement it,
  // and would have rolled a healthy, live release back over a `find` failure.
  it('never rolls back once the release is live and only bookkeeping is left', () => {
    const script = extractReleaseScript();
    const handler = script.slice(
      script.indexOf('on_exit() {'),
      script.indexOf('trap on_exit EXIT'),
    );
    const completed = handler.indexOf('if [ "$DEPLOY_COMPLETED" -eq 1 ]; then');
    const rollbackCall = handler.indexOf('rollback_status=$?');
    expect(completed).toBeGreaterThan(-1);
    expect(rollbackCall).toBeGreaterThan(completed);
    // The early return is unconditional on the status, so a failing retention
    // sweep is reported and exits — it does not reach the rollback below.
    expect(handler).toContain('exit "$status"');
    expect(handler).not.toContain('[ "$DEPLOY_COMPLETED" -eq 1 ] && [ "$status" -eq 0 ]');
  });
});
