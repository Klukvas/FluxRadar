import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient factory. The url defaults to DATABASE_URL from the environment;
 * tests pass their own per-file tmp SQLite url instead (T-06 test isolation).
 *
 * connection_limit=1 is enforced for SQLite: Prisma's default pool opens several
 * connections and concurrent writes then fail with SQLITE_BUSY. A single
 * connection serializes writes, which is exactly what the atomic CAS transitions
 * and the webhook dedup transaction rely on (D-011).
 */
export function createPrismaClient(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }
  return new PrismaClient({ datasourceUrl: withConnectionLimit(url) });
}

function withConnectionLimit(url: string): string {
  if (!url.startsWith('file:') || url.includes('connection_limit=')) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=1`;
}

export type { PrismaClient };
