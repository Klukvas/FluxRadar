import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** apps/api package root (src/test-utils -> apps/api). */
export const API_PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Shared, disposable PostgreSQL database used by the API integration tests. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required to run API tests');
  }
  return url;
}

export const PRISMA_SCHEMA_PATH = join(API_PACKAGE_ROOT, 'prisma', 'schema.prisma');
