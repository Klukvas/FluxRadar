// The staging case is the one this file exists for: a deployment whose NODE_ENV
// is anything other than `production` used to receive a mailbox that answered
// `sent` to every message and delivered none of them.

import { describe, expect, it } from 'vitest';

import { validateRuntimeConfig } from '../integrations/config.ts';
import { MockMailer, NotConfiguredMailer, ResendMailer, createMailer } from './mailer.ts';
import { MOCK_EMAIL_ENV, isMockEmailOptIn, usesMockMailbox } from './mock-email.ts';

const RESEND = {
  RESEND_API_KEY: 'resend-test-key',
  RESEND_FROM_EMAIL: 'FluxRadar <mail@example.com>',
} as const;

describe('usesMockMailbox', () => {
  it('is on for the automated test run', () => {
    expect(usesMockMailbox({ NODE_ENV: 'test' })).toBe(true);
  });

  it('is off in development until the opt-in names it', () => {
    expect(usesMockMailbox({ NODE_ENV: 'development' })).toBe(false);
    expect(usesMockMailbox({ NODE_ENV: 'development', [MOCK_EMAIL_ENV]: 'true' })).toBe(true);
  });

  it.each(['staging', 'production', '', undefined])(
    'is off for NODE_ENV=%p even with the opt-in set',
    (nodeEnv) => {
      const env = {
        ...(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }),
        [MOCK_EMAIL_ENV]: 'true',
      };
      expect(usesMockMailbox(env)).toBe(false);
    },
  );

  it.each(['1', 'yes', 'TRUE ', 'on', ''])(
    'treats the ambiguous opt-in value %p as off',
    (value) => {
      expect(isMockEmailOptIn({ [MOCK_EMAIL_ENV]: value })).toBe(value.trim() === 'TRUE');
    },
  );
});

describe('createMailer', () => {
  it('gives the test run the offline mailbox', () => {
    expect(createMailer({ NODE_ENV: 'test', ...RESEND })).toBeInstanceOf(MockMailer);
  });

  it('gives staging the configured provider, not a fake mailbox', () => {
    expect(createMailer({ NODE_ENV: 'staging', ...RESEND })).toBeInstanceOf(ResendMailer);
  });

  it('fails closed on staging with no provider: not-configured, never a fake sent', async () => {
    const mailer = createMailer({ NODE_ENV: 'staging', [MOCK_EMAIL_ENV]: 'true' });
    expect(mailer).toBeInstanceOf(NotConfiguredMailer);
    expect(mailer.configured).toBe(false);
    const delivery = await mailer.send({
      to: 'buyer@example.com',
      subject: 'Verify your email',
      html: '<p>link</p>',
      text: 'link',
    });
    expect(delivery.status).toBe('not-configured');
  });

  it('fails closed when NODE_ENV was never set at all', () => {
    expect(createMailer({})).toBeInstanceOf(NotConfiguredMailer);
  });

  it('still refuses to fake production email when the opt-in is present', () => {
    expect(createMailer({ NODE_ENV: 'production', [MOCK_EMAIL_ENV]: 'true' })).toBeInstanceOf(
      NotConfiguredMailer,
    );
  });
});

describe('validateRuntimeConfig', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user@db.internal:5432/fluxradar',
    INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(64),
    SESSION_SECRET: 'b'.repeat(64),
  } as const;

  it('refuses to boot production with the fake mailbox requested', () => {
    expect(() => validateRuntimeConfig({ ...production, [MOCK_EMAIL_ENV]: 'true' })).toThrow(
      new RegExp(MOCK_EMAIL_ENV),
    );
  });

  it('boots production without it', () => {
    expect(() => validateRuntimeConfig({ ...production })).not.toThrow();
  });
});
