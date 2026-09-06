import { describe, expect, it } from 'vitest';

import { OAUTH_ENV_VARS, readOAuthConfig } from './oauth-config.ts';
import { USER_INTEGRATION_PROVIDERS } from './providers.ts';

const PRODUCTION_CALLBACKS = {
  google: 'https://fluxradar.net/api/integrations/google/callback',
  bing: 'https://fluxradar.net/api/integrations/bing/callback',
} as const;

function productionEnv(
  provider: (typeof USER_INTEGRATION_PROVIDERS)[number],
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const vars = OAUTH_ENV_VARS[provider];
  return {
    NODE_ENV: 'production',
    [vars.clientId]: 'client-id',
    [vars.clientSecret]: 'client-secret',
    [vars.redirectUri]: PRODUCTION_CALLBACKS[provider],
    ...overrides,
  };
}

describe('OAuth provider configuration', () => {
  it('is off, not broken, when no variable is set', () => {
    for (const provider of USER_INTEGRATION_PROVIDERS) {
      expect(readOAuthConfig(provider, { NODE_ENV: 'production' }).state).toBe('not_configured');
    }
  });

  // .env.example ships the localhost callbacks pre-filled, so a redirect URI on
  // its own must not read as a half-configured provider.
  it('is off when only the redirect URI is set', () => {
    for (const provider of USER_INTEGRATION_PROVIDERS) {
      const result = readOAuthConfig(provider, {
        NODE_ENV: 'production',
        [OAUTH_ENV_VARS[provider].redirectUri]: PRODUCTION_CALLBACKS[provider],
      });

      expect(result.state).toBe('not_configured');
    }
  });

  it('keeps the localhost callback outside production', () => {
    for (const provider of USER_INTEGRATION_PROVIDERS) {
      const vars = OAUTH_ENV_VARS[provider];
      const result = readOAuthConfig(provider, {
        NODE_ENV: 'development',
        [vars.clientId]: 'client-id',
        [vars.clientSecret]: 'client-secret',
      });

      expect(result.state).toBe('configured');
      if (result.state !== 'configured') return;
      expect(result.config.redirectUri).toBe(
        `http://localhost:3310/integrations/${provider}/callback`,
      );
    }
  });

  // The regression this whole module exists for: production used to fall back to
  // the localhost callback, which the provider rejects only after the user has
  // already gone through the consent screen.
  it('refuses a production deploy that has credentials but no callback', () => {
    for (const provider of USER_INTEGRATION_PROVIDERS) {
      const vars = OAUTH_ENV_VARS[provider];
      const result = readOAuthConfig(provider, {
        NODE_ENV: 'production',
        [vars.clientId]: 'client-id',
        [vars.clientSecret]: 'client-secret',
      });

      expect(result.state).toBe('invalid');
      if (result.state !== 'invalid') return;
      expect(result.missing).toEqual([vars.redirectUri]);
      expect(result.reason).not.toContain('localhost');
    }
  });

  it.each([
    ['http (not https)', 'http://fluxradar.net/api/integrations/google/callback'],
    ['a localhost callback', 'http://localhost:3310/integrations/google/callback'],
    ['a foreign host', 'https://evil.example.com/api/integrations/google/callback'],
    [
      'a host that only ends in the app domain',
      'https://notfluxradar.net/integrations/google/callback',
    ],
    ['a callback path the API does not serve', 'https://fluxradar.net/oauth/done'],
    ['a value that is not a URL', 'fluxradar.net/integrations/google/callback'],
  ])('refuses %s in production', (_case, redirectUri) => {
    const result = readOAuthConfig(
      'google',
      productionEnv('google', { [OAUTH_ENV_VARS.google.redirectUri]: redirectUri }),
    );

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual([OAUTH_ENV_VARS.google.redirectUri]);
  });

  it('accepts an HTTPS callback on the application host', () => {
    for (const provider of USER_INTEGRATION_PROVIDERS) {
      const result = readOAuthConfig(provider, productionEnv(provider));

      expect(result.state).toBe('configured');
      if (result.state !== 'configured') return;
      expect(result.config.redirectUri).toBe(PRODUCTION_CALLBACKS[provider]);
    }
  });

  it('accepts the www host too', () => {
    const result = readOAuthConfig(
      'google',
      productionEnv('google', {
        [OAUTH_ENV_VARS.google.redirectUri]:
          'https://www.fluxradar.net/api/integrations/google/callback',
      }),
    );

    expect(result.state).toBe('configured');
  });

  it('reports a half-configured provider by name in every environment', () => {
    for (const provider of USER_INTEGRATION_PROVIDERS) {
      const vars = OAUTH_ENV_VARS[provider];
      const result = readOAuthConfig(provider, {
        NODE_ENV: 'development',
        [vars.clientId]: 'client-id',
      });

      expect(result.state).toBe('invalid');
      if (result.state !== 'invalid') return;
      expect(result.missing).toEqual([vars.clientSecret]);
    }
  });

  it('never puts a credential value in the reason', () => {
    const result = readOAuthConfig('google', {
      NODE_ENV: 'production',
      [OAUTH_ENV_VARS.google.clientId]: 'public-client-id',
      [OAUTH_ENV_VARS.google.clientSecret]: 'super-secret-value',
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.reason).not.toContain('super-secret-value');
    expect(result.reason).not.toContain('public-client-id');
  });
});
