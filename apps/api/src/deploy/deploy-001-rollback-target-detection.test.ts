import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-001: which release the deploy rolls back to.
//
// The production deploy resolves `$APP_DIR/current` into PREVIOUS_RELEASE and
// PREVIOUS_RELEASE_ID, and an empty id means "first deploy, no rollback target,
// skip the compatibility gate". Getting that wrong is not cosmetic: `readlink -f`
// under GNU coreutils prints a path even when the LAST component does not exist,
// so a first deploy used to produce PREVIOUS_RELEASE_ID=current, look for the
// image `fluxradar-api:current`, and abort a deploy that had nothing to roll back
// to.
//
// The shell below is not a copy of the workflow — it is EXTRACTED from it between
// the markers, so this test cannot drift away from what actually ships.

const WORKFLOW_PATH = join(API_PACKAGE_ROOT, '..', '..', '.github', 'workflows', 'deploy.yml');
const BEGIN_MARKER = '# fluxradar:rollback-target-detection';
const END_MARKER = '# fluxradar:end-rollback-target-detection';

/** The workflow's own resolution lines, dedented out of the YAML block scalar. */
function extractDetectionBlock(): string {
  const lines = readFileSync(WORKFLOW_PATH, 'utf8').split('\n');
  const begin = lines.findIndex((line) => line.trim().startsWith(BEGIN_MARKER));
  const end = lines.findIndex((line) => line.trim().startsWith(END_MARKER));
  expect(begin, `${BEGIN_MARKER} is missing from the deploy workflow`).toBeGreaterThan(-1);
  expect(end, `${END_MARKER} is missing from the deploy workflow`).toBeGreaterThan(begin);
  const block = lines.slice(begin, end + 1);
  const indent = (block[0] ?? '').length - (block[0] ?? '').trimStart().length;
  return block.map((line) => line.slice(indent)).join('\n');
}

/**
 * GNU `readlink -f` prints the resolved path even when the last component is
 * missing; BSD `readlink -f` (macOS) fails instead. Production runs on Linux, so
 * the stricter GNU behaviour is emulated as well and every case is asserted
 * against BOTH — otherwise this suite would pass locally on exactly the platform
 * where the bug cannot reproduce.
 */
const GNU_READLINK_STUB = `
readlink() {
  stub_path="$2"
  if [ -L "$stub_path" ]; then
    stub_target="$(command readlink "$stub_path")"
    case "$stub_target" in
      /*) printf '%s\\n' "$stub_target" ;;
      *) printf '%s\\n' "$(cd "$(dirname "$stub_path")" && pwd)/$stub_target" ;;
    esac
  else
    printf '%s\\n' "$(cd "$(dirname "$stub_path")" && pwd)/$(basename "$stub_path")"
  fi
}
`;

interface Detection {
  readonly exitCode: number;
  readonly previousRelease: string;
  readonly previousReleaseId: string;
  readonly isFirstDeploy: boolean;
  readonly stderr: string;
}

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function makeAppDir(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-deploy-'));
  workspaces.push(workspace);
  mkdirSync(join(workspace, 'releases'), { recursive: true });
  return workspace;
}

function runDetection(appDir: string, options: { gnuReadlink: boolean }): Detection {
  const script = [
    'set -eu',
    'APP_DIR="$1"',
    options.gnuReadlink ? GNU_READLINK_STUB : '',
    extractDetectionBlock(),
    // Exactly the condition the deploy uses to decide "first deploy".
    'if [ -z "$PREVIOUS_RELEASE_ID" ]; then FIRST_DEPLOY=yes; else FIRST_DEPLOY=no; fi',
    'printf "previous=%s\\nid=%s\\nfirst=%s\\n" "$PREVIOUS_RELEASE" "$PREVIOUS_RELEASE_ID" "$FIRST_DEPLOY"',
  ].join('\n');
  const scriptPath = join(appDir, 'detect.sh');
  writeFileSync(scriptPath, script);

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync('bash', [scriptPath, appDir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    exitCode = failure.status ?? 1;
    stdout = failure.stdout ?? '';
    stderr = failure.stderr ?? '';
  }
  const read = (key: string): string =>
    stdout
      .split('\n')
      .find((line) => line.startsWith(`${key}=`))
      ?.slice(key.length + 1) ?? '';
  return {
    exitCode,
    previousRelease: read('previous'),
    previousReleaseId: read('id'),
    isFirstDeploy: read('first') === 'yes',
    stderr,
  };
}

/** Both readlink flavours must decide identically; returns the shared result. */
function detect(appDir: string): Detection {
  const bsd = runDetection(appDir, { gnuReadlink: false });
  const gnu = runDetection(appDir, { gnuReadlink: true });
  expect(gnu.previousReleaseId, 'GNU and BSD readlink disagree on the rollback target').toBe(
    bsd.previousReleaseId,
  );
  expect(gnu.isFirstDeploy).toBe(bsd.isFirstDeploy);
  expect(gnu.exitCode).toBe(bsd.exitCode);
  return gnu;
}

describe('DEPLOY-001 rollback target detection', () => {
  it('reports a first deploy when no current symlink exists', () => {
    const result = detect(makeAppDir());

    expect(result.exitCode).toBe(0);
    expect(result.previousRelease).toBe('');
    expect(result.previousReleaseId).toBe('');
    expect(result.isFirstDeploy).toBe(true);
  });

  it('resolves the release an existing current symlink points at', () => {
    const appDir = makeAppDir();
    mkdirSync(join(appDir, 'releases', 'release-a'));
    symlinkSync(join(appDir, 'releases', 'release-a'), join(appDir, 'current'));

    const result = detect(appDir);

    expect(result.exitCode).toBe(0);
    expect(result.previousRelease.endsWith('/releases/release-a')).toBe(true);
    expect(result.previousReleaseId).toBe('release-a');
    expect(result.isFirstDeploy).toBe(false);
  });

  // A rollback target whose release directory was pruned is NOT a first deploy:
  // the gate has to keep running so the missing image is reported instead of
  // silently skipped.
  it('still reports a rollback target when current dangles', () => {
    const appDir = makeAppDir();
    symlinkSync(join(appDir, 'releases', 'release-gone'), join(appDir, 'current'));

    const result = detect(appDir);

    expect(result.previousReleaseId).toBe('release-gone');
    expect(result.isFirstDeploy).toBe(false);
  });

  // Fail closed on an unexpected layout too: a directory named `current` means
  // something is deployed, so the deploy must verify a rollback rather than
  // assume there is nothing to roll back to.
  it('does not treat a current directory as a first deploy', () => {
    const appDir = makeAppDir();
    mkdirSync(join(appDir, 'current'));

    const result = detect(appDir);

    expect(result.previousReleaseId).not.toBe('');
    expect(result.isFirstDeploy).toBe(false);
  });

  it('keeps the deploy gate keyed to the extracted variables', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    // The gate must read the id resolved above, never re-derive it from a path
    // that `readlink -f` invented.
    expect(workflow).toContain('if [ -z "$PREVIOUS_RELEASE_ID" ]; then');
    expect(workflow.match(/PREVIOUS_RELEASE_ID="\$\{PREVIOUS_RELEASE##\*\/}"/g)).toHaveLength(1);
  });
});
