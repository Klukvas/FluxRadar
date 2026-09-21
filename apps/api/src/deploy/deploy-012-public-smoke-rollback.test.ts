import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-012: the public smoke test has to be able to UNDO a release.
//
// The release script rolls back every failure it can still see. It cannot see
// this one: it has already exited 0, so its exit trap is gone, `current` points
// at the new release and the previous release's containers have been removed.
// The public smoke test then runs on the GitHub runner, from outside the server,
// and it is the only check that can see a certificate that was never issued, a
// DNS record that was never published or a proxy answering for someone else.
//
// Until now its failure did exactly nothing to the deployment: it printed
// diagnostics and failed the workflow, leaving the release it had just condemned
// serving production — while docs/DEPLOYMENT.md promised that "a failed rollout
// restores the previous images/release and switches the symlink back
// automatically".
//
// The logic lives in deploy/verify-release.sh, which both post-release stages
// run. It is RUN here against a recorded `ssh` and a scripted smoke test, so
// what is asserted is what the deploy does.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');
const VERIFY_SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'verify-release.sh');

const APP_DIR = '/opt/fluxradar';
const RELEASE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';


const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/**
 * `ssh` that records the command line and the heredoc it was fed, so the remote
 * script the step sends can be asserted without a server.
 */
const SSH_RECORDER = String.raw`#!/usr/bin/env bash
{
  printf 'SSH ARGS: %s\n' "$*"
  printf 'SSH STDIN:\n'
  cat
  printf 'SSH END\n'
} >> "$SSH_LOG"
exit "$SSH_EXIT"
`;

/**
 * The smoke test itself, scripted per invocation: SMOKE_RESULTS is a list of
 * exit codes, one per call. "1 0" is the case that matters — the release fails
 * the check and the release rolled back in between passes it.
 */
const SMOKE_STUB = String.raw`#!/usr/bin/env bash
printf 'SMOKE %s\n' "$*" >> "$SMOKE_LOG"
count=$(grep -c '^SMOKE ' "$SMOKE_LOG")
code=$(printf '%s\n' $SMOKE_RESULTS | sed -n "$count"p)
if [ -z "$code" ]; then code=0; fi
exit "$code"
`;

interface StepRun {
  readonly exitCode: number;
  readonly output: string;
  readonly sshLog: string;
  readonly smokeCalls: number;
}

function runStep(options: { smokeResults: string; sshExit?: number }): StepRun {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-smoke-step-'));
  workspaces.push(workspace);
  mkdirSync(join(workspace, 'deploy'), { recursive: true });
  const binDir = join(workspace, 'bin');
  mkdirSync(binDir, { recursive: true });

  const sshLog = join(workspace, 'ssh.log');
  const smokeLog = join(workspace, 'smoke.log');
  writeFileSync(sshLog, '');
  writeFileSync(smokeLog, '');
  writeExecutable(join(binDir, 'ssh'), SSH_RECORDER);
  writeExecutable(join(workspace, 'deploy', 'public-smoke.sh'), SMOKE_STUB);

  // Beside the stubbed smoke test, exactly where it ships: the script finds
  // public-smoke.sh relative to itself, not to the working directory.
  writeExecutable(join(workspace, 'deploy', 'verify-release.sh'), readFileSync(VERIFY_SCRIPT_PATH, 'utf8'));

  const result = spawnSync('bash', ['deploy/verify-release.sh', '--host', 'fluxradar.net'], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      HOME: workspace,
      SSH_HOST: 'server.invalid',
      SSH_USER: 'fluxradar',
      APP_DIR,
      RELEASE_ID,
      SSH_LOG: sshLog,
      SSH_EXIT: String(options.sshExit ?? 0),
      SMOKE_LOG: smokeLog,
      SMOKE_RESULTS: options.smokeResults,
    },
  });

  const smokeCalls = readFileSync(smokeLog, 'utf8').split('\n').filter(Boolean).length;
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    sshLog: readFileSync(sshLog, 'utf8'),
    smokeCalls,
  };
}

