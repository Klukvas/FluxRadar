import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-020: the deploy frees disk on the server before it uploads to it.
//
// The api-image upload was refused with "4 GB free, 5.6 GB needed": images of
// releases whose directories were already gone, dangling layers and stale build
// cache had piled up on a 38 GB disk. deploy/reclaim-disk.sh removes exactly
// those, and this runs it against a fake `docker` — the interesting half is what
// it must NOT remove, since the host also holds PostgreSQL's volume, the live
// release and the rollback candidates.
//
// The same upload was refused again at "8.5 GB free, 12.9 GB required" with the
// script reclaiming nothing at all: every orphaned image was pinned by a
// LEFTOVER STOPPED CONTAINER, so `docker image rm` could never succeed. A
// stopped container of a release that no longer has a directory is not a
// rollback candidate — nothing can start it again — so the script now removes
// it first. A running one, and any container of a release that still has its
// directory, stay exactly where they are.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'reclaim-disk.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

const LIVE = 'a'.repeat(40);
const ROLLBACK = 'b'.repeat(40);
const ORPHAN = 'c'.repeat(40);
const STOPPED_CONTAINER = 'd'.repeat(40);
const RUNNING_CONTAINER = 'f'.repeat(40);

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

/** One row of the fake `docker ps -a`. */
type Container = {
  readonly id: string;
  readonly image: string;
  /** A `docker ps --format '{{.State}}'` value; defaults to a live container. */
  readonly state?: 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'created' | 'dead';
};

type Host = {
  /** Release directories that exist under APP_DIR/releases. */
  readonly releases: readonly string[];
  /** Every `repository:tag` the fake docker lists. */
  readonly images: readonly string[];
  /** Containers the fake docker reports, running and stopped. */
  readonly containers?: readonly Container[];
  /** Images whose `docker image rm` fails. */
  readonly removalFails?: readonly string[];
  /** Container ids whose `docker rm` fails. */
  readonly containerRemovalFails?: readonly string[];
};

function reclaim(host: Host): { exitCode: number; output: string; dockerCalls: readonly string[] } {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-reclaim-'));
  workspaces.push(workspace);
  const appDir = join(workspace, 'app');
  const bin = join(workspace, 'bin');
  mkdirSync(bin);
  mkdirSync(join(appDir, 'releases'), { recursive: true });
  for (const release of host.releases) mkdirSync(join(appDir, 'releases', release));

  const log = join(workspace, 'docker.log');
  writeFileSync(log, '');
  writeFileSync(join(workspace, 'images'), host.images.map((image) => `${image}\n`).join(''));
  writeFileSync(
    join(workspace, 'containers'),
    (host.containers ?? [])
      .map((container) => `${container.id}\t${container.image}\t${container.state ?? 'running'}\n`)
      .join(''),
  );
  writeFileSync(
    join(workspace, 'failing'),
    (host.removalFails ?? []).map((image) => `${image}\n`).join(''),
  );
  writeFileSync(
    join(workspace, 'failing-containers'),
    (host.containerRemovalFails ?? []).map((id) => `${id}\n`).join(''),
  );
  // `docker ps -a` answers with the columns the caller asked for: the sweep
  // reads id, image and state; the "is this image in use" list reads images.
  const docker = join(bin, 'docker');
  writeFileSync(
    docker,
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1 $2" in
  "ps -a")
    case "$4" in
      *'{{.ID}}'*) cat "${workspace}/containers" ;;
      *) cut -f2 "${workspace}/containers" ;;
    esac
    ;;
  "image ls") cat "${workspace}/images" ;;
  "image rm") grep -Fxq -- "$3" "${workspace}/failing" && exit 1 ;;
  "rm "*|"rm")
    grep -Fxq -- "$2" "${workspace}/failing-containers" && exit 1
    # A removed container stops pinning its image, which is the whole point
    # of doing the sweep before the image list is read again.
    awk -F'\\t' -v id="$2" '$1 != id' "${workspace}/containers" > "${workspace}/containers.next"
    mv "${workspace}/containers.next" "${workspace}/containers"
    ;;
