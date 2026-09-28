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

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'reclaim-disk.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

const LIVE = 'a'.repeat(40);
const ROLLBACK = 'b'.repeat(40);
const ORPHAN = 'c'.repeat(40);
const STOPPED_CONTAINER = 'd'.repeat(40);

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

type Host = {
  /** Release directories that exist under APP_DIR/releases. */
  readonly releases: readonly string[];
  /** Every `repository:tag` the fake docker lists. */
  readonly images: readonly string[];
  /** Images referenced by a container, running or stopped. */
  readonly usedByContainers?: readonly string[];
  /** Images whose `docker image rm` fails. */
  readonly removalFails?: readonly string[];
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
    (host.usedByContainers ?? []).map((image) => `${image}\n`).join(''),
  );
  writeFileSync(
    join(workspace, 'failing'),
    (host.removalFails ?? []).map((image) => `${image}\n`).join(''),
  );
  const docker = join(bin, 'docker');
  writeFileSync(
    docker,
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1 $2" in
  "ps -a") cat "${workspace}/containers" ;;
  "image ls") cat "${workspace}/images" ;;
  "image rm") grep -Fxq -- "$3" "${workspace}/failing" && exit 1 ;;
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

  it('keeps an image a container still uses, even a stopped one, when its directory is gone', () => {
    const { dockerCalls, output } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${LIVE}`, `fluxradar-api:${STOPPED_CONTAINER}`],
      usedByContainers: [`fluxradar-api:${STOPPED_CONTAINER}`],
    });

    expect(removedImages(dockerCalls)).toEqual([]);
    expect(output).toContain(`keeping fluxradar-api:${STOPPED_CONTAINER}`);
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

    expect(job('reclaim')).toContain('needs: preflight');
    expect(job('reclaim')).toContain('deploy/reclaim-disk.sh');
    expect(job('image')).toContain('needs: reclaim');
    expect(job('package')).toContain('needs: reclaim');
  });
});
