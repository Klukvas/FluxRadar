import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-021: pruning old releases must never delete the live release or the
// recorded rollback target (D-230).
//
// deploy/release.sh used to keep the newest 3 release directories by mtime
// and delete the rest. A failed deploy still uploads its release directory
// before it fails, so that directory's mtime is newer than the rollback
// target runtime/rollback.env recorded — and "newest 3" then deleted the
// target while it was still recorded. Once gone, the contract-phase gate
// refused every later deploy, because it can never verify a target that is
// not on the server, and nothing un-records it short of a successful deploy —
// which the refusal itself was now blocking.
//
// deploy/release.sh's prune_old_releases keeps the live release and the
// recorded target regardless of mtime, then prunes the rest to the newest
// two. This runs that function — extracted from the real script — against a
// fake releases/ tree where later, failed uploads are newer than the target.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const RELEASE_SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'release.sh');
const BEGIN_MARKER = '# fluxradar:release-pruning';
const END_MARKER = '# fluxradar:end-release-pruning';

/** The `prune_old_releases` function, dedented exactly as it ships. */
function extractPruningFunction(): string {
  const lines = readFileSync(RELEASE_SCRIPT_PATH, 'utf8').split('\n');
  const begin = lines.findIndex((line) => line.trim().startsWith(BEGIN_MARKER));
  const end = lines.findIndex((line) => line.trim().startsWith(END_MARKER));
  expect(begin, `${BEGIN_MARKER} is missing from deploy/release.sh`).toBeGreaterThan(-1);
  expect(end, `${END_MARKER} is missing from deploy/release.sh`).toBeGreaterThan(begin);
  return lines.slice(begin, end + 1).join('\n');
}

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

interface Layout {
  /** Release directory names, oldest mtime first. */
  readonly onDisk: readonly string[];
  /** `current` points at this one. */
  readonly live: string;
  /** What runtime/rollback.env records; a name not in onDisk simulates "pruned". */
  readonly rollbackTarget: string;
}

function prune(layout: Layout): {
  readonly remaining: readonly string[];
  readonly imageRmCalls: string[];
} {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'fluxradar-prune-')));
  workspaces.push(workspace);
  const appDir = join(workspace, 'app');
  mkdirSync(join(appDir, 'releases'), { recursive: true });
  mkdirSync(join(appDir, 'runtime'), { recursive: true });

  const base = Date.now() / 1000 - 3600;
  layout.onDisk.forEach((name, index) => {
    const dir = join(appDir, 'releases', name);
    mkdirSync(dir, { recursive: true });
    const at = base + index * 60;
    utimesSync(dir, at, at);
  });
  symlinkSync(join(appDir, 'releases', layout.live), join(appDir, 'current'));
  writeFileSync(
    join(appDir, 'runtime', 'rollback.env'),
    `FLUXRADAR_ROLLBACK_RELEASE=${join(appDir, 'releases', layout.rollbackTarget)}\n`,
  );

  const binDir = join(workspace, 'bin');
  mkdirSync(binDir, { recursive: true });
  const dockerLog = join(workspace, 'docker.log');
  writeFileSync(dockerLog, '');
  const docker = join(binDir, 'docker');
  writeFileSync(docker, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${dockerLog}"\nexit 0\n`);
  chmodSync(docker, 0o755);

  const scriptPath = join(workspace, 'prune.sh');
  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash\nset -eu\nset -o pipefail\n${extractPruningFunction()}\nprune_old_releases "$1"\n`,
  );

  execFileSync('bash', [scriptPath, appDir], {
    encoding: 'utf8',
    env: { PATH: `${binDir}:${process.env.PATH ?? ''}` },
  });

  return {
    remaining: readdirSync(join(appDir, 'releases')).sort(),
    imageRmCalls: readFileSync(dockerLog, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('image rm')),
  };
}

describe('DEPLOY-021 release pruning', () => {
  it('keeps the live release and the recorded rollback target even when later failed uploads are newer', () => {
    // R1..R3 in upload order; a failed deploy after R3 left R4 and R5 on disk
    // with newer mtimes than the rollback target (R3), which is still live's
    // predecessor and still recorded in runtime/rollback.env.
    const { remaining, imageRmCalls } = prune({
      onDisk: ['R1', 'R2', 'R3', 'R4', 'R5'],
      live: 'R3',
      rollbackTarget: 'R2',
    });

    expect(remaining).toContain('R3'); // live
    expect(remaining).toContain('R2'); // recorded rollback target
    // Newest two of the rest (R4, R5) survive the normal "keep newest" bound.
    expect(remaining).toContain('R4');
    expect(remaining).toContain('R5');
    expect(remaining).not.toContain('R1');
    expect(imageRmCalls.some((call) => call.includes('R1'))).toBe(true);
    expect(imageRmCalls.some((call) => call.includes('R2'))).toBe(false);
    expect(imageRmCalls.some((call) => call.includes('R3'))).toBe(false);
  });

  it('prunes an ordinary old release that is neither live nor the recorded target', () => {
    const { remaining } = prune({
      onDisk: ['R1', 'R2', 'R3', 'R4', 'R5'],
      live: 'R5',
      rollbackTarget: 'R4',
    });

    expect(remaining).toEqual(['R2', 'R3', 'R4', 'R5'].sort());
  });

  it('does nothing when the recorded target is already gone from disk', () => {
    const { remaining } = prune({
      onDisk: ['R1', 'R2', 'R3'],
      live: 'R3',
      rollbackTarget: 'already-pruned',
    });

    // No candidate resolves to the missing target, so it changes nothing
    // beyond the ordinary "keep newest two besides live" bound.
    expect(remaining).toEqual(['R1', 'R2', 'R3'].sort());
  });
});
