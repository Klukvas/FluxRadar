// Rollback compatibility probe — boot surface, without booting.
//
// The deploy has to know whether the release it would roll back to can still
// start against the schema and the environment file this deploy just produced.
// It used to answer that by starting the previous image with its ordinary
// production command and waiting for `/health/ready`.
//
// That answer cost too much. The production entrypoint is a full API instance:
// it sweeps data retention on startup (deleting expired scans, reports and
// webhook rows), recovers and CLAIMS queued scan jobs, drains the queue — real
// crawls, real AI calls, real customer email — and sweeps pending refunds. All
// of it from a container the deploy removes again seconds later, and all of it
// against the live database, while the release being deployed is doing the same
// work. A verification step must not be able to change what it verifies.
//
// So the probe container is now started with an inert command (see the deploy
// workflow) and this script is executed inside it instead. It re-asks the two
// questions the readiness probe actually answered, and nothing else:
//
//   1. Does the previous release still ACCEPT this environment file? Its own
//      boot-time validators are called — the same functions that would abort its
//      startup — so a variable it requires and the new release does not is
//      caught here rather than during an emergency rollback.
//   2. Can it REACH the database with those credentials? One `SELECT 1`, inside
//      an explicitly read-only transaction.
//
// Read-only is enforced, not just intended: every statement runs inside a
// transaction that PostgreSQL itself marks READ ONLY, and the probe verifies
// that mark before it issues anything. The schema surface — which columns the
// old client can still select — is the separate concern of
// rollback-schema-probe.cjs, which runs next in the same container.
//
// CommonJS on purpose: it is executed with a bare `node <file>` inside an image
// whose package.json declares `"type": "module"`.

const { createRequire } = require('node:module');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** The API image's workspace root; overridable so a test can run this on a checkout. */
const APP_DIR = process.env.FLUXRADAR_PROBE_APP_DIR || '/app';
const RESOLUTION_ROOTS = [path.join(APP_DIR, 'apps', 'api'), APP_DIR];
const DIST_DIR = path.join(APP_DIR, 'apps', 'api', 'dist');
const QUERY_TIMEOUT_MS = 20_000;

/**
 * The previous release's own boot-time validators.
 *
 * Each entry is a module of the OLD image and an exported function that throws
 * when the environment is not one that release can start with. They are called
 * for their exceptions only; none of them touches the database, writes anything,
 * or starts a timer.
 *
 * A module that is absent is not a failure: releases differ, and demanding a
 * file layout that an older image never had would block deploys for a reason
 * that has nothing to do with rollback safety. A module that IS present and
 * throws is a failure, and so is finding none of them at all (see main).
 */
const BOOT_VALIDATORS = [
  {
    module: 'integrations/config.js',
    exportName: 'validateRuntimeConfig',
    describes: 'required production secrets and half-configured integrations',
  },
  {
    module: 'billing/fastspring/config.js',
    exportName: 'readFastSpringConfig',
    describes: 'the FastSpring variable set',
    // readFastSpringConfig reports rather than throws; "invalid" is the state
    // that makes the old release refuse to serve checkout.
    check: (result) => {
      if (result?.state === 'invalid') {
        throw new Error(
          `FastSpring configuration is incomplete for this release: missing ${
            Array.isArray(result.missing) ? result.missing.join(', ') : 'unknown variables'
          }`,
        );
      }
    },
  },
];

function loadPrismaModule() {
  const require_ = createRequire(path.join(RESOLUTION_ROOTS[0], 'noop.cjs'));
  const resolved = require_.resolve('@prisma/client', { paths: RESOLUTION_ROOTS });
  return require_(resolved);
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${QUERY_TIMEOUT_MS}ms`)),
      QUERY_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs the old release's boot validators; returns what ran and what failed. */
async function runBootValidators() {
  const ran = [];
  const failures = [];
  const skipped = [];
  for (const validator of BOOT_VALIDATORS) {
    const modulePath = path.join(DIST_DIR, validator.module);
    if (!existsSync(modulePath)) {
      skipped.push(`${validator.module} (not present in this release)`);
      continue;
    }
    let loaded;
    try {
      loaded = await import(pathToFileURL(modulePath).href);
    } catch (error) {
      failures.push(
        `${validator.module}: could not be loaded (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    const target = loaded[validator.exportName];
    if (typeof target !== 'function') {
      skipped.push(`${validator.module}#${validator.exportName} (not exported by this release)`);
      continue;
    }
    try {
      const result = target();
      if (validator.check !== undefined) validator.check(result);
      ran.push(`${validator.exportName} — ${validator.describes}`);
    } catch (error) {
      failures.push(
        `${validator.exportName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { ran, failures, skipped };
}

/**
 * Proves the database is reachable with the environment this deploy produced,
 * from inside a transaction PostgreSQL will not let write.
 */
async function checkDatabaseReadable(prismaModule) {
  const client = new prismaModule.PrismaClient();
  try {
    await withTimeout(
      client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const [mode] = await tx.$queryRawUnsafe('SHOW transaction_read_only');
        const readOnly = mode?.transaction_read_only ?? mode?.['transaction_read_only'];
        if (readOnly !== 'on') {
          throw new Error(
            'the probe transaction is not READ ONLY; refusing to query the production database',
          );
        }
        await tx.$queryRawUnsafe('SELECT 1');
      }),
      'database readiness check',
    );
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

async function main() {
  const prismaModule = loadPrismaModule();
  const validators = await runBootValidators();
  for (const skipped of validators.skipped) {
    console.log(`boot-surface probe: skipped ${skipped}`);
  }
  if (validators.failures.length > 0) {
    console.error(
      `boot-surface probe FAILED: the previous release would not start with this environment:`,
    );
    for (const failure of validators.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  if (validators.ran.length === 0) {
    // Unable to verify is not the same as verified: with no validator found, the
    // environment half of this gate proved nothing at all.
    throw new Error(
      'no boot-time validator of the previous release could be run; its startup requirements ' +
        'cannot be proven against this environment file',
    );
  }

  await checkDatabaseReadable(prismaModule);

  for (const ran of validators.ran) console.log(`boot-surface probe: validated ${ran}`);
  console.log(
    `boot-surface probe OK: the previous release accepts this environment and can read the ` +
      `database (${validators.ran.length} validator(s), read-only transaction)`,
  );
}

main().catch((error) => {
  console.error(
    `boot-surface probe could not run: ${error instanceof Error ? error.stack : String(error)}`,
  );
  // Unable to verify is not the same as verified. Fail closed.
  process.exitCode = 1;
});
