// Startup configuration diagnostics.
//
// One line per integration, at boot, so "this integration is off" is never a
// silent state an operator only discovers from a user report. It follows the
// FastSpring log this repository already had (see logFastSpringState in
// index.ts) and keeps its rule: integration names, statuses and, when something
// is half-configured, the names of the variables that are missing. No value of
// any variable is read into a log line, ever.

import { readFastSpringConfig } from '../billing/fastspring/config.ts';
import type { ApiLogger } from '../http/logger.ts';
import { readAnthropicConfig } from './anthropic-config.ts';
import { readObjectStorageConfig } from './object-storage-config.ts';
import { readOAuthConfig } from './oauth-config.ts';

export type IntegrationStatusState = 'configured' | 'not_configured' | 'invalid';

export interface IntegrationStatus {
  readonly integration: string;
  readonly status: IntegrationStatusState;
  /** Variable names only — never their values. Empty unless `invalid`. */
  readonly missing: readonly string[];
}

const RESEND_ENV_VARS = {
  apiKey: 'RESEND_API_KEY',
  from: 'RESEND_FROM_EMAIL',
} as const;

const SINGLE_KEY_INTEGRATIONS = [
  { integration: 'pagespeed', variable: 'PAGESPEED_API_KEY' },
  { integration: 'crux', variable: 'CRUX_API_KEY' },
] as const;

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

function status(
  integration: string,
  result: { readonly state: IntegrationStatusState; readonly missing?: readonly string[] },
): IntegrationStatus {
  return { integration, status: result.state, missing: result.missing ?? [] };
}

/**
 * Resend is optional as a pair: both the key and the verified sender are needed
 * before anything can be sent, so exactly one of them present is the same
 * half-configured state every other integration reports.
 */
function resendStatus(env: NodeJS.ProcessEnv): IntegrationStatus {
  const apiKey = trimmed(env[RESEND_ENV_VARS.apiKey]);
  const from = trimmed(env[RESEND_ENV_VARS.from]);
  if (apiKey === null && from === null) {
    return status('resend', { state: 'not_configured' });
  }
  if (apiKey === null || from === null) {
    return status('resend', {
      state: 'invalid',
      missing: [
        ...(apiKey === null ? [RESEND_ENV_VARS.apiKey] : []),
        ...(from === null ? [RESEND_ENV_VARS.from] : []),
      ],
    });
  }
  return status('resend', { state: 'configured' });
}

/** Every integration status, in a stable order, for logging and for tests. */
export function readIntegrationStatuses(
  env: NodeJS.ProcessEnv = process.env,
): readonly IntegrationStatus[] {
  return [
    status('storage', readObjectStorageConfig(env)),
    status('anthropic', readAnthropicConfig(env)),
    ...SINGLE_KEY_INTEGRATIONS.map(({ integration, variable }) =>
      status(integration, {
        state: trimmed(env[variable]) === null ? 'not_configured' : 'configured',
      }),
    ),
    resendStatus(env),
    status('google', readOAuthConfig('google', env)),
    status('bing', readOAuthConfig('bing', env)),
    status('fastspring', readFastSpringConfig(env)),
  ];
}

/**
 * Logs the statuses: one summary line naming what is on and what is off, plus an
 * error line per half-configured integration with the missing variable names.
 * In production a half-configured integration also fails the boot
 * (`validateRuntimeConfig`); the line is what tells the operator which one.
 */
export function logIntegrationStatuses(
  logger: ApiLogger,
  statuses: readonly IntegrationStatus[] = readIntegrationStatuses(),
): void {
  const named = (state: IntegrationStatusState): readonly string[] =>
    statuses.filter((entry) => entry.status === state).map((entry) => entry.integration);
  logger.info('integration configuration', {
    configured: named('configured'),
    disabled: named('not_configured'),
    invalid: named('invalid'),
  });
  for (const entry of statuses) {
    if (entry.status === 'invalid') {
      logger.error('integration is only partially configured', {
        integration: entry.integration,
        missing: entry.missing,
      });
    }
  }
}
