import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
// script reclaiming a single image: every other orphaned image was pinned by a
// container that was still RUNNING — six fluxradar-web containers and one
// crash-looping fluxradar-api container of releases whose directories had long
// been pruned. Nothing routed traffic to them; they had just never been
// stopped. So a running container of a vanished release is removable now too,
// but only against proof of what is live: runtime/active.env, the generated
// runtime/Caddyfile, runtime/rollback.env and the `current` symlink. If any of
// that cannot be read, or the state file and the Caddyfile disagree, the sweep
// falls back to stopped containers only — the tests below pin both halves.
//
// The evidence records images as the `sha256:` IDs release.sh reads out of
// `docker inspect`, not as repository:tag, so both halves also match candidates
// by image ID: a container running a recorded digest under a name nothing knows
// stays, and no `docker image rm` may delete a digest rollback-release.sh needs.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'reclaim-disk.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

const LIVE = 'a'.repeat(40);
const ROLLBACK = 'b'.repeat(40);
const ORPHAN = 'c'.repeat(40);
const STOPPED_CONTAINER = 'd'.repeat(40);
const RUNNING_CONTAINER = 'f'.repeat(40);

/**
 * An image ID as `docker inspect --format '{{.Image}}'` reports it, which is the
 * only spelling release.sh records FLUXRADAR_ROLLBACK_*_IMAGE in.
 */
const imageId = (key: string): string => `sha256:${createHash('sha256').update(key).digest('hex')}`;

/** The names release.sh gives a release's containers, and its upstreams. */
const apiContainer = (release: string): string => `fluxradar-api-${release}`;
const webContainer = (release: string): string => `fluxradar-web-${release}`;
const apiUpstream = (release: string): string => `${apiContainer(release)}:3310`;
const webUpstream = (release: string): string => `${webContainer(release)}:80`;

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

/** One row of the fake `docker ps -a`. */
type Container = {
  readonly id: string;
  readonly image: string;
  /** `docker ps --format '{{.Names}}'`; defaults to this release's own name. */
  readonly name?: string;
  /** A `docker ps --format '{{.State}}'` value; defaults to a live container. */
  readonly state?: 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'created' | 'dead';
};

/**
 * The evidence of what is live, as release.sh leaves it. Every field defaults
 * to a healthy host serving LIVE; `null` deletes the file (or the symlink).
 */
type Runtime = {
  readonly state?: string | null;
  readonly caddyfile?: string | null;
  readonly rollback?: string | null;
  /** Release id `APP_DIR/current` points at — a dangling link is allowed. */
  readonly current?: string | null;
  /** Runtime files to make unreadable after writing them. */
  readonly unreadable?: readonly ('state' | 'caddyfile' | 'rollback')[];
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
  /**
   * The image ID a `repository:tag` resolves to, for the images whose ID the
   * runtime files record; every other image gets a deterministic one of its own.
   */
  readonly imageIds?: Readonly<Record<string, string>>;
  /** Container ids and `repository:tag`s whose `docker inspect` fails. */
  readonly inspectFails?: readonly string[];
  /** What the host says is live; defaults to a healthy LIVE release. */
  readonly runtime?: Runtime;
};

/** runtime/active.env exactly as release.sh writes it. */
const activeEnv = (appDir: string, release: string, overrides: readonly string[] = []): string =>
  [
    `FLUXRADAR_ACTIVE_RELEASE=${join(appDir, 'releases', release)}`,
    `FLUXRADAR_API_UPSTREAM=${apiUpstream(release)}`,
    `FLUXRADAR_WEB_UPSTREAM=${webUpstream(release)}`,
    `FLUXRADAR_API_CONTAINER=${apiContainer(release)}`,
    `FLUXRADAR_WEB_CONTAINER=${webContainer(release)}`,
    'FLUXRADAR_GOOGLE_LOGIN_REQUIRED=false',
    ...overrides,
  ].join('\n');

/** runtime/Caddyfile as render_caddyfile leaves it, upstreams substituted. */
const generatedCaddyfile = (api: string, web: string): string =>
  [
    'fluxradar.net {',
    '    handle_path /api/* {',
    `        reverse_proxy ${api}`,
    '    }',
    '    handle {',
    `        reverse_proxy ${web}`,
    '    }',
    '}',
  ].join('\n');

