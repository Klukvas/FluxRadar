import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import { FREE_CHECK_ALLOWED_ORIGINS_ENV } from '../billing/free-check-allowlist.ts';

// DEPLOY-014: the free-check allowlist has to be settable from the deploy.
//
// The variable fails closed (billing/free-check-allowlist.ts), which is the
// right default and also the reason a wiring mistake is invisible: an unwired
// name is not an error anywhere, it just means every domain keeps its one-time
// limit and the demo site cannot be re-checked. The symptom shows up as a
// refused free check on a site the team owns, long after the deploy went green.
//
// Nothing here can know the value — that lives in the GitHub `production`
// environment, which is the point. What it checks is that the NAME is wired end
// to end: bound as a step-level source, merged into the release env file, and
// written down for whoever configures the environment.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const ENV_EXAMPLE = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');

/** The workflow's naming rule for an optional production override. */
const SOURCE_VAR = 'PRODUCTION_FREE_CHECK_ALLOWED_ORIGINS';

describe('DEPLOY-014 free-check allowlist wiring', () => {
  it('merges the allowlist into the release env file', () => {
    expect(WORKFLOW).toContain(`upsert_env ${FREE_CHECK_ALLOWED_ORIGINS_ENV} ${SOURCE_VAR}`);
  });

  // Every upsert reads `printenv`, so an upsert whose source is never bound on
  // the step silently does nothing at all.
  it('binds the source the upsert reads', () => {
    expect(WORKFLOW).toMatch(new RegExp(`^\\s*${SOURCE_VAR}:\\s*\\$\\{\\{`, 'm'));
  });

  // A list of public https origins is not a credential, and making it a secret
  // would only hide it from the deploy log it never reaches anyway — while
  // costing the ability to read back what production is actually allowing.
  it('reads it as a production variable rather than a secret', () => {
    expect(WORKFLOW).toContain(`${SOURCE_VAR}: \${{ vars.${SOURCE_VAR} }}`);
    expect(WORKFLOW).not.toContain(`secrets.${SOURCE_VAR}`);
  });

  // The workflow must pin no value of its own: PRODUCTION_ENV_FILE is the base
  // and this is an override that applies only when non-empty.
  it('pins no allowlist value of its own', () => {
    expect(WORKFLOW).not.toMatch(
      new RegExp(`^\\s*${FREE_CHECK_ALLOWED_ORIGINS_ENV}:\\s*\\S`, 'm'),
    );
  });

  // The deployment runbook left the repository; `.env.example` is now the one
  // place an operator reads this variable's name from, so it has to carry it.
  it('is written down for whoever configures the environment', () => {
    expect(ENV_EXAMPLE).toContain(`${FREE_CHECK_ALLOWED_ORIGINS_ENV}=`);
  });
});
