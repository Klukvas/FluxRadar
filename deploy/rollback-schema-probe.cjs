// Rollback compatibility probe — schema surface.
//
// Runs INSIDE the container of the release we would roll back to, immediately
// after `prisma migrate deploy` and before any traffic is switched. It is copied
// in from the release being deployed, but every module it loads belongs to the
// OLD image: its `@prisma/client`, its generated client, its datamodel. That is
// the whole point — the question is not "does the new code work" but "can the
// previous release still read and write the schema the migration just produced".
//
// `/health/ready` cannot answer that. It runs `SELECT 1`, which succeeds against
// any reachable database, including one whose columns the old Prisma client no
// longer finds. This probe issues one `findFirst` per model instead. Prisma
// enumerates every scalar column it knows about in that SELECT, so a column that
// a contract-phase migration renamed or dropped, or a table that disappeared,
// fails here with the old client's own error — before the deploy can make that
// rollback target unusable.
//
// Read-only by construction: `findFirst` with `take: 1` and no filter. It never
// writes, and it is bounded by a timeout so an unresponsive database fails the
// gate instead of hanging the deploy.
//
// CommonJS on purpose: it is executed with a bare `node <file>` inside an image
// whose package.json declares `"type": "module"`.

const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// The API image's workspace root. Overridable so the same script can be run
// against a checkout (that is how it is covered by a test) instead of an image.
const APP_DIR = process.env.FLUXRADAR_PROBE_APP_DIR || '/app';
/** Both are tried, the API package first: pnpm hoists nothing by default. */
const RESOLUTION_ROOTS = [path.join(APP_DIR, 'apps', 'api'), APP_DIR];
const SCHEMA_PATH = path.join(APP_DIR, 'apps', 'api', 'prisma', 'schema.prisma');
const QUERY_TIMEOUT_MS = 20_000;

function loadPrismaModule() {
  const require_ = createRequire(path.join(RESOLUTION_ROOTS[0], 'noop.cjs'));
  const resolved = require_.resolve('@prisma/client', { paths: RESOLUTION_ROOTS });
  return require_(resolved);
}

/**
 * Model names the old client was generated from. The datamodel that ships with
 * the generated client is authoritative; the schema file next to it is the
 * fallback for a client whose DMMF is not exposed. Returning an empty list is
 * never treated as success — see main().
 */
function modelNames(prismaModule) {
  const models = prismaModule?.Prisma?.dmmf?.datamodel?.models;
  if (Array.isArray(models) && models.length > 0) {
    return models.map((model) => model.name);
  }
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  return [...schema.matchAll(/^\s*model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((match) => match[1]);
}

/** Prisma exposes `model Foo` as `client.foo`; only the first letter changes. */
function delegateFor(client, modelName) {
  const candidates = [modelName[0].toLowerCase() + modelName.slice(1), modelName];
  for (const candidate of candidates) {
    const delegate = client[candidate];
    if (delegate && typeof delegate.findFirst === 'function') {
      return delegate;
    }
  }
  return null;
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${QUERY_TIMEOUT_MS}ms`)),
      QUERY_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const prismaModule = loadPrismaModule();
  const names = modelNames(prismaModule);
  if (names.length === 0) {
    throw new Error(
      'could not determine the previous release’s models from its Prisma client or schema; ' +
        'rollback compatibility cannot be proven',
    );
  }

  const client = new prismaModule.PrismaClient();
  const failures = [];
  let checked = 0;
  try {
    for (const name of names) {
      const delegate = delegateFor(client, name);
      if (delegate === null) {
        // A model the datamodel declares but the client does not expose means the
        // two disagree; that is a broken image, not a schema verdict.
        failures.push(`${name}: the previous release exposes no Prisma delegate for this model`);
        continue;
      }
      try {
        // Selects every scalar column this client knows about, one row at most.
        await withTimeout(delegate.findFirst({ take: 1 }));
        checked += 1;
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await client.$disconnect().catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(
      `schema-surface probe FAILED: ${failures.length} of ${names.length} model(s) are ` +
        'unreadable by the previous release:',
    );
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`schema-surface probe OK: ${checked} model(s) readable by the previous release`);
}

main().catch((error) => {
  console.error(
    `schema-surface probe could not run: ${error instanceof Error ? error.stack : String(error)}`,
  );
  // Unable to verify is not the same as verified. Fail closed.
  process.exitCode = 1;
});
