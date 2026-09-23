import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export {
  TEST_DATABASE_ACK_ENV,
  TEST_DATABASE_NAME_CONVENTION,
  TEST_DATABASE_URL_ENV,
  isTestDatabaseReady,
  resolveTestDatabase,
  testDatabaseSkipReason,
} from './test-database-url.ts';

import { requireTestDatabaseUrl } from './test-database-url.ts';

/** apps/api package root (src/test-utils -> apps/api). */
export const API_PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The disposable PostgreSQL database the API integration tests may erase.
 *
 * It is resolved through the guard in test-database-url.ts on EVERY call rather
 * than cached, so a destructive step can never reuse an address that was valid
 * when the module loaded. Throws unless the guard accepted it.
 */
export function testDatabaseUrl(): string {
  return requireTestDatabaseUrl();
}

export const PRISMA_SCHEMA_PATH = join(API_PACKAGE_ROOT, 'prisma', 'schema.prisma');
