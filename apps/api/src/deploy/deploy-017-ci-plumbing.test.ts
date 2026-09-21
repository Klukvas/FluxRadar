import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import { extractWorkflowStep } from '../test-utils/workflow-step.ts';

// DEPLOY-017: the CI plumbing the staged pipeline added, run rather than read.
//
// The code review of the staged pipeline found three pieces of new logic with
// no test at all: the remote-upload action every artifact goes through, the
// exit-code handling of the manual rollback workflow, and the lint partition
// the quality gates rely on to cover every file. Each one is extracted from the
// file that ships and RUN here — the upload against an `ssh` that executes
// locally, the rollback against a recorded one.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const REMOTE_UPLOAD_PATH = join(REPO_ROOT, '.github', 'actions', 'remote-upload', 'action.yml');
const ROLLBACK_WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'rollback.yml');
const QUALITY_WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'quality.yml');
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json');

const RELEASE_ID = 'cccccccccccccccccccccccccccccccccccccccc';

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function workspace(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  workspaces.push(dir);
  return dir;
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

describe('DEPLOY-017 CI plumbing', () => {
  // ---------------------------------------------------------------------------
  describe('the remote-upload action', () => {
    /**
     * `ssh` that runs the remote command HERE. Real ssh joins its arguments into
     * one string that the remote shell parses again, so `bash -c "$*"` is the
     * faithful model — including for the quoting this action depends on.
     */
    const SSH_LOCAL = String.raw`#!/usr/bin/env bash
shift
printf '%s\n' "$*" >> "$SSH_LOG"
if [ -n "$SSH_FAIL_MATCH" ] && [[ "$*" == *"$SSH_FAIL_MATCH"* ]]; then exit 1; fi
exec bash -c "$*"
`;
    const SCP_LOCAL = String.raw`#!/usr/bin/env bash
printf 'scp %s\n' "$*" >> "$SSH_LOG"
exec cp "$1" "${'$'}{2#*:}"
`;
    /** A disk with 10 KiB free when LOW_DISK=1, the real one otherwise. */
    const DF_STUB = String.raw`#!/usr/bin/env bash
if [ "$LOW_DISK" = "1" ]; then
  printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 1000 990 10 99%% /\n'
  exit 0
fi
exec /bin/df "$@"
`;

    interface Upload {
      readonly exitCode: number;
      readonly output: string;
      readonly appDir: string;
      readonly stageDir: string;
      readonly sshLog: string;
    }

    function upload(options: {
      install?: string;
      lowDisk?: boolean;
      files?: 'one' | 'none';
      sshFailMatch?: string;
    }): Upload {
      const root = workspace('fluxradar-remote-upload-');
      const appDir = join(root, 'app');
      const runnerTemp = join(root, 'runner');
      const binDir = join(root, 'bin');
      mkdirSync(appDir);
      mkdirSync(runnerTemp);
      mkdirSync(binDir);
      writeExecutable(join(binDir, 'ssh'), SSH_LOCAL);
      writeExecutable(join(binDir, 'scp'), SCP_LOCAL);
      writeExecutable(join(binDir, 'df'), DF_STUB);
      const artifact = join(runnerTemp, 'fluxradar-api.tar');
      writeFileSync(artifact, 'image bytes\n');
      const sshLog = join(root, 'ssh.log');
      writeFileSync(sshLog, '');

      const scriptPath = join(root, 'upload.sh');
      const step = extractWorkflowStep(REMOTE_UPLOAD_PATH, '    - name: Upload and install');
      writeFileSync(scriptPath, step.script);
      const result = spawnSync('bash', [...step.bashArgs, scriptPath], {
        encoding: 'utf8',
        env: {
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          HOME: root,
          RUNNER_TEMP: runnerTemp,
          SSH_HOST: 'server.invalid',
          SSH_USER: 'fluxradar',
          APP_DIR: appDir,
          RELEASE_ID,
          STAGE: 'api-image',
          UPLOAD_FILES: options.files === 'none' ? '\n' : `${artifact}\n`,
          INSTALL_SCRIPT:
            options.install ??
            'printf "%s|%s|%s|%s\\n" "$APP_DIR" "$RELEASE_ID" "$STAGE" "$STAGE_DIR" > "$APP_DIR/installed"\n' +
              'cp "$STAGE_DIR/fluxradar-api.tar" "$APP_DIR/loaded.tar"',
          SSH_LOG: sshLog,
          SSH_FAIL_MATCH: options.sshFailMatch ?? '',
          LOW_DISK: options.lowDisk ? '1' : '',
        },
      });
      return {
        exitCode: result.status ?? 1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        appDir,
        stageDir: join(appDir, 'incoming', RELEASE_ID, 'api-image'),
        sshLog: readFileSync(sshLog, 'utf8'),
      };
    }

    it('delivers the file and runs the install with the four names it promises', () => {
      const run = upload({});
      expect(run.exitCode).toBe(0);
      expect(readFileSync(join(run.appDir, 'loaded.tar'), 'utf8')).toBe('image bytes\n');
      expect(readFileSync(join(run.appDir, 'installed'), 'utf8').trim()).toBe(
        `${run.appDir}|${RELEASE_ID}|api-image|${run.stageDir}`,
      );
      // Nothing is left behind on success.
      expect(existsSync(run.stageDir)).toBe(false);
    });

    it('removes its staging directory, and fails, when the install fails', () => {
      const run = upload({ install: 'echo "docker load failed" >&2; exit 7' });
      expect(run.exitCode).not.toBe(0);
      expect(existsSync(run.stageDir)).toBe(false);
    });

    it('refuses before a single byte is copied onto a full disk', () => {
      const run = upload({ lowDisk: true });
      expect(run.exitCode).not.toBe(0);
      expect(run.output).toContain('insufficient free space for the api-image artifact');
      expect(run.sshLog).not.toContain('scp ');
      expect(existsSync(run.stageDir)).toBe(false);
    });

    it('refuses an empty file list instead of uploading nothing successfully', () => {
      const run = upload({ files: 'none' });
      expect(run.exitCode).not.toBe(0);
      expect(run.output).toContain('was given no files');
    });

    it('says so when it cannot clean up, without failing an upload that worked', () => {
      const run = upload({ sshFailMatch: 'rm -rf' });
      expect(run.exitCode).toBe(0);
      expect(run.output).toContain('::warning title=Staging directory not removed::');
    });
  });

  // ---------------------------------------------------------------------------
  describe('the manual rollback workflow', () => {
    const SSH_RECORDER = String.raw`#!/usr/bin/env bash
{ printf 'SSH ARGS: %s\n' "$*"; printf 'SSH STDIN:\n'; cat; } >> "$SSH_LOG"
exit "$SSH_EXIT"
`;
    const SMOKE_STUB = String.raw`#!/usr/bin/env bash
printf 'SMOKE %s\n' "$*" >> "$SMOKE_LOG"
count=$(grep -c '^SMOKE ' "$SMOKE_LOG")
code=$(printf '%s\n' $SMOKE_RESULTS | sed -n "$count"p)
exit "${'$'}{code:-0}"
`;

    function rollback(rollbackExit: number, smokeResults = '0') {
      const root = workspace('fluxradar-rollback-workflow-');
      const binDir = join(root, 'bin');
      mkdirSync(binDir);
      mkdirSync(join(root, 'deploy'));
      writeExecutable(join(binDir, 'ssh'), SSH_RECORDER);
      writeExecutable(join(root, 'deploy', 'public-smoke.sh'), SMOKE_STUB);
      const sshLog = join(root, 'ssh.log');
      const smokeLog = join(root, 'smoke.log');
      writeFileSync(sshLog, '');
      writeFileSync(smokeLog, '');
      const step = extractWorkflowStep(ROLLBACK_WORKFLOW_PATH, '      - name: Roll back');
      writeFileSync(join(root, 'step.sh'), step.script);
      const result = spawnSync('bash', [...step.bashArgs, 'step.sh'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          SSH_HOST: 'server.invalid',
          SSH_USER: 'fluxradar',
          APP_DIR: '/opt/fluxradar',
          PUBLIC_HOST: 'fluxradar.net',
          SSH_LOG: sshLog,
          SSH_EXIT: String(rollbackExit),
          SMOKE_LOG: smokeLog,
          SMOKE_RESULTS: smokeResults,
        },
      });
      return {
        exitCode: result.status ?? 1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
        sshLog: readFileSync(sshLog, 'utf8'),
        smokeCalls: readFileSync(smokeLog, 'utf8').split('\n').filter(Boolean),
      };
    }

    it('rolls back the release `current` points at, with the shipped script', () => {
      const run = rollback(0);
      expect(run.sshLog).toContain('SSH ARGS: fluxradar@server.invalid bash -s -- /opt/fluxradar');
      expect(run.sshLog).toContain(
        'bash "$CURRENT/deploy/rollback-release.sh" "$APP_DIR" "$CURRENT"',
      );
    });

    it('passes only when the restored release answers from outside', () => {
      const run = rollback(0, '0');
      expect(run.exitCode).toBe(0);
      expect(run.output).toContain(
        'Rolled back: the previous release is serving fluxradar.net again.',
      );
      expect(run.smokeCalls).toEqual(['SMOKE --host fluxradar.net']);

      const stillBroken = rollback(0, '1');
      expect(stillBroken.exitCode).toBe(1);
      expect(stillBroken.output).toContain('still fails the public smoke test');
    });

    it('names a missing rollback target, and changes nothing it did not say', () => {
      const run = rollback(3);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('names no earlier release, so NOTHING was changed');
      expect(run.smokeCalls).toEqual([]);
    });

    // The second press of the button, after a deploy that rolled itself back.
    it('reports "nothing to roll back" as its own outcome, and still checks the site', () => {
      const healthy = rollback(4, '0');
      expect(healthy.exitCode).toBe(1);
      expect(healthy.output).toContain('Nothing was rolled back');
      expect(healthy.output).toContain('that release is serving fluxradar.net correctly');
      expect(healthy.output).not.toContain('Rolled back: the previous release');

      const broken = rollback(4, '1');
      expect(broken.exitCode).toBe(1);
      expect(broken.output).toContain('CRITICAL: and that release fails the public smoke test too');
    });

    it('never passes a rollback that failed, and does not pretend to re-check it', () => {
      for (const code of [1, 2, 255]) {
        const run = rollback(code);
        expect(run.exitCode, `rollback exit ${code}`).toBe(1);
        expect(run.output, `rollback exit ${code}`).toContain('CRITICAL: the rollback failed');
        expect(run.smokeCalls, `rollback exit ${code}`).toEqual([]);
      }
    });

    it('does nothing at all unless the operator typed the phrase', () => {
      const confirmStep = extractWorkflowStep(
        ROLLBACK_WORKFLOW_PATH,
        '      - name: Check the confirmation',
      );
      const confirm = (typed: string) =>
        spawnSync('bash', [...confirmStep.bashArgs, '-c', confirmStep.script], {
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH ?? '',
            CONFIRM: typed,
            CONFIRMATION_PHRASE: 'roll back production',
          },
        }).status;
      expect(confirm('roll back production')).toBe(0);
      expect(confirm('yes')).toBe(1);
      expect(confirm('')).toBe(1);
    });

    it('defines the phrase and the host the steps read, once', () => {
      const workflow = readFileSync(ROLLBACK_WORKFLOW_PATH, 'utf8');
      expect(workflow).toMatch(/^ {2}CONFIRMATION_PHRASE: roll back production$/m);
      expect(workflow).toMatch(/^ {2}PUBLIC_HOST: fluxradar\.net$/m);
      // The input's description cannot read a variable, so it repeats the phrase;
      // it must still be the same phrase.
      expect(workflow).toContain('Type "roll back production" to confirm.');
    });
  });

  // ---------------------------------------------------------------------------
  // The two lint jobs have to cover every file `eslint .` covers, and no file
  // twice. The backend half is defined as "everything the frontend half does not
  // take", so the partition holds as long as the frontend's paths and the
  // backend's ignore patterns are the same list.
  describe('the lint partition', () => {
    const scripts = (
      JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;

    it('lints everything on the backend side except what the frontend side takes', () => {
      const backend = scripts['lint:backend'] ?? '';
      const frontend = scripts['lint:frontend'] ?? '';
      expect(backend).toMatch(/^eslint \. /);
      const ignored = [...backend.matchAll(/--ignore-pattern "([^"]+)\/\*\*"/g)].map((m) => m[1]);
      const taken = frontend.replace(/^eslint /, '').split(/\s+/);
      expect(ignored.length).toBeGreaterThan(0);
      expect([...ignored].sort()).toEqual([...taken].sort());
    });

    it('runs both halves in the quality gates', () => {
      const quality = readFileSync(QUALITY_WORKFLOW_PATH, 'utf8');
      expect(quality).toContain('run: pnpm lint:backend');
      expect(quality).toContain('run: pnpm lint:frontend');
    });
  });
});
