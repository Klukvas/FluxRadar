import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { API_PACKAGE_ROOT, TEMPLATE_DB_PATH } from './template-db.ts';

/**
 * Vitest global setup: build the template SQLite database once via
 * `prisma db push`. Test files copy this template into their own tmp file
 * (see test-db.ts), so every test file gets an isolated database.
 */
export default function setup(): void {
  // Deleting the file first makes push idempotent without --force-reset
  // (which trips the Prisma CLI consent gate when run from an AI agent).
  rmSync(TEMPLATE_DB_PATH, { force: true });
  const prismaBin = join(API_PACKAGE_ROOT, 'node_modules', '.bin', 'prisma');
  execFileSync(prismaBin, ['db', 'push', '--skip-generate'], {
    cwd: API_PACKAGE_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: `file:${TEMPLATE_DB_PATH}`,
      // Prisma 6.19 CLI on Node 24 fails with an empty "Schema engine error"
      // unless the engine logs at info level or lower — an inherited
      // RUST_LOG=warn (or none) reproducibly breaks db push, so force info.
      RUST_LOG: 'info',
    },
    stdio: 'pipe',
  });
}
