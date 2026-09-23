// The default run: two projects, because the two halves of this suite need
// opposite environments.
//
//   unit — every file that does not open a database. No global setup, and no
//          `fetch`: a client whose fake transport was forgotten fails loudly
//          instead of reaching a billable provider (src/test-utils/unit-env.ts).
//   db   — the files that do, one at a time, against the one disposable database
//          the guard accepted. Present only when such a database is configured.
//
// A configured-but-refused address does not reduce the run silently: it fails it
// here, before anything is migrated. A run with no database configured keeps the
// unit project and announces what it is not covering.
//
// `pnpm --filter @fluxradar/api test:unit` and `test:db` run one half each; see
// vitest.unit.config.ts and vitest.db.config.ts.

import { defineConfig } from 'vitest/config';

import {
  assertNoRefusedTestDatabase,
  resolveTestDatabase,
} from './src/test-utils/test-database-url.ts';
import { databaseBackedTestFiles, databaseTestProject, unitTestProject } from './vitest.shared.ts';

assertNoRefusedTestDatabase();

const database = resolveTestDatabase();
const hasDatabase = database.state === 'ready';

if (!hasDatabase) {
  // The run has to say what it is not covering.
  console.warn(
    `[api tests] ${databaseBackedTestFiles().length} database-backed test files excluded: ` +
      `${database.state === 'absent' ? database.reason : 'no usable database'}`,
  );
}

export default defineConfig({
  test: {
    projects: [
      { test: unitTestProject() },
      ...(hasDatabase ? [{ test: databaseTestProject() }] : []),
    ],
  },
});
