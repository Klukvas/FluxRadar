import { describe, expect, it } from 'vitest';

import type { ApiLogger } from '../http/logger.ts';
import { logIntegrationStatuses, readIntegrationStatuses } from './diagnostics.ts';
import { OBJECT_STORAGE_ENV_VARS } from './object-storage-config.ts';
import { OAUTH_ENV_VARS } from './oauth-config.ts';

interface LoggedLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

function recordingLogger(): { readonly lines: LoggedLine[]; readonly logger: ApiLogger } {
  const lines: LoggedLine[] = [];
  const record =
    (level: LoggedLine['level']) =>
    (message: string, context: Readonly<Record<string, unknown>> = {}): void => {
      lines.push({ level, message, context });
    };
  return {
    lines,
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
  };
}

function statusOf(env: NodeJS.ProcessEnv, integration: string): string {
  const status = readIntegrationStatuses(env).find((entry) => entry.integration === integration);
  expect(status, `no status reported for ${integration}`).toBeDefined();
  return status?.status ?? '';
}

const SECRET_VALUE = 'super-secret-value';

describe('startup integration diagnostics', () => {
  it('reports every integration, even when nothing is configured', () => {
    const statuses = readIntegrationStatuses({});

    expect(statuses.map((entry) => entry.integration)).toEqual([
      'storage',
      'anthropic',
      'pagespeed',
      'crux',
      'resend',
      'google',
      'bing',
      'fastspring',
    ]);
    expect(statuses.every((entry) => entry.status === 'not_configured')).toBe(true);
  });

  it('reports a configured single-key integration', () => {
    expect(statusOf({ PAGESPEED_API_KEY: 'key' }, 'pagespeed')).toBe('configured');
    expect(statusOf({ CRUX_API_KEY: 'key' }, 'crux')).toBe('configured');
    expect(statusOf({ ANTHROPIC_API_KEY: 'key' }, 'anthropic')).toBe('configured');
  });

  it('reports a half-configured Resend pair', () => {
    expect(statusOf({ RESEND_API_KEY: 'key' }, 'resend')).toBe('invalid');
    expect(statusOf({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'a@b.c' }, 'resend')).toBe(
      'configured',
    );
  });

  it('reports a retired Anthropic model as invalid once a key is present', () => {
    expect(statusOf({ ANTHROPIC_API_KEY: 'key', ANTHROPIC_MODEL: 'claude-sonnet-4' }, 'anthropic')) //
      .toBe('invalid');
    // Without a key the AI provider is simply off and the model is irrelevant.
    expect(statusOf({ ANTHROPIC_MODEL: 'claude-sonnet-4' }, 'anthropic')).toBe('not_configured');
  });

  it('logs names and statuses, never values', () => {
    const { lines, logger } = recordingLogger();
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      PAGESPEED_API_KEY: SECRET_VALUE,
      [OBJECT_STORAGE_ENV_VARS.bucket]: 'fluxradar-reports',
      [OAUTH_ENV_VARS.google.clientId]: 'client-id',
      [OAUTH_ENV_VARS.google.clientSecret]: SECRET_VALUE,
      [OAUTH_ENV_VARS.google.redirectUri]: 'https://fluxradar.net/api/integrations/google/callback',
    };

    logIntegrationStatuses(logger, readIntegrationStatuses(env));

    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain('client-id');

    const summary = lines.find((line) => line.message === 'integration configuration');
    expect(summary?.context.configured).toContain('google');
    expect(summary?.context.configured).toContain('pagespeed');
    expect(summary?.context.disabled).toContain('bing');
    expect(summary?.context.invalid).toContain('storage');
  });

  it('names the missing variables of a half-configured integration', () => {
    const { lines, logger } = recordingLogger();

    logIntegrationStatuses(
      logger,
      readIntegrationStatuses({ [OBJECT_STORAGE_ENV_VARS.bucket]: 'fluxradar-reports' }),
    );

    const failure = lines.find((line) => line.level === 'error');
    expect(failure?.message).toBe('integration is only partially configured');
    expect(failure?.context.integration).toBe('storage');
    expect(failure?.context.missing).toContain(OBJECT_STORAGE_ENV_VARS.secretKey);
  });
});
