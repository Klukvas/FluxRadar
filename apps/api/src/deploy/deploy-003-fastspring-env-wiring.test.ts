import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import {
  FASTSPRING_ENV_VARS,
  OPTIONAL_FASTSPRING_ENV_VARS,
} from '../billing/fastspring/config.ts';

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

/**
 * The names whose absence does NOT make the set incomplete.
 *
 * The rule above — forward every name or the checkout turns "misconfigured" —
 * is a consequence of `readFastSpringConfig` being all-or-nothing, and it does
 * not reach the names the reader itself treats as optional: a missing product
 * path for a plan only means that plan cannot be bought here, and every other
 * plan still sells. Read from the config module rather than listed here, so the
 * exemption cannot grow without the reader growing with it.
 *
 * The exemption is from *this* list only — an optional name is still forwarded
 * by the workflow, and the test below says so.
 */
const DEPLOYED_VARS = Object.values(FASTSPRING_ENV_VARS).filter(
  (name) => !TEST_ONLY_VARS.includes(name) && !OPTIONAL_FASTSPRING_ENV_VARS.includes(name),
);

describe('DEPLOY-003 FastSpring env wiring', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

  // Pinned, so the exemption above stays a short, deliberate list rather than
  // the place a forgotten required variable quietly ends up.
  it('exempts only the product path of a plan that is not sold everywhere', () => {
    expect(OPTIONAL_FASTSPRING_ENV_VARS).toEqual(['FASTSPRING_PRODUCT_PATH_WEBSITE_AUDIT']);
    expect(DEPLOYED_VARS).toContain(FASTSPRING_ENV_VARS.productPathBasic);
    expect(DEPLOYED_VARS).toContain(FASTSPRING_ENV_VARS.productPathComplete);
    expect(DEPLOYED_VARS).toContain(FASTSPRING_ENV_VARS.webhookSecret);
  });

  it.each(DEPLOYED_VARS)('forwards %s into the release env file', (key) => {
    expect(workflow).toContain(`upsert_env ${key} ${sourceVarFor(key)}`);
  });

  it.each(DEPLOYED_VARS)('binds a source for %s', (key) => {
    // Every upsert reads `printenv`, so the source has to exist as a step-level
    // env entry too — an upsert whose source is never bound silently does nothing.
    expect(workflow).toMatch(new RegExp(`^\\s*${sourceVarFor(key)}:\\s*\\$\\{\\{`, 'm'));
  });

  // "Optional to the API" is not "unsettable by the deployment". A name the
  // reader tolerates the absence of still has to be *reachable* from a
  // repository variable, or the only way to sell the plan behind it in
  // production is editing the env file on the host by hand — a change no commit
  // records and the next deploy overwrites.
  //
  // Forwarding it changes nothing until the variable is set: `upsert_env` skips
  // an empty source, so an unconfigured optional path never reaches the
  // container and never turns the provider into "misconfigured".
  it.each(OPTIONAL_FASTSPRING_ENV_VARS)('forwards %s even though it is optional', (key) => {
    expect(workflow).toContain(`upsert_env ${key} ${sourceVarFor(key)}`);
    expect(workflow).toMatch(new RegExp(`^\\s*${sourceVarFor(key)}:\\s*\\$\\{\\{`, 'm'));
  });

  // The wiring above must not be mistaken for a promotion. "We forward it now,
  // so it may as well be required" is the tempting next step, and it would turn
  // every deployment that has not created the product into one that sells
  // nothing at all. The required set therefore still excludes it — the wiring
  // is what lets a deployment set the variable, not a demand that it does.
  //
  // That the API itself still boots without the value is the config reader's
  // own contract, proved against it in `fastspring-002-config`; here the point
  // is only that wiring the name did not move it into the required list.
  it.each(OPTIONAL_FASTSPRING_ENV_VARS)('does not become required by being wired: %s', (key) => {
    expect(DEPLOYED_VARS).not.toContain(key);
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
