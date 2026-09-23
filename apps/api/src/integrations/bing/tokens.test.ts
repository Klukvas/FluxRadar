// The Bing token lifecycle: refresh, revocation, and the tenant boundary.
//
// The store is a fake here rather than Prisma, so the decision logic is covered
// without a database. What the fake also proves is that the module never reads
// anything it was not handed for the account it was asked about — every call it
// makes is recorded with its accountId.

import { describe, expect, it, vi } from 'vitest';

import { encryptIntegrationSecret } from '../crypto.ts';
import { BingApiError } from './errors.ts';
import {
  BING_TOKEN_REFRESH_SKEW_MS,
  resolveBingAccess,
  type BingConnectionStore,
  type StoredBingConnection,
} from './tokens.ts';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const OAUTH_CONFIG = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://fluxradar.net/integrations/bing/callback',
};

interface Recorded {
  readonly loads: string[];
  readonly saved: { accountId: string; token: string }[];
  readonly reconnects: string[];
}

function fakeStore(connections: Readonly<Record<string, StoredBingConnection>>): {
  store: BingConnectionStore;
  recorded: Recorded;
} {
  const recorded: Recorded = { loads: [], saved: [], reconnects: [] };
  const store: BingConnectionStore = {
    async load(accountId) {
      recorded.loads.push(accountId);
      return connections[accountId] ?? null;
    },
    async saveRefreshedAccessToken(accountId, accessTokenEncrypted) {
      recorded.saved.push({ accountId, token: accessTokenEncrypted });
      return 'stored';
    },
    async markNeedsReconnect(accountId) {
      recorded.reconnects.push(accountId);
    },
  };
  return { store, recorded };
}

function connection(overrides: Partial<StoredBingConnection> = {}): StoredBingConnection {
  return {
    status: 'connected',
    accessTokenEncrypted: encryptIntegrationSecret('live-access-token'),
    refreshTokenEncrypted: encryptIntegrationSecret('stored-refresh-token'),
    tokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    scopesJson: JSON.stringify(['webmaster.read']),
    ...overrides,
  };
}

function deps(store: BingConnectionStore, fetcher?: typeof fetch) {
  return {
    store,
    oauthConfig: OAUTH_CONFIG,
    now: () => NOW,
    ...(fetcher === undefined ? {} : { fetcher }),
  };
}

/** Bing's documented refresh response: a new access token and no refresh token. */
function refreshResponse(accessToken: string): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, expires_in: 3599, token_type: 'Bearer' }),
    { status: 200 },
  );
}

