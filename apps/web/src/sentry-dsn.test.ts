import { describe, expect, it } from 'vitest';

import { sentryDsnProblem } from './sentry-dsn';

/** The shape Sentry issues: a 32-hex public key, an org host in the EU region, a numeric project. */
const KEY = '0123456789abcdef0123456789abcdef';
const EU_DSN = `https://${KEY}@o4500.ingest.de.sentry.io/4500123`;

// The rules vite.config.ts builds with and error-monitoring.ts runs with, the
// same as the API's sentry-config.ts.
describe('sentryDsnProblem', () => {
  it.each([
    EU_DSN,
    `https://${KEY}:${KEY}@o4500.ingest.de.sentry.io/4500123`,
    `https://${KEY}@o4500.ingest.de.sentry.io/prefix/4500123`,
  ])('accepts %s', (dsn) => {
    expect(sentryDsnProblem(dsn, 'production')).toBeNull();
  });

  it.each([
    ['not a url', 'not a URL'],
    [`http://${KEY}@o4500.ingest.de.sentry.io/4500123`, 'https://'],
    [`https://${KEY}@o4500.ingest.us.sentry.io/4500123`, 'EU (Germany)'],
    [`https://${KEY}@o4500.ingest.de.sentry.io.example.com/4500123`, 'EU (Germany)'],
    ['https://o4500.ingest.de.sentry.io/4500123', 'no public key'],
    ['https://public-key@o4500.ingest.de.sentry.io/4500123', 'letters, digits and underscores'],
    [`https://${KEY}:se-cret@o4500.ingest.de.sentry.io/4500123`, 'letters, digits and underscores'],
    [`${EU_DSN}?x=1`, 'query string'],
    [`https://${KEY}@o4500.ingest.de.sentry.io/`, 'numeric project id'],
  ])('refuses %s, naming why', (dsn, problem) => {
    const reason = sentryDsnProblem(dsn, 'production');

    expect(reason).toContain(problem);
    expect(reason).not.toContain(KEY);
  });

  it('accepts plain http to a loopback ingest outside production builds only', () => {
    const local = `http://${KEY}@127.0.0.1:9912/2`;

    expect(sentryDsnProblem(local, 'proof')).toBeNull();
    expect(sentryDsnProblem(local, 'production')).toContain('https://');
    expect(sentryDsnProblem(`http://${KEY}@10.0.0.5:9912/2`, 'proof')).toContain('https://');
  });
});
