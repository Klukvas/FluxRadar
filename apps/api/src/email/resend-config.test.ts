// Transactional email configuration, and the failure it used to hide.
//
// Email is optional, and that is the right call — a deployment with no Resend
// account still sells and runs scans. What is not acceptable is the state
// between off and on, because FluxRadar produces no error for it anywhere: the
// registration succeeds, the browser is told a verification email is on its way,
// and nothing ever arrives. Half a configuration and a sender Resend will reject
// are both that state, so both are reported at boot, by variable name.

import { describe, expect, it } from 'vitest';

import { RESEND_ENV_VARS, readResendConfig } from './resend-config.ts';
import { NotConfiguredMailer, ResendMailer, createMailer } from './mailer.ts';
import { readIntegrationStatuses } from '../integrations/diagnostics.ts';

const API_KEY = 're_test_api_key_value';

function resendStatus(env: NodeJS.ProcessEnv) {
  return readIntegrationStatuses(env).find((entry) => entry.integration === 'resend');
}

describe('resend configuration', () => {
  it('is simply off when no variable is set', () => {
    expect(readResendConfig({})).toEqual({ state: 'not_configured' });
  });

  it('accepts a bare address and a display-name sender', () => {
    for (const from of ['mail@fluxradar.net', 'FluxRadar <mail@fluxradar.net>']) {
      expect(
        readResendConfig({ [RESEND_ENV_VARS.apiKey]: API_KEY, [RESEND_ENV_VARS.from]: from }),
      ).toEqual({ state: 'configured', config: { apiKey: API_KEY, from } });
    }
  });

  it('carries an optional reply-to through', () => {
    const result = readResendConfig({
      [RESEND_ENV_VARS.apiKey]: API_KEY,
      [RESEND_ENV_VARS.from]: 'mail@fluxradar.net',
      [RESEND_ENV_VARS.replyTo]: 'support@fluxradar.net',
    });

    expect(result).toEqual({
      state: 'configured',
      config: { apiKey: API_KEY, from: 'mail@fluxradar.net', replyTo: 'support@fluxradar.net' },
    });
  });

  it.each([
    ['only the key', { [RESEND_ENV_VARS.apiKey]: API_KEY }, RESEND_ENV_VARS.from],
    ['only the sender', { [RESEND_ENV_VARS.from]: 'mail@fluxradar.net' }, RESEND_ENV_VARS.apiKey],
  ])('names what is missing with %s', (_case, env, expected) => {
    const result = readResendConfig(env);

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toContain(expected);
    expect(result.reason).not.toContain(API_KEY);
  });

  // A sender Resend refuses is indistinguishable from a working one until a
  // customer says the email never came.
  it.each(['fluxradar.net', 'mail@localhost', 'FluxRadar mail@fluxradar.net', 'not an address'])(
    'refuses %s as a sender',
    (from) => {
      const result = readResendConfig({
        [RESEND_ENV_VARS.apiKey]: API_KEY,
        [RESEND_ENV_VARS.from]: from,
      });

      expect(result.state).toBe('invalid');
      if (result.state !== 'invalid') return;
      expect(result.missing).toEqual([RESEND_ENV_VARS.from]);
    },
  );

  it('refuses a reply-to that is not an address', () => {
    const result = readResendConfig({
      [RESEND_ENV_VARS.apiKey]: API_KEY,
      [RESEND_ENV_VARS.from]: 'mail@fluxradar.net',
      [RESEND_ENV_VARS.replyTo]: 'support',
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual([RESEND_ENV_VARS.replyTo]);
  });

  it('reports a reply-to left behind on its own rather than reading as unconfigured', () => {
    expect(readResendConfig({ [RESEND_ENV_VARS.replyTo]: 'support@fluxradar.net' }).state).toBe(
      'invalid',
    );
  });

  it('never puts the API key in a reason', () => {
    const reasons = [
      readResendConfig({ [RESEND_ENV_VARS.apiKey]: API_KEY }),
      readResendConfig({ [RESEND_ENV_VARS.apiKey]: API_KEY, [RESEND_ENV_VARS.from]: 'nope' }),
    ];

    expect(JSON.stringify(reasons)).not.toContain(API_KEY);
  });
});

describe('the mailer built from it', () => {
  it('sends through Resend only when the configuration is complete and usable', () => {
    expect(
      createMailer({
        NODE_ENV: 'production',
        [RESEND_ENV_VARS.apiKey]: API_KEY,
        [RESEND_ENV_VARS.from]: 'FluxRadar <mail@fluxradar.net>',
      }),
    ).toBeInstanceOf(ResendMailer);
  });

  // The important half: a sender that would be rejected must not produce a
  // mailer that reports `sent` for messages the provider throws away.
  it.each([
    ['an unusable sender', { [RESEND_ENV_VARS.apiKey]: API_KEY, [RESEND_ENV_VARS.from]: 'nope' }],
    ['no sender at all', { [RESEND_ENV_VARS.apiKey]: API_KEY }],
    ['nothing configured', {}],
  ])('stays off with %s, and says so', async (_case, env) => {
    const mailer = createMailer({ NODE_ENV: 'production', ...env });

    expect(mailer).toBeInstanceOf(NotConfiguredMailer);
    expect(mailer.configured).toBe(false);
    const result = await mailer.send({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
    });
    expect(result.status).toBe('not-configured');
  });
});

describe('the startup diagnostics', () => {
  it('report the same three states the mailer is built from', () => {
    expect(resendStatus({})?.status).toBe('not_configured');
    expect(
      resendStatus({
        [RESEND_ENV_VARS.apiKey]: API_KEY,
        [RESEND_ENV_VARS.from]: 'mail@fluxradar.net',
      })?.status,
    ).toBe('configured');
  });

  it('name the variable behind a half-configured provider, never its value', () => {
    const status = resendStatus({ [RESEND_ENV_VARS.apiKey]: API_KEY });

    expect(status?.status).toBe('invalid');
    expect(status?.missing).toContain(RESEND_ENV_VARS.from);
    expect(JSON.stringify(status)).not.toContain(API_KEY);
  });

  it('report an unusable sender as invalid rather than as configured', () => {
    const status = resendStatus({
      [RESEND_ENV_VARS.apiKey]: API_KEY,
      [RESEND_ENV_VARS.from]: 'fluxradar.net',
    });

    expect(status?.status).toBe('invalid');
    expect(status?.missing).toEqual([RESEND_ENV_VARS.from]);
  });
});
