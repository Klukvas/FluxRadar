// Every table the merged schema owns is truncated between database-backed test
// files.
//
// This is the one integration seam that fails SILENTLY. Four lanes each added
// tables — checkpoints and crawl evidence, Action Plans and their spend log,
// coverage proofs, Bing bindings and refund dispatches — and each added its own
// name to the TRUNCATE in test-db.ts. A name left out does not break anything
// visible: the rows simply survive into the next file, where they show up as a
// test that passes alone and fails in a full run, or worse, the other way
// round. So the list is checked against the schema rather than against itself.
//
// `_prisma_migrations` is Prisma's own bookkeeping and is deliberately not
// truncated: global setup applies the migrations once for the whole run.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TRUNCATED_TABLES } from './truncated-tables.ts';

const SCHEMA_PATH = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));

/** Tables that exist in the database but are not test state. */
const NOT_TEST_STATE = new Set(['_prisma_migrations']);

/** The list as plain strings: the tuple's literal type is not the question here. */
const TRUNCATED: readonly string[] = TRUNCATED_TABLES;

/** The models the Prisma schema declares, which is one table each. */
function schemaModels(): readonly string[] {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  return [...schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((match) => match[1] ?? '');
}

describe('the disposable database is left empty for the next test file', () => {
  it('truncates every model the schema declares', () => {
    const missing = schemaModels().filter(
      (model) => !NOT_TEST_STATE.has(model) && !TRUNCATED.includes(model),
    );
    expect(missing).toEqual([]);
  });

  it('names no table the schema does not have', () => {
    const models = new Set(schemaModels());
    expect(TRUNCATED.filter((table) => !models.has(table))).toEqual([]);
  });

  it('names each table once', () => {
    expect([...new Set(TRUNCATED)]).toHaveLength(TRUNCATED.length);
  });
});