esac
exit 0
`,
  );
  chmodSync(docker, 0o755);

  const result = spawnSync('bash', [SCRIPT_PATH, appDir], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
    dockerCalls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

const removedImages = (calls: readonly string[]): readonly string[] =>
  calls
    .filter((call) => call.startsWith('image rm '))
    .map((call) => call.slice('image rm '.length));

const removedContainers = (calls: readonly string[]): readonly string[] =>
  calls.filter((call) => /^rm \S+$/.test(call)).map((call) => call.slice('rm '.length));

describe('DEPLOY-020 reclaim server disk', () => {
  it('removes a release image that has no release directory and nothing running it', () => {
    const { exitCode, dockerCalls } = reclaim({
      releases: [LIVE, ROLLBACK],
      images: [
        `fluxradar-api:${LIVE}`,
        `fluxradar-web:${LIVE}`,
        `fluxradar-api:${ROLLBACK}`,
        `fluxradar-api:${ORPHAN}`,
        `fluxradar-web:${ORPHAN}`,
      ],
    });

    expect(exitCode).toBe(0);
    expect(removedImages(dockerCalls)).toEqual([
      `fluxradar-api:${ORPHAN}`,
      `fluxradar-web:${ORPHAN}`,
    ]);
  });

  it('removes a leftover stopped container of a vanished release, then its image', () => {
    const { exitCode, dockerCalls, output } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${LIVE}`, `fluxradar-api:${STOPPED_CONTAINER}`],
      containers: [
        { id: 'stale1', image: `fluxradar-api:${STOPPED_CONTAINER}`, state: 'exited' },
        { id: 'live1', image: `fluxradar-api:${LIVE}`, state: 'running' },
      ],
    });

    expect(exitCode).toBe(0);
    expect(removedContainers(dockerCalls)).toEqual(['stale1']);
    // The sweep runs before the image loop reads `docker ps -a` again, so the
    // image is no longer in use by the time it is considered.
    expect(removedImages(dockerCalls)).toEqual([`fluxradar-api:${STOPPED_CONTAINER}`]);
    expect(output).toContain(`removing stopped container stale1`);
  });

  it.each(['created', 'dead'] as const)(
    'also removes a %s container of a vanished release',
    (state) => {
      const { dockerCalls } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${STOPPED_CONTAINER}`],
        containers: [{ id: 'stale1', image: `fluxradar-api:${STOPPED_CONTAINER}`, state }],
      });

      expect(removedContainers(dockerCalls)).toEqual(['stale1']);
    },
  );

  it('keeps a stopped container, and its image, while its release directory exists', () => {
    // This is the rollback candidate: the directory is still there, so the
    // deploy can start the release again from exactly this container.
    const { dockerCalls, output } = reclaim({
      releases: [LIVE, ROLLBACK],
      images: [`fluxradar-api:${LIVE}`, `fluxradar-api:${ROLLBACK}`],
      containers: [{ id: 'rollback1', image: `fluxradar-api:${ROLLBACK}`, state: 'exited' }],
    });

    expect(removedContainers(dockerCalls)).toEqual([]);
    expect(removedImages(dockerCalls)).toEqual([]);
    expect(output).not.toContain('rollback1');
  });

  it.each(['running', 'paused', 'restarting', 'removing'] as const)(
    'keeps a %s container even when its release directory is gone, and says so',
    (state) => {
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${LIVE}`, `fluxradar-api:${RUNNING_CONTAINER}`],
        containers: [{ id: 'serving1', image: `fluxradar-api:${RUNNING_CONTAINER}`, state }],
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(removedImages(dockerCalls)).toEqual([]);
      expect(output).toContain(`keeping container serving1`);
      expect(output).toContain(`it is ${state}`);
      expect(output).toContain(`keeping fluxradar-api:${RUNNING_CONTAINER} (a container uses it)`);
    },
  );

  it('never removes a container of another project, or one on a tag that is not a release id', () => {
    const { dockerCalls } = reclaim({
      releases: [LIVE],
      images: [],
      containers: [
        { id: 'postgres1', image: 'postgres:16-alpine', state: 'exited' },
        { id: 'caddy1', image: 'caddy:2', state: 'exited' },
        { id: 'other1', image: `other-app-api:${ORPHAN}`, state: 'exited' },
        { id: 'latest1', image: 'fluxradar-api:latest', state: 'exited' },
        { id: 'short1', image: 'fluxradar-api:abc', state: 'exited' },
        { id: 'id1', image: 'sha256:' + 'a'.repeat(64), state: 'exited' },
      ],
    });

    expect(removedContainers(dockerCalls)).toEqual([]);
  });

  it('carries on and exits 0 when a stopped container cannot be removed', () => {
    const { exitCode, dockerCalls, output } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${STOPPED_CONTAINER}`],
      containers: [
        { id: 'stale1', image: `fluxradar-api:${STOPPED_CONTAINER}`, state: 'exited' },
        { id: 'stale2', image: `fluxradar-api:${STOPPED_CONTAINER}`, state: 'exited' },
      ],
      containerRemovalFails: ['stale1'],
    });

    expect(exitCode).toBe(0);
    expect(removedContainers(dockerCalls)).toEqual(['stale1', 'stale2']);
    expect(output).toContain('could not remove container stale1');
  });

  it('never touches an image that is not a FluxRadar release image', () => {
    const { dockerCalls } = reclaim({
      releases: [LIVE],
      images: [
        'postgres:16-alpine',
        'caddy:2',
        'other-app-api:' + ORPHAN,
        'fluxradar-api:latest',
        'fluxradar-web:not-a-release-id',
        'fluxradar-api:abc',
        'fluxradar-api:' + 'e'.repeat(65),
        'fluxradar-api:<none>',
      ],
    });

    expect(removedImages(dockerCalls)).toEqual([]);
  });

  it('prunes dangling images and build cache older than a day, and nothing else', () => {
    const { dockerCalls } = reclaim({ releases: [LIVE], images: [] });

    expect(dockerCalls).toContain('image prune --force');
    expect(dockerCalls).toContain('builder prune --force --filter until=24h');
    // PostgreSQL's data is a volume; a container or network prune would also
    // reach the previous release's stopped containers a rollback starts from.
    expect(dockerCalls.filter((call) => /^(volume|system|container|network)\b/.test(call))).toEqual(
      [],
    );
  });

  it('carries on and exits 0 when one image cannot be removed', () => {
    const { exitCode, dockerCalls, output } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${ORPHAN}`, `fluxradar-web:${ORPHAN}`],
      removalFails: [`fluxradar-api:${ORPHAN}`],
    });

    expect(exitCode).toBe(0);
    expect(removedImages(dockerCalls)).toEqual([
      `fluxradar-api:${ORPHAN}`,
      `fluxradar-web:${ORPHAN}`,
    ]);
    expect(output).toContain(`could not remove fluxradar-api:${ORPHAN}`);
  });

  it('refuses to run without an application directory', () => {
    const result = spawnSync('bash', [SCRIPT_PATH], { encoding: 'utf8' });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('application directory');
  });

  it('runs as its own stage before either upload, so the space gate sees the cleaned disk', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const job = (name: string): string =>
      workflow.match(new RegExp(`^  ${name}:\\n(?:(?:    .*)?\\n)+`, 'm'))?.[0] ?? '';

    const prerequisites = (name: string): readonly string[] =>
      (job(name).match(/^ {4}needs: (.+)$/m)?.[1] ?? '')
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((dependency) => dependency.trim());

    expect(job('reclaim')).toContain('needs: preflight');
    expect(job('reclaim')).toContain('deploy/reclaim-disk.sh');
    expect(prerequisites('image')).toEqual(expect.arrayContaining(['reclaim', 'package']));
    expect(job('package')).toContain('needs: reclaim');
  });
});
