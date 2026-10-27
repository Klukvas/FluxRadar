import { describe, expect, it } from 'vitest';

import { readSentryConfig } from './sentry-config.ts';

/** The shape Sentry issues: a 32-hex public key, an org host in the EU region, a numeric project. */
const KEY = '0123456789abcdef0123456789abcdef';
const EU_DSN = `https://${KEY}@o4500.ingest.de.sentry.io/4500123`;

describe('readSentryConfig', () => {
  it.each([{}, { SENTRY_DSN: '' }, { SENTRY_DSN: '   ' }])(
    'treats an absent or empty DSN as not configured (%o)',
    (env) => {
      expect(readSentryConfig(env)).toEqual({ state: 'not_configured' });
    },
  );

  // Every production image carries its SHA, with or without a DSN.
  it('is not turned on by a release alone', () => {
    expect(readSentryConfig({ SENTRY_RELEASE: '655a4aa8' })).toEqual({ state: 'not_configured' });
  });

  it('reads an EU DSN with the environment and the release', () => {
    expect(
      readSentryConfig({ SENTRY_DSN: EU_DSN, NODE_ENV: 'production', SENTRY_RELEASE: '655a4aa8' }),
    ).toEqual({
      state: 'configured',
      config: { dsn: EU_DSN, environment: 'production', release: '655a4aa8' },
    });
  });

  it('labels a process without NODE_ENV as development and leaves the release empty', () => {
    expect(readSentryConfig({ SENTRY_DSN: EU_DSN })).toEqual({
      state: 'configured',
      config: { dsn: EU_DSN, environment: 'development', release: null },
    });
  });

  it.each([
    ['not a url', 'it is not a URL'],
    [`http://${KEY}@o4500.ingest.de.sentry.io/4500123`, 'https://'],
    ['https://o4500.ingest.de.sentry.io/4500123', 'no public key'],
    // The SDK reads only a \w+ key: anything else it prints in full and then
    // reports nothing, so these must not pass as configured.
    ['https://public-key@o4500.ingest.de.sentry.io/4500123', 'letters, digits and underscores'],
    [`https://${KEY}:se-cret@o4500.ingest.de.sentry.io/4500123`, 'letters, digits and underscores'],
    ['https://k%C3%A9y@o4500.ingest.de.sentry.io/4500123', 'letters, digits and underscores'],
    [`${EU_DSN}?x=1`, 'query string'],
    [`https://${KEY}@o4500.ingest.de.sentry.io/`, 'numeric project id'],
    // Reports are promised to stay in the EU; another region is refused by name.
    [`https://${KEY}@o4500.ingest.us.sentry.io/4500123`, 'EU (Germany)'],
    [`https://${KEY}@o4500.ingest.sentry.io/4500123`, 'ingest.de.sentry.io'],
    [`https://${KEY}@o4500.ingest.de.sentry.io.example.com/4500123`, 'EU (Germany)'],
  ])('refuses %s by name, without repeating it', (dsn, problem) => {
    const result = readSentryConfig({ SENTRY_DSN: dsn, NODE_ENV: 'production' });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual(['SENTRY_DSN']);
    expect(result.reason).toContain('SENTRY_DSN');
    expect(result.reason).toContain(problem);
    expect(result.reason).not.toContain(KEY);
    expect(result.reason).not.toContain(dsn);
  });

  // How a developer looks at what would be sent: a fake ingest on loopback.
  it('accepts plain http to a loopback ingest outside production only', () => {
    const local = `http://${KEY}@127.0.0.1:9999/1`;

    expect(readSentryConfig({ SENTRY_DSN: local, NODE_ENV: 'development' }).state).toBe(
      'configured',
    );
    expect(readSentryConfig({ SENTRY_DSN: local, NODE_ENV: 'production' }).state).toBe('invalid');
    expect(readSentryConfig({ SENTRY_DSN: `http://${KEY}@10.0.0.5:9999/1` }).state).toBe('invalid');
  });

  // Both are DSNs the SDK reads: a legacy secret, and a path before the project id.
  it.each([
    `https://${KEY}:${KEY}@o4500.ingest.de.sentry.io/4500123`,
    `https://${KEY}@o4500.ingest.de.sentry.io/prefix/4500123`,
  ])('accepts %s', (dsn) => {
    expect(readSentryConfig({ SENTRY_DSN: dsn, NODE_ENV: 'production' }).state).toBe('configured');
  });

  it('refuses a release name Sentry would reject', () => {
    const result = readSentryConfig({ SENTRY_DSN: EU_DSN, SENTRY_RELEASE: 'main/655a4aa8' });

    expect(result).toMatchObject({ state: 'invalid', missing: ['SENTRY_RELEASE'] });
  });
});
