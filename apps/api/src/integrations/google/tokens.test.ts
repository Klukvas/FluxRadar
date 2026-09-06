import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { encryptIntegrationSecret } from '../crypto.ts';
import { GoogleApiError } from './errors.ts';
import {
  resolveGoogleAccess,
  TOKEN_REFRESH_SKEW_MS,
  type GoogleConnectionStore,
  type StoredGoogleConnection,
} from './tokens.ts';

const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = 'google-token-test-key';
});

afterAll(() => {
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});

const NOW = new Date('2026-09-06T12:00:00.000Z');
const OAUTH_CONFIG = {
  clientId: 'client',
  clientSecret: 'secret',
  redirectUri: 'https://example.test/callback',
};
const SCOPES = JSON.stringify([
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
]);

function connection(overrides: Partial<StoredGoogleConnection> = {}): StoredGoogleConnection {
  return {
    status: 'connected',
    accessTokenEncrypted: encryptIntegrationSecret('live-access-token'),
    refreshTokenEncrypted: encryptIntegrationSecret('refresh-token'),
    tokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    scopesJson: SCOPES,
    ...overrides,
  };
}

function storeFor(record: StoredGoogleConnection | null): {
  store: GoogleConnectionStore;
  saved: ReturnType<typeof vi.fn>;
  reconnect: ReturnType<typeof vi.fn>;
} {
  const saved = vi.fn(async () => undefined);
  const reconnect = vi.fn(async () => undefined);
  return {
    saved,
    reconnect,
    store: {
      load: async () => record,
      saveRefreshedAccessToken: saved,
      markNeedsReconnect: reconnect,
    },
  };
}

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('resolveGoogleAccess', () => {
  it('reports not_connected when the account never authorized Google', async () => {
    const { store } = storeFor(null);

    const error = await resolveGoogleAccess(
      { store, oauthConfig: OAUTH_CONFIG, now: () => NOW },
      'account-1',
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).state).toBe('not_connected');
  });

  it('reports needs_reconnect for a connection already flagged by a previous failure', async () => {
    const { store } = storeFor(connection({ status: 'needs_reconnect' }));

    await expect(
      resolveGoogleAccess({ store, oauthConfig: OAUTH_CONFIG, now: () => NOW }, 'account-1'),
    ).rejects.toMatchObject({ state: 'needs_reconnect' });
  });

  it('uses the stored token unchanged while it is still valid', async () => {
    const { store, saved } = storeFor(connection());

    const access = await resolveGoogleAccess(
      { store, oauthConfig: OAUTH_CONFIG, now: () => NOW },
      'account-1',
    );

    expect(access.accessToken).toBe('live-access-token');
    expect(access.hasSearchConsoleScope).toBe(true);
    expect(access.hasAnalyticsScope).toBe(true);
    expect(saved).not.toHaveBeenCalled();
  });

  it('refreshes a token inside the expiry skew and persists the new one', async () => {
    const { store, saved } = storeFor(
      connection({ tokenExpiresAt: new Date(NOW.getTime() + TOKEN_REFRESH_SKEW_MS - 1_000) }),
    );
    const fetcher = vi.fn(async () =>
      tokenResponse({ access_token: 'refreshed-token', expires_in: 3600 }),
    );

    const access = await resolveGoogleAccess(
      {
        store,
        oauthConfig: OAUTH_CONFIG,
        now: () => NOW,
        fetcher: fetcher as unknown as typeof fetch,
      },
      'account-1',
    );

    expect(access.accessToken).toBe('refreshed-token');
    // The refresh response omitted `scope`, so the stored grant stays authoritative.
    expect(access.hasSearchConsoleScope).toBe(true);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0]?.[1]).not.toContain('refreshed-token');
  });

  it('marks the connection for reconnect when Google rejects the refresh grant', async () => {
    const { store, reconnect } = storeFor(connection({ tokenExpiresAt: NOW }));
    const fetcher = vi.fn(async () => tokenResponse({ error: 'invalid_grant' }, 400));

    await expect(
      resolveGoogleAccess(
        {
          store,
          oauthConfig: OAUTH_CONFIG,
          now: () => NOW,
          fetcher: fetcher as unknown as typeof fetch,
        },
        'account-1',
      ),
    ).rejects.toMatchObject({ state: 'needs_reconnect' });
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('treats a provider outage during refresh as retryable, not as a revoked grant', async () => {
    const { store, reconnect } = storeFor(connection({ tokenExpiresAt: NOW }));
    const fetcher = vi.fn(async () => tokenResponse({}, 500));

    await expect(
      resolveGoogleAccess(
        {
          store,
          oauthConfig: OAUTH_CONFIG,
          now: () => NOW,
          fetcher: fetcher as unknown as typeof fetch,
        },
        'account-1',
      ),
    ).rejects.toMatchObject({ state: 'request_failed' });
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('needs a reconnect when the expired connection has no refresh token', async () => {
    const { store, reconnect } = storeFor(
      connection({ tokenExpiresAt: NOW, refreshTokenEncrypted: null }),
    );

    await expect(
      resolveGoogleAccess({ store, oauthConfig: OAUTH_CONFIG, now: () => NOW }, 'account-1'),
    ).rejects.toMatchObject({ state: 'needs_reconnect' });
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('does not assume a scope when the stored grant is unreadable', async () => {
    const { store } = storeFor(connection({ scopesJson: 'not json' }));

    const access = await resolveGoogleAccess(
      { store, oauthConfig: OAUTH_CONFIG, now: () => NOW },
      'account-1',
    );

    expect(access.hasSearchConsoleScope).toBe(false);
    expect(access.hasAnalyticsScope).toBe(false);
  });
});
