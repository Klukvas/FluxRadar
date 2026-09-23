// The database-backed half, on its own.
//
// It runs only the files that open a connection, and it refuses to start unless
// the guard in src/test-utils/test-database-url.ts accepted the configured
// address — asking for this suite is asking for a database, so "there is none"
// is an error here rather than the skip it is in the default run.

import { defineConfig } from 'vitest/config';

import { resolveTestDatabase } from './src/test-utils/test-database-url.ts';
import { databaseTestProject } from './vitest.shared.ts';

const database = resolveTestDatabase();
if (database.state !== 'ready') {
  throw new Error(`test:db needs a disposable API test database: ${database.reason}`);
}

export default defineConfig({ test: databaseTestProject() });
