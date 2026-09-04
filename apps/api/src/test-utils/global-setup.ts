import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { API_PACKAGE_ROOT, PRISMA_SCHEMA_PATH, testDatabaseUrl } from './template-db.ts';

/**
 * Vitest global setup: apply checked-in PostgreSQL migrations once. Test files
 * truncate the disposable database before use (see test-db.ts).
 */
export default function setup(): void {
  const prismaBin = join(API_PACKAGE_ROOT, 'node_modules', '.bin', 'prisma');
  execFileSync(prismaBin, ['migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH], {
    cwd: API_PACKAGE_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl(),
      RUST_LOG: 'info',
    },
    stdio: 'pipe',
  });
}