describe('DEPLOY-012 public smoke rollback', () => {
  it('does nothing but pass when the site is healthy', () => {
    const step = runStep({ smokeResults: '0' });
    expect(step.exitCode).toBe(0);
    expect(step.smokeCalls).toBe(1);
    expect(step.sshLog).toBe('');
  });

  describe('when the public smoke test fails', () => {
    it('rolls the release back on the server with the shipped rollback script', () => {
      const step = runStep({ smokeResults: '1 0' });
      expect(step.exitCode).toBe(1);
      // The remote script is sent through a quoted heredoc, so it reaches the
      // server verbatim and the server expands the paths — which is why the
      // release id travels as an ssh ARGUMENT and the log shows both halves.
      expect(step.sshLog).toContain(
        'bash "$APP_DIR/releases/$RELEASE_ID/deploy/rollback-release.sh" ' +
          '"$APP_DIR" "$APP_DIR/releases/$RELEASE_ID"',
      );
      expect(step.sshLog).toContain(
        `SSH ARGS: fluxradar@server.invalid bash -s -- ${APP_DIR} ${RELEASE_ID}`,
      );
    });

    it('re-checks the site from outside and reports that the rollback worked', () => {
      const step = runStep({ smokeResults: '1 0' });
      expect(step.smokeCalls).toBe(2);
      expect(step.output).toContain('Rolled back: the previous release is serving');
      expect(step.output).not.toContain('CRITICAL');
      // The deploy still fails: the release was bad.
      expect(step.exitCode).toBe(1);
    });

    it('says CRITICAL when the rollback itself failed', () => {
      const step = runStep({ smokeResults: '1 0', sshExit: 1 });
      expect(step.exitCode).toBe(1);
      expect(step.output).toContain('CRITICAL: the rollback failed');
      expect(step.output).toContain('may still be live');
      // Nothing is re-checked, because nothing was restored.
      expect(step.smokeCalls).toBe(1);
    });

    // THE FIRST-DEPLOY PATH. rollback-release.sh exits 3 when there is no
    // earlier release to restore, and it deliberately changes nothing — the
    // version that removed the failed release's containers first left a fresh
    // host serving nothing at all. The step has to report that outcome as what
    // it is, and never as "the rollback failed", which would send an operator
    // looking for a restore that was never attempted.
    it('says CRITICAL and names the first deploy when there was no rollback target', () => {
      const step = runStep({ smokeResults: '1 0', sshExit: 3 });
      expect(step.exitCode).toBe(1);
      expect(step.output).toContain('CRITICAL');
      expect(step.output).toContain('no earlier release on this host to roll back to');
      expect(step.output).toContain('nothing was torn down');
      expect(step.output).not.toContain('Rolled back: the previous release is serving');
      // Nothing changed, so re-checking the site would prove nothing.
      expect(step.smokeCalls).toBe(1);
    });

    it('does not hide any non-zero rollback status behind a passing step', () => {
      for (const sshExit of [1, 2, 3, 255]) {
        const step = runStep({ smokeResults: '1 0', sshExit });
        expect(step.exitCode, `rollback exit ${sshExit}`).toBe(1);
        expect(step.output, `rollback exit ${sshExit}`).toContain('CRITICAL');
      }
    });

    it('says CRITICAL when the site still fails after the rollback', () => {
      const step = runStep({ smokeResults: '1 1' });
      expect(step.exitCode).toBe(1);
      expect(step.smokeCalls).toBe(2);
      expect(step.output).toContain('CRITICAL');
      expect(step.output).toContain('still fails the public smoke test');
      expect(step.output).not.toContain('Rolled back: the previous release is serving');
    });

    it('never exits 0 on any of those paths', () => {
      for (const options of [
        { smokeResults: '1 0' },
        { smokeResults: '1 1' },
        { smokeResults: '1 0', sshExit: 1 },
        { smokeResults: '1 0', sshExit: 3 },
      ]) {
        expect(runStep(options).exitCode).toBe(1);
      }
    });
  });

  it('keeps the rollback markers the contract is read from', () => {
    const verifier = readFileSync(VERIFY_SCRIPT_PATH, 'utf8');
    expect(verifier).toContain('# fluxradar:public-smoke-rollback');
    expect(verifier).toContain('# fluxradar:end-public-smoke-rollback');
  });

  it('refuses to run without the host or the server it would roll back', () => {
    const noHost = spawnSync('bash', [VERIFY_SCRIPT_PATH], { encoding: 'utf8', env: {} });
    expect(noHost.status).toBe(2);
    expect(noHost.stderr).toContain('--host is required');
    const noServer = spawnSync('bash', [VERIFY_SCRIPT_PATH, '--host', 'fluxradar.net'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(noServer.status).toBe(2);
    expect(noServer.stderr).toContain('SSH_HOST is not set');
  });

  // Splitting the deploy into stages put a job boundary between the traffic
  // switch and this check. A `verify` job that fails BEFORE its smoke test —
  // checkout, SSH setup, a lost runner — or is cancelled or times out would
  // leave a switched, never-verified release live. `recover` closes that.
  describe('the recover stage', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const recover = workflow.slice(workflow.indexOf('\n  recover:\n'));

    it('runs only for a release that is live and was not verified green', () => {
      expect(recover).toContain('needs: [release, verify]');
      // `release` succeeds only after the traffic switch, which is what makes it
      // safe to run on a cancellation too.
      expect(recover).toContain('always()');
      expect(recover).toContain("needs.release.result == 'success'");
      expect(recover).toContain("needs.verify.result != 'success'");
      // A bare `if: failure()` would also fire after a failure that never
      // reached production, and roll back a release serving perfectly well.
      expect(recover).not.toMatch(/if:\s*failure\(\)\s*$/m);
    });

    it('runs the same verifier, so there is one rollback path to trust', () => {
      expect(recover).toContain('bash deploy/verify-release.sh --host fluxradar.net');
    });
  });
});
