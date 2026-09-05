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
  await prisma.emailToken.deleteMany({ where: { accountId, kind } });
  await prisma.emailToken.create({
    data: {
      accountId,
      kind,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[kind]),
    },
  });
  return token;
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
