import { readFileSync } from 'node:fs';
import { expect } from 'vitest';

/**
 * One `run:` step of a workflow or composite action, extracted so a test can
 * execute exactly what GitHub executes — including HOW GitHub executes it.
 *
 * GitHub never runs a step with a plain `bash`. A step with no `shell:` runs as
 * `bash -e {0}`, and `shell: bash` as `bash --noprofile --norc -eo pipefail {0}`,
 * so errexit is ON before the step's first line — and `set -uo pipefail` in the
 * body does not turn it off. A harness that ran step bodies with plain `bash`
 * let the deploy's backup-config step pass here while it failed every deploy in
 * production: the assignment `missing="$(check …)"` returned 1, errexit ended
 * the step, and the `case "$?"` meant to turn that into a warning never ran.
 */
export interface WorkflowStep {
  /** The `run:` body, dedented. */
  readonly script: string;
  /** What GitHub passes to bash before the script path, for this step's shell. */
  readonly bashArgs: readonly string[];
}

const DEFAULT_SHELL_ARGS = ['-e'] as const;
const BASH_SHELL_ARGS = ['--noprofile', '--norc', '-eo', 'pipefail'] as const;

/**
 * @param stepNameLine the step's `- name:` line exactly as it appears, indentation included
 */
export function extractWorkflowStep(file: string, stepNameLine: string): WorkflowStep {
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.trimEnd() === stepNameLine);
  expect(at, `${stepNameLine.trim()} is missing from ${file}`).toBeGreaterThan(-1);
  const run = lines.findIndex((line, index) => index > at && /^\s*run: \|\s*$/.test(line));
  expect(run, `${stepNameLine.trim()} has no \`run: |\` block`).toBeGreaterThan(at);

  const shellLine = lines.slice(at, run).find((line) => /^\s*shell:/.test(line));
  const shell = shellLine?.replace(/^\s*shell:\s*/, '').trim();
  expect(shell === undefined || shell === 'bash', `unsupported shell: ${shell}`).toBe(true);

  const runIndent = (lines[run] ?? '').length - (lines[run] ?? '').trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= runIndent) break;
    body.push(line);
  }
  const indent = Math.min(
    ...body
      .filter((line) => line.trim() !== '')
      .map((line) => line.length - line.trimStart().length),
  );
  const script = body.map((line) => (line.trim() === '' ? '' : line.slice(indent))).join('\n');
  // Pure bash, or running it outside GitHub proves nothing about what GitHub
  // runs: every expression has to reach the body through `env:`.
  expect(script, `${stepNameLine.trim()} interpolates \${{ }} into its script`).not.toContain(
    '${{',
  );
  return { script, bashArgs: shell === 'bash' ? BASH_SHELL_ARGS : DEFAULT_SHELL_ARGS };
}
