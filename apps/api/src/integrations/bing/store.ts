// Prisma-backed persistence for the Bing flow. Every query is scoped by
// accountId: a binding or a connection is never reachable across tenants, and
// the `provider: 'bing'` filter keeps the Google connection on the same account
// out of reach as well.

import type { PrismaClient } from '@prisma/client';

import type { BingConnectionStore, StoredBingConnection } from './tokens.ts';

export const BING_PROVIDER = 'bing' as const;

export function prismaBingConnectionStore(
  prisma: PrismaClient,
  now: () => Date,
): BingConnectionStore {
  return {
    async load(accountId: string): Promise<StoredBingConnection | null> {
      const connection = await prisma.integrationConnection.findUnique({
        where: { accountId_provider: { accountId, provider: BING_PROVIDER } },
      });
      return connection === null
        ? null
        : {
            status: connection.status,
            accessTokenEncrypted: connection.accessTokenEncrypted,
            refreshTokenEncrypted: connection.refreshTokenEncrypted,
            tokenExpiresAt: connection.tokenExpiresAt,
            scopesJson: connection.scopesJson,
          };
    },
    /**
     * Compare-and-set on the expiry: the row is only replaced when the token it
     * holds expires before the one being written.
     *
     * Two processes can refresh the same account at the same moment — a scan and
     * the integrations screen — and without the condition the slower response
     * would overwrite the newer token with an older one, shortening the window
     * for everybody. `updateMany` reports how many rows it changed, which is what
     * makes this a CAS rather than a hopeful write.
     */
    async saveRefreshedAccessToken(accountId, accessTokenEncrypted, tokenExpiresAt) {
      const { count } = await prisma.integrationConnection.updateMany({
        where: {
          accountId,
          provider: BING_PROVIDER,
          ...(tokenExpiresAt === null
            ? {}
            : { OR: [{ tokenExpiresAt: null }, { tokenExpiresAt: { lt: tokenExpiresAt } }] }),
        },
        data: { accessTokenEncrypted, tokenExpiresAt, lastCheckedAt: now(), lastError: null },
      });
      return count > 0 ? 'stored' : 'superseded';
    },
    async markNeedsReconnect(accountId, detail) {
      await prisma.integrationConnection.updateMany({
        where: { accountId, provider: BING_PROVIDER },
        data: { status: 'needs_reconnect', lastError: detail, lastCheckedAt: now() },
      });
    },
  };
}

/** The Bing site chosen for one site profile, or null when none was. */
export interface BingBinding {
  readonly siteUrl: string | null;
  readonly verifiedAtSelection: boolean;
}

export const EMPTY_BING_BINDING: BingBinding = { siteUrl: null, verifiedAtSelection: false };

/**
 * Returns an empty binding rather than null so callers report "no site
 * selected" uniformly whether the row is absent or present but unset.
 */
export async function loadBingBinding(
  prisma: PrismaClient,
  accountId: string,
  siteProfileId: string,
): Promise<BingBinding> {
  const binding = await prisma.siteBingBinding.findFirst({ where: { siteProfileId, accountId } });
  return binding === null
    ? EMPTY_BING_BINDING
    : {
        siteUrl: binding.siteUrl,
        verifiedAtSelection: binding.verifiedAtSelection,
      };
}

export function isEmptyBingBinding(binding: BingBinding): boolean {
  return binding.siteUrl === null;
}