describe('resolveBingAccess', () => {
  it('decrypts and returns a token that is not near expiry, without refreshing', async () => {
    const { store } = fakeStore({ 'account-1': connection() });
    const fetcher = vi.fn<typeof fetch>();
    const access = await resolveBingAccess(deps(store, fetcher), 'account-1');

    expect(access.accessToken).toBe('live-access-token');
    expect(access.hasWebmasterScope).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refreshes inside the skew window and stores the new token encrypted', async () => {
    const expiring = connection({
      tokenExpiresAt: new Date(NOW.getTime() + BING_TOKEN_REFRESH_SKEW_MS - 1_000),
    });
    const { store, recorded } = fakeStore({ 'account-1': expiring });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(refreshResponse('fresh-token'));

    const access = await resolveBingAccess(deps(store, fetcher), 'account-1');

    expect(access.accessToken).toBe('fresh-token');
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.bing.com/webmasters/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(recorded.saved).toHaveLength(1);
    // Stored encrypted, never in the clear.
    expect(recorded.saved[0]?.token).not.toContain('fresh-token');
  });

  it('keeps the stored grant when the refresh response restates no scope', async () => {
    const expiring = connection({ tokenExpiresAt: NOW });
    const { store } = fakeStore({ 'account-1': expiring });
    const access = await resolveBingAccess(
      deps(store, vi.fn<typeof fetch>().mockResolvedValue(refreshResponse('fresh'))),
      'account-1',
    );
    expect(access.scopes).toEqual(['webmaster.read']);
  });

  it('accepts the wider webmaster.manage grant as covering the read we ask for', async () => {
    const { store } = fakeStore({
      'account-1': connection({ scopesJson: JSON.stringify(['Webmaster.manage']) }),
    });
    const access = await resolveBingAccess(deps(store), 'account-1');
    expect(access.hasWebmasterScope).toBe(true);
  });

  it('treats a corrupt scope record as no scope rather than as every scope', async () => {
    const { store } = fakeStore({ 'account-1': connection({ scopesJson: '{not json' }) });
    const access = await resolveBingAccess(deps(store), 'account-1');
    expect(access.scopes).toEqual([]);
  });

  it('reports not_connected for an account with no Bing connection', async () => {
    const { store } = fakeStore({});
    await expect(resolveBingAccess(deps(store), 'account-1')).rejects.toMatchObject({
      state: 'not_connected',
    });
  });

  it('reports needs_reconnect for a connection already marked as broken', async () => {
    const { store } = fakeStore({ 'account-1': connection({ status: 'needs_reconnect' }) });
    await expect(resolveBingAccess(deps(store), 'account-1')).rejects.toMatchObject({
      state: 'needs_reconnect',
    });
  });

  it('marks the connection for reconnect when the refresh grant is rejected', async () => {
    const { store, recorded } = fakeStore({ 'account-1': connection({ tokenExpiresAt: NOW }) });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));

    const error = await resolveBingAccess(deps(store, fetcher), 'account-1').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BingApiError);
    expect((error as BingApiError).state).toBe('needs_reconnect');
    expect(recorded.reconnects).toEqual(['account-1']);
  });

  it('marks the connection for reconnect when there is no refresh token to use', async () => {
    const { store, recorded } = fakeStore({
      'account-1': connection({ tokenExpiresAt: NOW, refreshTokenEncrypted: null }),
    });
    await expect(resolveBingAccess(deps(store), 'account-1')).rejects.toMatchObject({
      state: 'needs_reconnect',
    });
    expect(recorded.reconnects).toEqual(['account-1']);
  });

  it('reports a transient refresh failure without destroying the connection', async () => {
    const { store, recorded } = fakeStore({ 'account-1': connection({ tokenExpiresAt: NOW }) });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }));

    await expect(resolveBingAccess(deps(store, fetcher), 'account-1')).rejects.toMatchObject({
      state: 'request_failed',
    });
    expect(recorded.reconnects).toEqual([]);
  });

  it('posts one refresh grant for concurrent callers of the same account', async () => {
    const { store, recorded } = fakeStore({ 'account-1': connection({ tokenExpiresAt: NOW }) });
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const first = resolveBingAccess(deps(store, fetcher), 'account-1');
    const second = resolveBingAccess(deps(store, fetcher), 'account-1');
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());
    resolveRefresh?.(refreshResponse('shared-token'));

    expect((await first).accessToken).toBe('shared-token');
    expect((await second).accessToken).toBe('shared-token');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recorded.saved).toHaveLength(1);
  });

  it('uses the token it obtained even when the store says another refresh won', async () => {
    const { store } = fakeStore({ 'account-1': connection({ tokenExpiresAt: NOW }) });
    const superseding: BingConnectionStore = {
      ...store,
      async saveRefreshedAccessToken() {
        return 'superseded';
      },
    };
    const access = await resolveBingAccess(
      deps(superseding, vi.fn<typeof fetch>().mockResolvedValue(refreshResponse('mine'))),
      'account-1',
    );
    expect(access.accessToken).toBe('mine');
  });

  it('only ever reads the account it was asked about', async () => {
    const { store, recorded } = fakeStore({
      'account-1': connection(),
      'account-2': connection({ accessTokenEncrypted: encryptIntegrationSecret('other-tenant') }),
    });
    const access = await resolveBingAccess(deps(store), 'account-1');

    expect(access.accessToken).toBe('live-access-token');
    expect(recorded.loads).toEqual(['account-1']);
  });
});
