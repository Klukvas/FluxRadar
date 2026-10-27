import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SENTRY_ENV_VARS } from '../observability/sentry-config.ts';
import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-022: Sentry error monitoring has to be switchable from the deploy.
//
// Both halves fail quiet by design — no DSN means errors are only logged, and a
// web build without one carries no Sentry code — which is also why a wiring
// mistake would be invisible: nothing errors, reports simply never arrive. What
// this pins is that each NAME is wired end to end, and that the two DSNs travel
// the way their nature asks: the API's as a secret merged into the release env
// file, the browser's — public by design, it is in every page that reports — as
// a variable baked into the web image only. Both images carry the commit SHA.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
const ENV_EXAMPLE = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
const WEB_DOCKERFILE = readFileSync(join(REPO_ROOT, 'Dockerfile.web'), 'utf8');
const API_DOCKERFILE = readFileSync(join(REPO_ROOT, 'Dockerfile.api'), 'utf8');

const API_SOURCE = 'PRODUCTION_SENTRY_DSN';
const WEB_SOURCE = 'PRODUCTION_SENTRY_WEB_DSN';

/** The text of one matrix leg, from its `- service:` line to the next leg or the steps. */
function matrixLeg(service: 'api' | 'web'): string {
  const start = WORKFLOW.indexOf(`- service: ${service}`);
  expect(start, `no ${service} leg in the image matrix`).toBeGreaterThan(-1);
  const rest = WORKFLOW.slice(start + 1);
  const end = Math.min(
    ...[rest.indexOf('- service:'), rest.indexOf('steps:')].filter((index) => index > -1),
  );
  return rest.slice(0, end);
}

describe('DEPLOY-022 Sentry wiring', () => {
  describe('the API DSN', () => {
    it('is merged into the release env file from a production secret', () => {
      expect(WORKFLOW).toContain(`upsert_env ${SENTRY_ENV_VARS.dsn} ${API_SOURCE}`);
      expect(WORKFLOW).toContain(`${API_SOURCE}: \${{ secrets.${API_SOURCE} }}`);
      expect(WORKFLOW).not.toContain(`vars.${API_SOURCE}`);
    });

    it('is given no value by the workflow itself', () => {
      expect(WORKFLOW).not.toMatch(new RegExp(`^\\s*${SENTRY_ENV_VARS.dsn}:\\s*\\S`, 'm'));
    });
  });

  describe('the browser DSN', () => {
    it('is read from a production variable, never a secret', () => {
      expect(WORKFLOW).toContain(`VITE_SENTRY_DSN: \${{ vars.${WEB_SOURCE} }}`);
      expect(WORKFLOW).not.toContain(`secrets.${WEB_SOURCE}`);
    });

    it('reaches the web image build only', () => {
      expect(matrixLeg('web')).toContain('--build-arg VITE_SENTRY_DSN');
      expect(matrixLeg('api')).not.toContain('VITE_SENTRY_DSN');
    });

    // `--build-arg NAME=value` in the matrix would put the value on the
    // command line; the bare name has docker read it from the step's env.
    it('is named, not interpolated, on the docker command line', () => {
      expect(WORKFLOW).not.toMatch(/--build-arg VITE_SENTRY_DSN=/);
      expect(WORKFLOW).not.toMatch(/--build-arg [A-Z_]*SENTRY[A-Z_]*=\$/);
    });

    it('is declared by the web Dockerfile before the build, empty by default', () => {
      const build = WEB_DOCKERFILE.indexOf('RUN pnpm --filter @fluxradar/web build');
      for (const name of ['VITE_SENTRY_DSN', 'VITE_SENTRY_RELEASE']) {
        const arg = WEB_DOCKERFILE.indexOf(`ARG ${name}=\n`);
        const env = WEB_DOCKERFILE.indexOf(`ENV ${name}=$${name}\n`);
        expect(arg, `ARG ${name}`).toBeGreaterThan(-1);
        expect(env, `ENV ${name}`).toBeGreaterThan(arg);
        expect(build).toBeGreaterThan(env);
      }
    });
  });

  describe('the release', () => {
    it('is the commit SHA in both images', () => {
      expect(WORKFLOW).toContain('SENTRY_RELEASE: ${{ github.sha }}');
      expect(WORKFLOW).toContain('VITE_SENTRY_RELEASE: ${{ github.sha }}');
      expect(matrixLeg('api')).toContain(`--build-arg ${SENTRY_ENV_VARS.release}`);
      expect(matrixLeg('web')).toContain('--build-arg VITE_SENTRY_RELEASE');
    });

    // The runtime stage is what runs; an ARG in the build stage would be lost.
    it('is baked into the API runtime stage', () => {
      const runtime = API_DOCKERFILE.slice(API_DOCKERFILE.lastIndexOf('\nFROM '));
      expect(runtime).toContain(`ARG ${SENTRY_ENV_VARS.release}=\n`);
      expect(runtime).toContain(`ENV ${SENTRY_ENV_VARS.release}=$${SENTRY_ENV_VARS.release}\n`);
    });
  });

  it('is written down for whoever configures the environment', () => {
    expect(ENV_EXAMPLE).toContain(`${SENTRY_ENV_VARS.dsn}=`);
    expect(ENV_EXAMPLE).toContain('VITE_SENTRY_DSN=');
    expect(ENV_EXAMPLE).toContain(API_SOURCE);
    expect(ENV_EXAMPLE).toContain(WEB_SOURCE);
  });
});
