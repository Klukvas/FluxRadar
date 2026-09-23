import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { API_PACKAGE_ROOT, PRISMA_SCHEMA_PATH } from './template-db.ts';
import { resolveTestDatabase } from './test-database-url.ts';

/**
 * Vitest global setup.
 *
 * It applies the checked-in migrations, which is a write, so it asks the guard
 * first and does nothing at all when no database was configured — a run without
 * one is an ordinary run in which the DB-backed files skip themselves (see
 * `describeDb` in test-db.ts). A database that WAS configured and refused is the
 * other case entirely: that is a mistake pointing at a real server, and the run
 * fails here rather than discovering it one TRUNCATE later.
 */
export default function setup(): void {
  const resolution = resolveTestDatabase();
  if (resolution.state === 'refused') {
    throw new Error(`Refusing to migrate a database for API tests: ${resolution.reason}`);
  }
  if (resolution.state === 'absent') {
    // The one line that explains an otherwise silent skip.
    console.warn(`[api tests] database-backed suites skipped: ${resolution.reason}`);
    return;
  }
  const prismaBin = join(API_PACKAGE_ROOT, 'node_modules', '.bin', 'prisma');
  execFileSync(prismaBin, ['migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH], {
    cwd: API_PACKAGE_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: resolution.url,
      RUST_LOG: 'info',
    },
    stdio: 'pipe',
  });
}
