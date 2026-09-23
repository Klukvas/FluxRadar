// Which API test files need the disposable PostgreSQL database, and which do not.
//
// The split is derived from the sources rather than maintained by hand: a file
// needs a database exactly when it imports the harness that creates one. A list
// written out here would drift the first time a suite gained or dropped that
// import, and the cost of drifting is a "pure unit" run that quietly opens a
// connection — which is the thing the split exists to prevent.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url));

const SOURCE_ROOT = join(API_PACKAGE_ROOT, 'src');

/** The import that means "this file will connect to, and truncate, a database". */
const DATABASE_HARNESS_IMPORT = 'test-utils/test-db.ts';
const DATABASE_HARNESS_IMPORT_LOCAL = './test-db.ts';

function testFilesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFilesUnder(path);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function needsDatabase(path: string): boolean {
  const source = readFileSync(path, 'utf8');
  return (
    source.includes(DATABASE_HARNESS_IMPORT) ||
    (path.includes(`${sep}test-utils${sep}`) && source.includes(DATABASE_HARNESS_IMPORT_LOCAL))
  );
}

function asPosix(path: string): string {
  return relative(API_PACKAGE_ROOT, path).split(sep).join('/');
}

/** Test files that will open a database connection, as paths relative to apps/api. */
export function databaseBackedTestFiles(): readonly string[] {
  return testFilesUnder(SOURCE_ROOT).filter(needsDatabase).map(asPosix).sort();
}

const NON_TEST_EXCLUDES = ['**/node_modules/**', '**/dist/**'] as const;

/**
 * The pure unit half: every test file that does not open a database, with the
 * network stubbed out (src/test-utils/unit-env.ts) and no global setup at all.
 *
 * Both are structural rather than trusted. A file that gains a `createTestDb`
 * import leaves this project by itself, and a client whose fake transport was
 * forgotten fails on the first request instead of reaching a live provider.
 */
export function unitTestProject() {
  return {
    name: 'unit',
    exclude: [...databaseBackedTestFiles(), ...NON_TEST_EXCLUDES],
    setupFiles: ['./src/test-utils/test-env.ts', './src/test-utils/unit-env.ts'],
  } as const;
}

/**
 * The database-backed half: only the files that open a connection, run one at a
 * time because they truncate one shared disposable database.
 *
 * The network is NOT stubbed here: these suites crawl a loopback fixture site
 * over real HTTP, which is the behaviour under test.
 */
export function databaseTestProject() {
  return {
    name: 'db',
    include: [...databaseBackedTestFiles()],
    exclude: [...NON_TEST_EXCLUDES],
    fileParallelism: false,
    globalSetup: ['./src/test-utils/global-setup.ts'],
    setupFiles: ['./src/test-utils/test-env.ts'],
  } as const;
}
