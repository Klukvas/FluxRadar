// Prisma-backed persistence for the Google flow. Every query is scoped by
// accountId: a binding or a connection is never reachable across tenants.

import type { PrismaClient } from '@prisma/client';

import type { GoogleBinding } from './snapshot.ts';
import type { GoogleConnectionStore, StoredGoogleConnection } from './tokens.ts';

export function prismaGoogleConnectionStore(
  prisma: PrismaClient,
  now: () => Date,
): GoogleConnectionStore {
  return {
    async load(accountId: string): Promise<StoredGoogleConnection | null> {
      const connection = await prisma.integrationConnection.findUnique({
        where: { accountId_provider: { accountId, provider: 'google' } },
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
    async saveRefreshedAccessToken(accountId, accessTokenEncrypted, tokenExpiresAt) {
      await prisma.integrationConnection.updateMany({
        where: { accountId, provider: 'google' },
        data: { accessTokenEncrypted, tokenExpiresAt, lastCheckedAt: now(), lastError: null },
      });
    },
    async markNeedsReconnect(accountId, detail) {
      await prisma.integrationConnection.updateMany({
        where: { accountId, provider: 'google' },
        data: { status: 'needs_reconnect', lastError: detail, lastCheckedAt: now() },
      });
    },
  };
}

/**
 * The Google properties chosen for one site profile. Returns an empty binding
 * rather than null so callers report "no property selected" uniformly whether
 * the row is absent or only half filled in.
 */
export async function loadGoogleBinding(
  prisma: PrismaClient,
  accountId: string,
  siteProfileId: string,
): Promise<GoogleBinding> {
  const binding = await prisma.siteGoogleBinding.findFirst({
    where: { siteProfileId, accountId },
  });
  return {
    searchConsoleSiteUrl: binding?.searchConsoleSiteUrl ?? null,
    ga4PropertyId: binding?.ga4PropertyId ?? null,
    ga4PropertyName: binding?.ga4PropertyName ?? null,
  };
}

export function isEmptyBinding(binding: GoogleBinding): boolean {
  return binding.searchConsoleSiteUrl === null && binding.ga4PropertyId === null;
}