function reclaim(host: Host): { exitCode: number; output: string; dockerCalls: readonly string[] } {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-reclaim-'));
  workspaces.push(workspace);
  const appDir = join(workspace, 'app');
  const bin = join(workspace, 'bin');
  mkdirSync(bin);
  mkdirSync(join(appDir, 'releases'), { recursive: true });
  mkdirSync(join(appDir, 'runtime'));
  for (const release of host.releases) mkdirSync(join(appDir, 'releases', release));

  const runtime = host.runtime ?? {};
  const files = {
    state: runtime.state === undefined ? activeEnv(appDir, LIVE) : runtime.state,
    caddyfile:
      runtime.caddyfile === undefined
        ? generatedCaddyfile(apiUpstream(LIVE), webUpstream(LIVE))
        : runtime.caddyfile,
    rollback: runtime.rollback === undefined ? null : runtime.rollback,
  } as const;
  const paths = {
    state: join(appDir, 'runtime', 'active.env'),
    caddyfile: join(appDir, 'runtime', 'Caddyfile'),
    rollback: join(appDir, 'runtime', 'rollback.env'),
  } as const;
  for (const key of ['state', 'caddyfile', 'rollback'] as const) {
    if (files[key] !== null) writeFileSync(paths[key], `${files[key]}\n`);
  }
  for (const key of runtime.unreadable ?? []) chmodSync(paths[key], 0o000);
  const current = runtime.current === undefined ? LIVE : runtime.current;
  if (current !== null) symlinkSync(join(appDir, 'releases', current), join(appDir, 'current'));

  const log = join(workspace, 'docker.log');
  writeFileSync(log, '');
  writeFileSync(join(workspace, 'images'), host.images.map((image) => `${image}\n`).join(''));
  writeFileSync(
    join(workspace, 'containers'),
    (host.containers ?? [])
      .map((container) => {
        const release = container.image.slice(container.image.indexOf(':') + 1);
        const prefix = container.image.startsWith('fluxradar-web') ? webContainer : apiContainer;
        const name = container.name ?? prefix(release);
        return `${container.id}\t${name}\t${container.image}\t${container.state ?? 'running'}\n`;
      })
      .join(''),
  );
  // Every image has an ID, and a container runs the ID of its image: that is
  // the pair release.sh records and rollback-release.sh verifies.
  const idOf = (image: string): string => host.imageIds?.[image] ?? imageId(image);
  writeFileSync(
    join(workspace, 'image-ids'),
    [
      ...host.images.map((image) => `${image}\t${idOf(image)}`),
      ...(host.containers ?? []).map((container) => `${container.id}\t${idOf(container.image)}`),
    ]
      .map((line) => `${line}\n`)
      .join(''),
  );
  writeFileSync(
    join(workspace, 'failing-inspects'),
    (host.inspectFails ?? []).map((target) => `${target}\n`).join(''),
  );
  writeFileSync(
    join(workspace, 'failing'),
    (host.removalFails ?? []).map((image) => `${image}\n`).join(''),
  );
  writeFileSync(
    join(workspace, 'failing-containers'),
    (host.containerRemovalFails ?? []).map((id) => `${id}\n`).join(''),
  );
  // `docker ps -a` and `docker image ls` answer with the columns the caller
  // asked for: the sweep reads id, name, image and state; the "is this image in
  // use" list reads images; the before/after usage report reads sizes.
  // `inspect` resolves a container to its image ID and `image inspect` an image
  // to its own, the two lookups the live-evidence match needs.
  const docker = join(bin, 'docker');
  writeFileSync(
    docker,
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
lookup_id() {
  grep -Fxq -- "$1" "${workspace}/failing-inspects" && exit 1
  awk -F'\\t' -v key="$1" '$1 == key { print $2; found = 1 } END { exit !found }' \
    "${workspace}/image-ids" || exit 1
}
case "$1 $2" in
  "inspect --format") lookup_id "$4" ;;
  "image inspect") lookup_id "$5" ;;
  "ps -a")
    case "$4" in
      *'{{.ID}}'*) cat "${workspace}/containers" ;;
      *) cut -f3 "${workspace}/containers" ;;
    esac
    ;;
  "image ls")
    case "$4" in
      *'{{.Size}}'*) awk '{ print "123MB\\t" $0 }' "${workspace}/images" ;;
      *) cat "${workspace}/images" ;;
    esac
    ;;
  "image rm") grep -Fxq -- "$3" "${workspace}/failing" && exit 1 ;;
  "system df") echo "TYPE TOTAL ACTIVE SIZE RECLAIMABLE" ;;
  "rm -f"|"rm "*|"rm")
    target="$2"
    if [ "$2" = -f ]; then target="$3"; fi
    grep -Fxq -- "$target" "${workspace}/failing-containers" && exit 1
    # A removed container stops pinning its image, which is the whole point
    # of doing the sweep before the image list is read again.
    awk -F'\\t' -v id="$target" '$1 != id' "${workspace}/containers" > "${workspace}/containers.next"
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
  // Restore read access so afterEach can delete the workspace.
  for (const key of runtime.unreadable ?? []) chmodSync(paths[key], 0o600);
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
  calls
    .filter((call) => /^rm (?:-f )?\S+$/.test(call))
    .map((call) => call.replace(/^rm (?:-f )?/, ''));

