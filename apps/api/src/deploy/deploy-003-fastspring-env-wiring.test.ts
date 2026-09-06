import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import { FASTSPRING_ENV_VARS } from '../billing/fastspring/config.ts';

// DEPLOY-003: the deploy workflow must carry the WHOLE FastSpring set.
//
// readFastSpringConfig is all-or-nothing on purpose: the moment one FASTSPRING_*
// variable reaches the container, the provider stops being "not configured" and
// starts being judged as a complete set. A workflow that forwards the three
// credentials but forgets the checkout path therefore does not degrade to the
// previous behaviour — it turns paid checkout into "misconfigured" and sells
// nothing, with the reason visible only in a container log.
//
// Nothing here can check what the values are (they live in GitHub secrets and
// variables, which is the point). What it can check is that no NAME the config
// reader knows about was left unwired, which is the failure that actually
// happened while the provider was being connected.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

/** The workflow's own naming rule: FASTSPRING_X is fed by PRODUCTION_FASTSPRING_X. */
function sourceVarFor(key: string): string {
  return `PRODUCTION_${key}`;
}

/**
 * The one FastSpring name production must NOT be able to set from a variable.
 *
 * FASTSPRING_API_BASE_URL exists so a test can point the client at a stub. A
 * deployment that can retarget it is a deployment where whoever can edit a
 * repository variable can redirect session creation — Basic auth credentials
 * included — to a host of their choosing. It stays a base-env-file concern.
 */
const TEST_ONLY_VARS: readonly string[] = [FASTSPRING_ENV_VARS.apiBaseUrl];

const DEPLOYED_VARS = Object.values(FASTSPRING_ENV_VARS).filter(
  (name) => !TEST_ONLY_VARS.includes(name),
);

describe('DEPLOY-003 FastSpring env wiring', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

  it.each(DEPLOYED_VARS)('forwards %s into the release env file', (key) => {
    expect(workflow).toContain(`upsert_env ${key} ${sourceVarFor(key)}`);
  });

  it.each(DEPLOYED_VARS)('binds a source for %s', (key) => {
    // Every upsert reads `printenv`, so the source has to exist as a step-level
    // env entry too — an upsert whose source is never bound silently does nothing.
    expect(workflow).toMatch(new RegExp(`^\\s*${sourceVarFor(key)}:\\s*\\$\\{\\{`, 'm'));
  });

  // A value pinned in the workflow outranks PRODUCTION_ENV_FILE and cannot be
  // changed without a commit — which is exactly how a deployment ends up pointed
  // at the wrong store or, worse, at live payments nobody switched on.
  it('pins no FastSpring value of its own', () => {
    for (const key of Object.values(FASTSPRING_ENV_VARS)) {
      expect(workflow).not.toMatch(new RegExp(`^\\s*${key}:\\s*(?!\\$\\{\\{)\\S`, 'm'));
    }
  });

  it.each(TEST_ONLY_VARS)('leaves %s unwired', (key) => {
    expect(workflow).not.toContain(`upsert_env ${key} `);
  });
});
