import { PrismaClient } from '@prisma/client';

/** PrismaClient factory. The URL defaults to DATABASE_URL from the environment. */
export function createPrismaClient(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }
  return new PrismaClient({ datasourceUrl: url });
}

export type { PrismaClient };