const forcedContainers = (calls: readonly string[]): readonly string[] =>
  calls.filter((call) => /^rm -f \S+$/.test(call)).map((call) => call.slice('rm -f '.length));

const isRoot = process.getuid?.() === 0;

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
    // A stopped container needs no force, so it does not get any.
    expect(forcedContainers(dockerCalls)).toEqual([]);
    // The sweep runs before the image loop reads `docker ps -a` again, so the
    // image is no longer in use by the time it is considered.
    expect(removedImages(dockerCalls)).toEqual([`fluxradar-api:${STOPPED_CONTAINER}`]);
    expect(output).toContain('removing exited container stale1');
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

  describe('a container of a vanished release that is still running', () => {
    it.each(['running', 'restarting', 'paused'] as const)(
      'force-removes a %s container nothing live points at, then its image',
      (state) => {
        // The seven containers that kept the 38 GB disk at 8.5 GB free: their
        // releases were pruned long ago, Caddy proxies someone else entirely,
        // and each one pinned a ~1 GB image.
        const { exitCode, dockerCalls, output } = reclaim({
          releases: [LIVE],
          images: [`fluxradar-api:${LIVE}`, `fluxradar-web:${RUNNING_CONTAINER}`],
          containers: [
            { id: 'serving1', image: `fluxradar-api:${LIVE}`, state: 'running' },
            { id: 'orphan1', image: `fluxradar-web:${RUNNING_CONTAINER}`, state },
          ],
        });

        expect(exitCode).toBe(0);
        expect(removedContainers(dockerCalls)).toEqual(['orphan1']);
        expect(forcedContainers(dockerCalls)).toEqual(['orphan1']);
        expect(removedImages(dockerCalls)).toEqual([`fluxradar-web:${RUNNING_CONTAINER}`]);
        expect(output).toContain(`removing ${state} container orphan1`);
        expect(output).toContain(`release ${RUNNING_CONTAINER} has no directory`);
      },
    );

    it('keeps it when the state file names it as the live container', () => {
      // A host patch: the live api container was recreated by hand on an older
      // image, so what serves production is named after a release whose
      // directory is gone. active.env is the only record of that.
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${ORPHAN}`],
        containers: [{ id: 'patched1', image: `fluxradar-api:${ORPHAN}`, state: 'running' }],
        runtime: {
          state: activeEnv(join('/app'), LIVE, [
            `FLUXRADAR_API_CONTAINER=${apiContainer(ORPHAN)}`,
            `FLUXRADAR_API_UPSTREAM=${apiUpstream(ORPHAN)}`,
          ]),
          caddyfile: generatedCaddyfile(apiUpstream(ORPHAN), webUpstream(LIVE)),
        },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(removedImages(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container patched1');
      expect(output).toContain('the live release still points at it');
    });

    it('keeps it when only the generated Caddyfile still proxies to it', () => {
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-web:${ORPHAN}`],
        containers: [{ id: 'proxied1', image: `fluxradar-web:${ORPHAN}`, state: 'running' }],
        runtime: {
          // active.env still names LIVE, but traffic goes to the orphan.
          caddyfile: generatedCaddyfile(apiUpstream(LIVE), webUpstream(ORPHAN)),
        },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container proxied1');
    });

    it('keeps it when the recorded rollback target names it', () => {
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${ORPHAN}`],
        containers: [
          { id: 'target1', name: 'fluxradar-api-patched', image: `fluxradar-api:${ORPHAN}` },
        ],
        runtime: {
          rollback: [
            `FLUXRADAR_ROLLBACK_RELEASE_ID=${ORPHAN}`,
            'FLUXRADAR_ROLLBACK_API_CONTAINER=fluxradar-api-patched',
          ].join('\n'),
        },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container target1');
    });

    it('keeps it when the recorded rollback target names its image', () => {
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${ORPHAN}`],
        containers: [
          { id: 'byimage1', name: 'fluxradar-api-handmade', image: `fluxradar-api:${ORPHAN}` },
        ],
        runtime: {
          rollback: `FLUXRADAR_ROLLBACK_API_IMAGE=fluxradar-api:${ORPHAN}`,
        },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container byimage1');
    });

    it('keeps it when the rollback target records the image ID it runs, and keeps that image', () => {
      // release.sh resolves the rollback target's images with `docker inspect
      // --format '{{.Image}}'` and records them as `sha256:` IDs, never as
      // repository:tag, and rollback-release.sh refuses to roll back without
      // those exact digests. Here the container holding one was recreated by
      // hand under a name no runtime file knows, so the ID is the only match.
      const rollbackImage = imageId('patched-api');
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${ORPHAN}`],
        containers: [
          { id: 'byid1', name: 'fluxradar-api-handmade', image: `fluxradar-api:${ORPHAN}` },
        ],
        imageIds: { [`fluxradar-api:${ORPHAN}`]: rollbackImage },
        runtime: { rollback: `FLUXRADAR_ROLLBACK_API_IMAGE=${rollbackImage}` },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(removedImages(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container byid1');
      expect(output).toContain('the live release still points at it');
    });

    it('keeps it when that ID is recorded without the sha256: prefix', () => {
      const rollbackImage = imageId('patched-web');
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-web:${ORPHAN}`],
        containers: [
          { id: 'bare1', name: 'fluxradar-web-handmade', image: `fluxradar-web:${ORPHAN}` },
        ],
        imageIds: { [`fluxradar-web:${ORPHAN}`]: rollbackImage },
        runtime: {
          rollback: `FLUXRADAR_ROLLBACK_WEB_IMAGE=${rollbackImage.replace('sha256:', '')}`,
        },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(removedImages(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container bare1');
    });

    it('keeps it when docker will not say which image it runs', () => {
      // Without the ID there is nothing to match against the recorded rollback
      // images, so the container stays and keeps pinning whatever it runs.
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-web:${RUNNING_CONTAINER}`],
        containers: [{ id: 'opaque1', image: `fluxradar-web:${RUNNING_CONTAINER}` }],
        inspectFails: ['opaque1'],
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(removedImages(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container opaque1');
      expect(output).toContain('docker would not report the image it runs');
    });

    it('keeps a container of the active release even when its directory is gone', () => {
      // FLUXRADAR_ACTIVE_RELEASE is the live release whatever the disk says, so
      // a missing directory must never turn its containers into orphans.
      const { dockerCalls, output } = reclaim({
        releases: [],
        images: [`fluxradar-api:${ORPHAN}`, `fluxradar-web:${ORPHAN}`],
        containers: [
          { id: 'active1', image: `fluxradar-api:${ORPHAN}` },
          { id: 'active2', image: `fluxradar-web:${ORPHAN}` },
        ],
        runtime: {
          state: activeEnv(join('/app'), ORPHAN),
          caddyfile: generatedCaddyfile(apiUpstream(ORPHAN), webUpstream(ORPHAN)),
          current: ORPHAN,
        },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(removedImages(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container active1');
      expect(output).toContain('keeping container active2');
    });

    it('keeps a container of the release the `current` symlink still points at', () => {
      // A dangling `current` is a real rollback target whose directory is gone.
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-web:${ORPHAN}`],
        containers: [{ id: 'dangling1', image: `fluxradar-web:${ORPHAN}` }],
        runtime: { current: ORPHAN },
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container dangling1');
    });

    it('never forces a rollback probe, which a deploy may still be using', () => {
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${ORPHAN}`],
        containers: [
          {
            id: 'probe1',
            name: `fluxradar-rollback-probe-${ORPHAN}`,
            image: `fluxradar-api:${ORPHAN}`,
          },
        ],
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container probe1');
      expect(output).toContain('it is a rollback probe');
    });

    it('leaves a container docker is already removing alone', () => {
      const { dockerCalls, output } = reclaim({
        releases: [LIVE],
        images: [`fluxradar-api:${ORPHAN}`],
        containers: [{ id: 'going1', image: `fluxradar-api:${ORPHAN}`, state: 'removing' }],
      });

      expect(removedContainers(dockerCalls)).toEqual([]);
      expect(output).toContain('keeping container going1');
      expect(output).toContain('it is removing');
    });
  });

  describe('without trustworthy evidence of what is live', () => {
    const orphanHost = (runtime: Runtime): Host => ({
      releases: [LIVE],
      images: [`fluxradar-api:${ORPHAN}`, `fluxradar-web:${ORPHAN}`],
      containers: [
        { id: 'running1', image: `fluxradar-api:${ORPHAN}`, state: 'running' },
        { id: 'stopped1', image: `fluxradar-web:${ORPHAN}`, state: 'exited' },
      ],
      runtime,
    });

    it('keeps every running container when the state file is missing, and says why', () => {
      const { exitCode, dockerCalls, output } = reclaim(orphanHost({ state: null }));

      expect(exitCode).toBe(0);
      // The stopped half of the old behaviour still runs.
      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(removedImages(dockerCalls)).toEqual([`fluxradar-web:${ORPHAN}`]);
      expect(output).toContain('keeping every running container');
      expect(output).toContain('active.env is missing or unreadable');
      expect(output).toContain('keeping container running1');
    });

    it.skipIf(isRoot)('keeps every running container when the state file is unreadable', () => {
      const { dockerCalls, output } = reclaim(orphanHost({ unreadable: ['state'] }));

      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(output).toContain('active.env is missing or unreadable');
    });

    it.skipIf(isRoot)('keeps every running container when the Caddyfile is unreadable', () => {
      const { dockerCalls, output } = reclaim(orphanHost({ unreadable: ['caddyfile'] }));

      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(output).toContain('Caddyfile is missing or unreadable');
    });

    it.skipIf(isRoot)('keeps every running container when rollback.env is unreadable', () => {
      const { dockerCalls, output } = reclaim(
        orphanHost({
          rollback: `FLUXRADAR_ROLLBACK_RELEASE_ID=${ROLLBACK}`,
          unreadable: ['rollback'],
        }),
      );

      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(output).toContain('rollback.env is unreadable');
    });

    it('keeps every running container when the Caddyfile is missing', () => {
      const { dockerCalls, output } = reclaim(orphanHost({ caddyfile: null }));

      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(output).toContain('Caddyfile is missing or unreadable');
    });

    it('keeps every running container when the state file names no live release', () => {
      const { dockerCalls, output } = reclaim(
        orphanHost({ state: 'FLUXRADAR_GOOGLE_LOGIN_REQUIRED=false' }),
      );

      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(output).toContain('names no live release, api/web container and upstream');
    });

    it('keeps every running container when the Caddyfile and the state file disagree', () => {
      const { dockerCalls, output } = reclaim(
        orphanHost({ caddyfile: generatedCaddyfile(apiUpstream(ROLLBACK), webUpstream(ROLLBACK)) }),
      );

      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(output).toContain('does not name the upstreams');
    });

    it('keeps every running container when there is no `current` symlink', () => {
      const { dockerCalls, output } = reclaim(orphanHost({ current: null }));

      expect(removedContainers(dockerCalls)).toEqual(['stopped1']);
      expect(output).toContain('does not exist, so no release is provably live');
    });
  });

  it('never removes a container of another project, or one on a tag that is not a release id', () => {
    const { dockerCalls } = reclaim({
      releases: [LIVE],
      images: [],
      containers: [
        { id: 'postgres1', name: 'fluxradar-postgres', image: 'postgres:16-alpine' },
        { id: 'caddy1', name: 'fluxradar-caddy', image: 'caddy:2' },
        { id: 'other1', name: 'other-app-api', image: `other-app-api:${ORPHAN}` },
        { id: 'latest1', name: 'fluxradar-api-latest', image: 'fluxradar-api:latest' },
        { id: 'short1', name: 'fluxradar-api-abc', image: 'fluxradar-api:abc' },
        { id: 'id1', name: 'by-image-id', image: 'sha256:' + 'a'.repeat(64) },
        {
          id: 'postgres2',
          name: 'fluxradar-postgres-old',
          image: 'postgres:16-alpine',
          state: 'exited',
        },
      ],
    });

    expect(removedContainers(dockerCalls)).toEqual([]);
  });

  it('carries on and exits 0 when a container cannot be removed', () => {
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

  it('keeps an image the rollback target records by ID with no container left to pin it', () => {
    // The harm the ID match prevents: the container that held the recorded
    // rollback image is gone — swept above as a stopped orphan, or never named
    // in rollback.env at all — and removing its tag here would delete the exact
    // digest rollback-release.sh refuses to roll back without.
    const rollbackImage = imageId('patched-api');
    const { dockerCalls, output } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${ORPHAN}`, `fluxradar-web:${ORPHAN}`],
      imageIds: { [`fluxradar-api:${ORPHAN}`]: rollbackImage },
      runtime: { rollback: `FLUXRADAR_ROLLBACK_API_IMAGE=${rollbackImage}` },
    });

    // The web orphan the evidence says nothing about is still reclaimed.
    expect(removedImages(dockerCalls)).toEqual([`fluxradar-web:${ORPHAN}`]);
    expect(output).toContain(`keeping fluxradar-api:${ORPHAN}`);
    expect(output).toContain(rollbackImage);
  });

  it('sweeps a stopped orphan but keeps the image its ID is recorded as', () => {
    // A rollback recreates its containers from the image, so the stopped one is
    // still removable; the image it was pinning is not.
    const rollbackImage = imageId('patched-api');
    const { dockerCalls } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${ORPHAN}`],
      containers: [{ id: 'stale1', image: `fluxradar-api:${ORPHAN}`, state: 'exited' }],
      imageIds: { [`fluxradar-api:${ORPHAN}`]: rollbackImage },
      runtime: { rollback: `FLUXRADAR_ROLLBACK_API_IMAGE=${rollbackImage}` },
    });

    expect(removedContainers(dockerCalls)).toEqual(['stale1']);
    expect(removedImages(dockerCalls)).toEqual([]);
  });

  it('keeps an image whose ID docker will not report', () => {
    const { dockerCalls, output } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${ORPHAN}`],
      inspectFails: [`fluxradar-api:${ORPHAN}`],
    });

    expect(removedImages(dockerCalls)).toEqual([]);
    expect(output).toContain('docker would not report its image id');
  });

  it('prunes dangling images and the whole build cache, and nothing else', () => {
    const { dockerCalls } = reclaim({ releases: [LIVE], images: [] });

    expect(dockerCalls).toContain('image prune --force');
    // No `until=` filter: deploy.yml builds both images on the runner and ships
    // them with `docker load`, so this host never builds and no cache here is
    // worth keeping, however fresh.
    expect(dockerCalls).toContain('builder prune --force');
    expect(dockerCalls.filter((call) => call.startsWith('builder prune'))).toEqual([
      'builder prune --force',
    ]);
    // PostgreSQL's data is a volume; a container or network prune would also
    // reach the previous release's stopped containers a rollback starts from.
    // `system df` only reports, so it is the one `system` call allowed.
    expect(
      dockerCalls.filter(
        (call) => /^(volume|system|container|network)\b/.test(call) && call !== 'system df',
      ),
    ).toEqual([]);
  });

  it('reports what occupies the disk before and after, so the next log shows it', () => {
    const { output, dockerCalls } = reclaim({
      releases: [LIVE],
      images: [`fluxradar-api:${LIVE}`],
    });

    expect(output).toContain('----- remote disk usage (before reclaiming) -----');
    expect(output).toContain('----- docker disk usage (before reclaiming) -----');
    expect(output).toContain('----- docker images with sizes (before reclaiming) -----');
    expect(output).toContain('----- docker disk usage (after reclaiming) -----');
    expect(output).toContain('----- docker images with sizes (after reclaiming) -----');
    expect(output).toContain('----- remote disk usage (after reclaiming) -----');
    expect(dockerCalls.filter((call) => call === 'system df')).toHaveLength(2);
    expect(
      dockerCalls.filter(
        (call) => call.startsWith('image ls --format') && call.includes('{{.Size}}'),
      ),
    ).toHaveLength(2);
    // The sizes themselves reach the log, not just the header.
    expect(output).toContain(`123MB\tfluxradar-api:${LIVE}`);
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
    // The script derives runtime/active.env, runtime/Caddyfile and `current`
    // from APP_DIR the way release.sh does, so it still takes one argument.
    expect(job('reclaim')).toContain('bash -s -- "$APP_DIR" < deploy/reclaim-disk.sh');
    expect(prerequisites('image')).toEqual(expect.arrayContaining(['reclaim', 'package']));
    expect(job('package')).toContain('needs: reclaim');
  });
});
