// Сессии: opaque token в httpOnly-куке, в БД — только SHA-256 токена
// (утечка таблицы Session не даёт готовых кук). TTL 7 дней, скользящего
// продления в v0.1 нет.

import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const SESSION_COOKIE_NAME = 'fluxradar_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface CreatedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

export async function createSession(
  prisma: PrismaClient,
  accountId: string,
  now: Date,
): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { accountId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, expiresAt };
}

/** null — кука отсутствует/невалидна/просрочена; различие наружу не отдаём. */
export async function findSessionAccountId(
  prisma: PrismaClient,
  token: string,
  now: Date,
): Promise<string | null> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (session === null || session.expiresAt.getTime() <= now.getTime()) {
    return null;
  }
  return session.accountId;
}

export async function deleteSessionByToken(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
