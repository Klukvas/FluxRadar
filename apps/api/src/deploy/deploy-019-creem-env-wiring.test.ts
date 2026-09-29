import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import { CREEM_ENV_VARS, OPTIONAL_CREEM_ENV_VARS } from '../billing/creem/config.ts';

// DEPLOY-019: the deploy workflow must carry the WHOLE Creem set.
//
// readCreemConfig is all-or-nothing on purpose: the moment one CREEM_* variable
// reaches the container, the provider stops being "not configured" and starts
// being judged as a complete set. A workflow that forwards the two credentials
// but forgets a product id therefore does not degrade to the previous
// behaviour — it turns paid checkout into "misconfigured" and sells nothing,
// with the reason visible only in a container log.
//
// Nothing here can check what the values are (they live in GitHub secrets and
// variables, which is the point). What it can check is that no NAME the config
// reader knows about was left unwired.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

/** The workflow's own naming rule: CREEM_X is fed by PRODUCTION_CREEM_X. */
function sourceVarFor(key: string): string {
  return `PRODUCTION_${key}`;
}

/**
 * The one Creem name production must NOT be able to set from a variable.
 *
 * CREEM_API_BASE_URL exists so a test can point the client at a stub. A
 * deployment that can retarget it is a deployment where whoever can edit a
 * repository variable can redirect checkout creation — the API key included —
 * to a host of their choosing. The mode decides the real base URL, and the
 * override stays a base-env-file concern.
 */
const TEST_ONLY_VARS: readonly string[] = [CREEM_ENV_VARS.apiBaseUrl];

/**
 * The two names that are credentials, and so come from secrets rather than
 * variables. Everything else in the set describes what this deployment sells
 * and is visible in the Creem dashboard to anyone who can open it.
 */
const SECRET_VARS: readonly string[] = [CREEM_ENV_VARS.apiKey, CREEM_ENV_VARS.webhookSecret];

/**
 * The names whose absence does NOT make the set incomplete.
 *
 * The rule above — forward every name or the checkout turns "misconfigured" —
 * is a consequence of `readCreemConfig` being all-or-nothing, and it does not
 * reach the names the reader itself treats as optional: a missing product id
 * for a plan only means that plan cannot be bought here, and a missing return
 * URL is derived from FRONTEND_ORIGIN. Read from the config module rather than
 * listed here, so the exemption cannot grow without the reader growing with it.
 *
 * The exemption is from *this* list only — an optional name is still forwarded
 * by the workflow, and the test below says so.
 */
const DEPLOYED_VARS = Object.values(CREEM_ENV_VARS).filter(
  (name) => !TEST_ONLY_VARS.includes(name) && !OPTIONAL_CREEM_ENV_VARS.includes(name),
);

describe('DEPLOY-019 Creem env wiring', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

  // Pinned, so the exemption above stays a short, deliberate list rather than
  // the place a forgotten required variable quietly ends up.
  it('exempts only the product id of a plan not sold everywhere and the derived return URL', () => {
    expect(OPTIONAL_CREEM_ENV_VARS).toEqual(['CREEM_PRODUCT_ID_WEBSITE_AUDIT', 'CREEM_RETURN_URL']);
    expect(DEPLOYED_VARS).toContain(CREEM_ENV_VARS.productIdBasic);
    expect(DEPLOYED_VARS).toContain(CREEM_ENV_VARS.productIdComplete);
    expect(DEPLOYED_VARS).toContain(CREEM_ENV_VARS.webhookSecret);
    expect(DEPLOYED_VARS).toContain(CREEM_ENV_VARS.storeVerified);
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
  // repository variable, or the only way to sell the plan behind it — or to
  // send the buyer back somewhere other than FRONTEND_ORIGIN — in production
  // is editing the env file on the host by hand, a change no commit records
  // and the next deploy overwrites.
  //
  // Forwarding it changes nothing until the variable is set: `upsert_env` skips
  // an empty source, so an unconfigured optional name never reaches the
  // container and never turns the provider into "misconfigured".
  it.each(OPTIONAL_CREEM_ENV_VARS)('forwards %s even though it is optional', (key) => {
    expect(workflow).toContain(`upsert_env ${key} ${sourceVarFor(key)}`);
    expect(workflow).toMatch(new RegExp(`^\\s*${sourceVarFor(key)}:\\s*\\$\\{\\{`, 'm'));
  });

  // The wiring above must not be mistaken for a promotion. "We forward it now,
  // so it may as well be required" is the tempting next step, and it would turn
  // every deployment that has not created the product into one that sells
  // nothing at all. The required set therefore still excludes it — the wiring
  // is what lets a deployment set the variable, not a demand that it does.
  it.each(OPTIONAL_CREEM_ENV_VARS)('does not become required by being wired: %s', (key) => {
    expect(DEPLOYED_VARS).not.toContain(key);
  });

  // The API key and the webhook secret are the only credentials in the set. A
  // product id or a mode read from a secret would only hide from the deploy
  // what the Creem dashboard shows anyway, at the cost of never being able to
  // read back what production sells; a credential read from a variable would
  // be printed by any step that dumps its environment.
  it('reads the two credentials from secrets and everything else from variables', () => {
    for (const key of DEPLOYED_VARS) {
      const source = sourceVarFor(key);
      const store = SECRET_VARS.includes(key) ? 'secrets' : 'vars';
      expect(workflow).toContain(`${source}: \${{ ${store}.${source} }}`);
    }
  });

  // A value pinned in the workflow outranks PRODUCTION_ENV_FILE and cannot be
  // changed without a commit — which is exactly how a deployment ends up pointed
  // at the wrong store or, worse, at live payments nobody switched on.
  it('pins no Creem value of its own', () => {
    for (const key of Object.values(CREEM_ENV_VARS)) {
      expect(workflow).not.toMatch(new RegExp(`^\\s*${key}:\\s*(?!\\$\\{\\{)\\S`, 'm'));
    }
  });

  it.each(TEST_ONLY_VARS)('leaves %s unwired', (key) => {
    expect(workflow).not.toContain(`upsert_env ${key} `);
  });
});
