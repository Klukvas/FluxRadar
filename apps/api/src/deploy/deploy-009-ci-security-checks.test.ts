// DEPLOY-009: what CI is responsible for, and what a workflow may be trusted with.
//
// Three classes of failure, none of which is visible in a green run:
//
//   1. No dependency check at all. A published advisory against something the
//      deployed images carry stayed invisible until somebody happened to run
//      `pnpm audit` by hand.
//
//   2. A workflow that quietly gained more permission than it needs, or that
//      runs on `pull_request_target` — the trigger that hands a fork's code the
//      repository's secrets. Neither is a mistake you notice while reading a
//      diff about something else.
//
//   3. A secret name that exists only in a workflow. GitHub resolves an
//      undefined secret to the EMPTY STRING, and the deploy's `upsert_env`
//      deliberately skips empty values, so a typo or a rename is not an error
//      anywhere: the variable is simply never written and the release runs
//      without it. The only defence is that every name is also written down for
//      the person who sets the environment up, so the two lists are compared
//      here.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');
const DEPLOYMENT_DOC = readFileSync(join(REPO_ROOT, 'docs', 'DEPLOYMENT.md'), 'utf8');
const ROOT_PACKAGE = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  readonly pnpm?: { readonly auditConfig?: { readonly ignoreGhsas?: readonly string[] } };
};

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, yaml: readFileSync(join(WORKFLOW_DIR, name), 'utf8') }));

function workflow(name: string): string {
  const found = workflows.find((entry) => entry.name === name);
  if (found === undefined) expect.unreachable(`${name} is missing from .github/workflows`);
  return found.yaml;
}

/** Every `secrets.NAME` and `vars.NAME` a workflow reads. */
function referencedNames(yaml: string): readonly string[] {
  return [...yaml.matchAll(/\b(?:secrets|vars)\.([A-Z0-9_]+)/g)].map((match) => match[1] ?? '');
}

describe('CI checks the dependencies it ships', () => {
  const ci = workflow('ci.yml');

  it('audits the packages that end up in the images, and fails on a high advisory', () => {
    expect(ci).toMatch(/pnpm audit --prod --audit-level high/);
  });

  // Blocking on a build-time advisory would stop the fix for it from merging,
  // so that half is reported rather than enforced — but it must still run.
  it('reports build and test advisories without blocking on them', () => {
    expect(ci).toMatch(/pnpm audit --audit-level high/);
    expect(ci).toContain('continue-on-error: true');
  });

  it('runs on pull requests, so the check gates the merge', () => {
    expect(ci).toMatch(/^on:\s*$/m);
    expect(ci).toContain('pull_request');
  });

  // The audit gates the merge, not the release: an advisory is published against
  // code that is already deployed, so blocking the deploy would block its fix.
  it('is deliberately absent from the production deploy', () => {
    expect(workflow('deploy.yml')).not.toContain('pnpm audit');
  });
});

// An ignored advisory is the audit's one escape hatch, and the only thing
// stopping it from becoming the way a red build is made green is that every
// entry has to be justified where an operator will read it.
describe('accepted advisories', () => {
  const ignored = ROOT_PACKAGE.pnpm?.auditConfig?.ignoreGhsas ?? [];

  it.each(ignored.length > 0 ? ignored : ['(none)'])('%s is written down with a reason', (id) => {
    if (id === '(none)') return;

    expect(DEPLOYMENT_DOC).toContain(id);
  });

  // A blanket CVE ignore list would silence advisories nobody chose to accept.
  it('uses no other suppression mechanism', () => {
    expect(Object.keys(ROOT_PACKAGE.pnpm?.auditConfig ?? {})).toEqual(
      ignored.length > 0 ? ['ignoreGhsas'] : [],
    );
  });
});

describe('workflow privileges', () => {
  it.each(workflows.map(({ name }) => name))('%s states its permissions explicitly', (name) => {
    expect(workflow(name)).toMatch(/^permissions:\s*$/m);
  });

  it.each(workflows.map(({ name }) => name))('%s grants no write scope', (name) => {
    const yaml = workflow(name);

    expect(yaml).not.toMatch(/permissions:\s*write-all/);
    expect(yaml).not.toMatch(/^\s{2,}[a-z-]+:\s*write\s*$/m);
  });

  // `pull_request_target` runs with the base repository's secrets while checking
  // out a fork's code. There is no safe use of it in this repository.
  it.each(workflows.map(({ name }) => name))('%s never runs on pull_request_target', (name) => {
    expect(workflow(name)).not.toContain('pull_request_target');
  });
});

describe('secret names', () => {
  // A rename in one workflow and not the other is silent: the scheduled backup
  // verification simply stops being able to reach the server, on a schedule,
  // where nobody is watching.
  it('are the same in the deploy and in the backup verification', () => {
    const shared = [
      'PRODUCTION_SSH_HOST',
      'PRODUCTION_SSH_USER',
      'PRODUCTION_SSH_PRIVATE_KEY',
      'PRODUCTION_SSH_KNOWN_HOSTS',
      'PRODUCTION_APP_DIR',
    ];
    const deploy = referencedNames(workflow('deploy.yml'));
    const verify = referencedNames(workflow('backup-verify.yml'));

    for (const name of shared) {
      expect(deploy).toContain(name);
      expect(verify).toContain(name);
    }
    // The verification must ask for nothing the deploy does not already define.
    expect(verify.filter((name) => !deploy.includes(name))).toEqual([]);
  });

  it('are all written down for whoever configures the environment', () => {
    const undocumented = [
      ...new Set(workflows.flatMap(({ yaml }) => referencedNames(yaml))),
    ].filter((name) => !DEPLOYMENT_DOC.includes(name));

    expect(undocumented).toEqual([]);
  });

  it('all follow the PRODUCTION_ / FLUXRADAR_ naming the docs describe', () => {
    const unexpected = [...new Set(workflows.flatMap(({ yaml }) => referencedNames(yaml)))].filter(
      (name) => !/^(PRODUCTION_|FLUXRADAR_|ALLOW_)/.test(name),
    );

    expect(unexpected).toEqual([]);
  });
});
