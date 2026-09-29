import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const EMAIL_TOKEN_TTL_MS = {
  verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
} as const;
export const EMAIL_TOKEN_MAX_ATTEMPTS = 5;

export type EmailTokenKind = keyof typeof EMAIL_TOKEN_TTL_MS;

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function issueEmailToken(
  prisma: PrismaClient,
  accountId: string,
  kind: EmailTokenKind,
  now: Date,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction(async (tx) => {
    // The account row is the shared lock for every token kind. Deleting a prior
    // link and creating its replacement must be one serial operation: two
    // concurrent resend requests otherwise both delete first and leave two
    // valid reset links behind.
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    await tx.emailToken.deleteMany({ where: { accountId, kind } });
    await tx.emailToken.create({
      data: {
        accountId,
        kind,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[kind]),
      },
    });
  });
  return token;
}

/**
 * Revokes every unused reset link while holding the same account lock issuance
 * uses. A reset that succeeded is a security boundary, so an older parallel
 * reset request cannot remain usable afterwards.
 */
export async function resetPasswordAndRevokeTokens(
  prisma: PrismaClient,
  accountId: string,
  passwordHash: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
    await tx.account.update({ where: { id: accountId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { accountId } });
    await tx.emailToken.deleteMany({
      where: { accountId, kind: 'password_reset', usedAt: null },
    });
  });
}

export async function consumeEmailToken(
  prisma: PrismaClient,
  token: string,
  kind: EmailTokenKind,
  now: Date,
): Promise<{ readonly accountId: string } | null> {
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (
    row === null ||
    row.kind !== kind ||
    row.usedAt !== null ||
    row.expiresAt.getTime() <= now.getTime() ||
    row.attempts >= EMAIL_TOKEN_MAX_ATTEMPTS
  ) {
    await recordEmailTokenAttempt(prisma, token, kind);
    return null;
  }
  const claimed = await prisma.emailToken.updateMany({
    where: {
      id: row.id,
      usedAt: null,
      attempts: { lt: EMAIL_TOKEN_MAX_ATTEMPTS },
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  if (claimed.count === 1) return { accountId: row.accountId };
  await recordEmailTokenAttempt(prisma, token, kind);
  return null;
}

/** Records a failed attempt without revealing whether a token exists. */
export async function recordEmailTokenAttempt(
  prisma: PrismaClient,
  token: string,
  kind: EmailTokenKind,
): Promise<void> {
  await prisma.emailToken.updateMany({
    where: {
      tokenHash: hashToken(token),
      kind,
      usedAt: null,
      attempts: { lt: EMAIL_TOKEN_MAX_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  });
}
