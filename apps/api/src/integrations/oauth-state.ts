import type { PrismaClient } from '@prisma/client';

import type { UserIntegrationProvider } from './config.ts';

export const EXPIRED_OAUTH_STATE_PURGE_LIMIT = 100;

export interface OAuthStateClaimOptions {
  /** Test seam that makes the race deterministic after both readers observed the row. */
  readonly afterRead?: () => Promise<void>;
}

/**
 * Claims a callback state exactly once. Reading it first is only to retain the
 * account id; the conditional update is the authority when two callbacks race.
 */
export async function claimOAuthState(
  prisma: PrismaClient,
  stateHash: string,
  provider: UserIntegrationProvider,
  now: Date,
  options: OAuthStateClaimOptions = {},
): Promise<{ readonly accountId: string } | null> {
  const state = await prisma.integrationOAuthState.findUnique({
    where: { stateHash },
    select: { id: true, accountId: true },
  });
  if (state === null) return null;
  await options.afterRead?.();

  const claimed = await prisma.integrationOAuthState.updateMany({
    where: { id: state.id, provider, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  return claimed.count === 1 ? { accountId: state.accountId } : null;
}

/** Deletes a small oldest-first batch; a login click must never run an unbounded cleanup. */
export async function purgeExpiredOAuthStates(prisma: PrismaClient, now: Date): Promise<void> {
  const expired = await prisma.integrationOAuthState.findMany({
    where: { expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: EXPIRED_OAUTH_STATE_PURGE_LIMIT,
    select: { id: true },
  });
  if (expired.length === 0) return;
  await prisma.integrationOAuthState.deleteMany({
    where: { id: { in: expired.map(({ id }) => id) } },
  });
}
