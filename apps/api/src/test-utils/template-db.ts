import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** apps/api package root (src/test-utils -> apps/api). */
export const API_PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * SQLite file created once per test run by the vitest global setup
 * (`prisma db push`); each test file copies it instead of pushing the schema
 * again. Lives under prisma/ and is covered by the *.db gitignore rule.
 */
export const TEMPLATE_DB_PATH = join(API_PACKAGE_ROOT, 'prisma', '.test-template.db');
