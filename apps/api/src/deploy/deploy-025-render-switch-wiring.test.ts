import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import { RENDER_ENABLED_ENV } from '../orchestrator/render-config.ts';

// DEPLOY-025: JS rendering can be switched on in production without the base
// env file. That file is a secret nobody can read back, so the switch travels
// as a production environment variable and is written into the release env by
// the same upsert as every other optional override.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

describe('DEPLOY-025 render switch wiring', () => {
  it('reads the switch from a production variable, not a secret', () => {
    expect(WORKFLOW).toContain('PRODUCTION_RENDER_ENABLED: ${{ vars.PRODUCTION_RENDER_ENABLED }}');
    expect(WORKFLOW).not.toContain('secrets.PRODUCTION_RENDER_ENABLED');
  });

  it('writes it into the release env under the name the API reads', () => {
    expect(WORKFLOW).toContain(`upsert_env ${RENDER_ENABLED_ENV} PRODUCTION_RENDER_ENABLED`);
  });
});
