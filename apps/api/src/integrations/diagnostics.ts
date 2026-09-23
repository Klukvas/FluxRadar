// Startup configuration diagnostics.
//
// One line per integration, at boot, so "this integration is off" is never a
// silent state an operator only discovers from a user report. It follows the
// FastSpring log this repository already had (see logFastSpringState in
// index.ts) and keeps its rule: integration names, statuses and, when something
// is half-configured, the names of the variables that are missing. No value of
// any variable is read into a log line, ever.

import { readFastSpringConfig } from '../billing/fastspring/config.ts';
import { readResendConfig } from '../email/resend-config.ts';
import type { ApiLogger } from '../http/logger.ts';
import { readTelegramConfig } from '../support/telegram-config.ts';
import { readAnthropicConfig } from './anthropic-config.ts';
import { readObjectStorageConfig } from './object-storage-config.ts';
import { readOAuthConfig } from './oauth-config.ts';
import { readOpenAiConfig } from './openai-config.ts';
import { readGeminiConfig, readPerplexityConfig } from './opt-in-ai-config.ts';
import { KEYLESS_AUDIT_LIMITS } from './performance/index.ts';

export type IntegrationStatusState = 'configured' | 'not_configured' | 'invalid';

export interface IntegrationStatus {
  readonly integration: string;
  readonly status: IntegrationStatusState;
  /** Variable names only — never their values. Empty unless `invalid`. */
  readonly missing: readonly string[];
}

const SINGLE_KEY_INTEGRATIONS = [{ integration: 'crux', variable: 'CRUX_API_KEY' }] as const;

/** Absent, this does not turn PageSpeed off — it makes the audit smaller. */
const PAGESPEED_KEY_VARIABLE = 'PAGESPEED_API_KEY';

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

/** Every integration status, in a stable order, for logging and for tests. */
export function readIntegrationStatuses(
  env: NodeJS.ProcessEnv = process.env,
): readonly IntegrationStatus[] {
  return [
    status('storage', readObjectStorageConfig(env)),
    status('anthropic', readAnthropicConfig(env)),
    status('openai', readOpenAiConfig(env)),
    // Opt-in recipients. "configured" here means "an opt-in scan could reach
    // them", not "scans use them": nothing selects these two on its own.
    status('google-ai', readGeminiConfig(env)),
    status('perplexity', readPerplexityConfig(env)),
    // PageSpeed Insights is usable without a key, so the provider is enabled
    // even when PAGESPEED_API_KEY is absent — but the audit it runs is then the
    // reduced keyless one, which `logPerformanceAuditMode` states separately.
    status('pagespeed', { state: 'configured' }),
    ...SINGLE_KEY_INTEGRATIONS.map(({ integration, variable }) =>
      status(integration, {
        state: trimmed(env[variable]) === null ? 'not_configured' : 'configured',
      }),
    ),
    // Optional as a pair, and reported — never fatal: a deployment that cannot
    // send email can still sell and run scans (email/resend-config.ts).
    status('resend', readResendConfig(env)),
    // Optional as a pair and never fatal either: without it the support form is
    // not offered, and everything else works (support/telegram-config.ts).
    status('telegram', readTelegramConfig(env)),
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

/**
 * States which Performance audit this deployment will actually run.
 *
 * `pagespeed` is reported as configured with or without a key, because the
 * provider does answer either way. What changes is the size of the audit: Google
 * throttles keyless callers rather than granting them a quota, so the audit
 * falls back to one measured page on one device (KEYLESS_AUDIT_LIMITS). An
 * operator who has not been told that reads the smaller Performance section as a
 * defect in the product instead of a missing variable.
 */
export function logPerformanceAuditMode(
  logger: ApiLogger,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (trimmed(env[PAGESPEED_KEY_VARIABLE]) !== null) return;
  logger.warn('performance audit runs in its reduced keyless mode', {
    variable: PAGESPEED_KEY_VARIABLE,
    maxUrls: KEYLESS_AUDIT_LIMITS.maxUrls,
    devices: 1,
    samplesPerTarget: KEYLESS_AUDIT_LIMITS.samplesPerTarget,
    maxRequests: KEYLESS_AUDIT_LIMITS.maxRequests,
  });
}
