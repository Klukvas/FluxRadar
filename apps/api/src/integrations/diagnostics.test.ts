import { describe, expect, it } from 'vitest';

import type { ApiLogger } from '../http/logger.ts';
import { FAKE_TELEGRAM_BOT_TOKEN } from '../test-utils/fake-credentials.ts';
import {
  logIntegrationStatuses,
  logPerformanceAuditMode,
  readIntegrationStatuses,
} from './diagnostics.ts';
import { OBJECT_STORAGE_ENV_VARS } from './object-storage-config.ts';
import { OAUTH_ENV_VARS } from './oauth-config.ts';
import { GEMINI_ENV_VARS, PERPLEXITY_ENV_VARS } from './opt-in-ai-config.ts';

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
      'openai',
      'google-ai',
      'perplexity',
      'pagespeed',
      'crux',
      'resend',
      'telegram',
      'google',
      'bing',
      'fastspring',
    ]);
    expect(statusOf({}, 'pagespeed')).toBe('configured');
    expect(
      statuses
        .filter((entry) => entry.integration !== 'pagespeed')
        .every((entry) => entry.status === 'not_configured'),
    ).toBe(true);
  });

  it('reports a configured single-key integration', () => {
    expect(statusOf({ PAGESPEED_API_KEY: 'key' }, 'pagespeed')).toBe('configured');
    expect(statusOf({ CRUX_API_KEY: 'key' }, 'crux')).toBe('configured');
    expect(statusOf({ ANTHROPIC_API_KEY: 'key' }, 'anthropic')).toBe('configured');
    expect(statusOf({ OPENAI_API_KEY: 'key' }, 'openai')).toBe('configured');
    expect(statusOf({ [GEMINI_ENV_VARS.apiKey]: 'key' }, 'google-ai')).toBe('configured');
    expect(statusOf({ [PERPLEXITY_ENV_VARS.apiKey]: 'key' }, 'perplexity')).toBe('configured');
  });

  it('refuses a Perplexity endpoint nobody documented instead of falling back', () => {
    // The request carries customer page context. Silently using the default
    // would send it somewhere the operator did not choose; accepting the value
    // would send it somewhere Perplexity never published.
    const env = {
      [PERPLEXITY_ENV_VARS.apiKey]: 'key',
      [PERPLEXITY_ENV_VARS.endpointUrl]: 'https://attacker.example/v1/chat/completions',
    };

    expect(statusOf(env, 'perplexity')).toBe('invalid');
    const status = readIntegrationStatuses(env).find((entry) => entry.integration === 'perplexity');
    expect(status?.missing).toContain(PERPLEXITY_ENV_VARS.endpointUrl);
  });

  it('reports a half-configured Resend pair', () => {
    expect(statusOf({ RESEND_API_KEY: 'key' }, 'resend')).toBe('invalid');
    expect(statusOf({ RESEND_API_KEY: 'key', RESEND_FROM_EMAIL: 'a@b.c' }, 'resend')).toBe(
      'configured',
    );
  });

  it('reports a half-configured Telegram support pair', () => {
    expect(statusOf({ TELEGRAM_SUPPORT_CHAT_ID: '@fluxradar_support' }, 'telegram')).toBe(
      'invalid',
    );
    expect(
      statusOf(
        {
          TELEGRAM_BOT_TOKEN: FAKE_TELEGRAM_BOT_TOKEN,
          TELEGRAM_SUPPORT_CHAT_ID: '-1001234567890',
        },
        'telegram',
      ),
    ).toBe('configured');
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

  // "pagespeed: configured" is true either way — the provider answers keyless
  // requests. What it does not say is that the audit is then a single measured
  // page, which an operator would otherwise read as a defect in the report.
  it('says at boot which Performance audit a keyless deployment will run', () => {
    const { lines, logger } = recordingLogger();

    logPerformanceAuditMode(logger, {});

    const reduced = lines.find(
      (line) => line.message === 'performance audit runs in its reduced keyless mode',
    );
    expect(reduced?.level).toBe('warn');
    expect(reduced?.context).toMatchObject({ variable: 'PAGESPEED_API_KEY', maxRequests: 1 });
  });

  it('stays quiet about the audit mode once a PageSpeed key is configured', () => {
    const { lines, logger } = recordingLogger();

    logPerformanceAuditMode(logger, { PAGESPEED_API_KEY: SECRET_VALUE });

    expect(lines).toEqual([]);
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
