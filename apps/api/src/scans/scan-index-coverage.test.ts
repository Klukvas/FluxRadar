import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

// The indexes the list, queue and profile-guard queries depend on, asserted
// against the database the checked-in migrations actually produce — not against
// the Prisma schema, which is the thing that could disagree with them.
//
// An index is invisible: dropping one of these breaks nothing that a functional
// test can see, it only makes the query read the whole table. This suite is what
// notices.

const REQUIRED_INDEXES: readonly (readonly [string, readonly string[]])[] = [
  ['Scan', ['accountId', 'createdAt', 'id']],
  ['Scan', ['accountId', 'siteProfileId', 'createdAt', 'id']],
  ['Scan', ['accountId', 'plan']],
  ['Scan', ['accountId', 'status']],
  ['Scan', ['siteProfileId']],
  ['Purchase', ['siteProfileId']],
  ['CheckoutSession', ['siteProfileId', 'status']],
  ['Job', ['status', 'createdAt', 'id']],
];

interface IndexRow {
  readonly indexdef: string;
}

describe('scan history and queue index coverage', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it.each(REQUIRED_INDEXES)('indexes %s(%s)', async (table, columns) => {
    const rows = await db.prisma.$queryRawUnsafe<IndexRow[]>(
      'SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1',
      table,
    );

    expect(rows.map((row) => indexedColumns(row.indexdef))).toContainEqual([...columns]);
  });

  // The queue claim orders by (createdAt, id) within one status; the history
  // list orders by (createdAt, id) within one account. Both read the index
  // backwards or forwards, so a plain b-tree serves them — what must not happen
  // is a sequential scan.
  it('answers the oldest-pending-job lookup from the queue index', async () => {
    const plan = await explain(
      db,
      `SELECT * FROM "Job" WHERE "status" = 'Pending' ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`,
    );

    expect(plan).toContain('Job_status_createdAt_id_idx');
  });

  it('answers a scan history page from the account history index', async () => {
    const plan = await explain(
      db,
      `SELECT * FROM "Scan" WHERE "accountId" = 'probe' ORDER BY "createdAt" DESC, "id" DESC LIMIT 50`,
    );

    expect(plan).toContain('Scan_accountId_createdAt_id_idx');
  });
});

/**
 * The column list of an index definition, quoting removed. PostgreSQL quotes
 * only the identifiers that need it — "accountId" but plain id — so the raw
 * text cannot be compared against a uniformly quoted expectation.
 */
function indexedColumns(definition: string): readonly string[] {
  const columns = /USING btree \((?<columns>[^)]*)\)/u.exec(definition)?.groups?.['columns'];
  if (columns === undefined) return [];
  return columns.split(',').map((column) => column.trim().replaceAll('"', ''));
}

/**
 * Plans the statement with every alternative to an ordered index scan
 * disabled. On a near-empty test table the planner's choice is a coin flip on
 * cost estimates — a sequential scan plus a sort, or another index plus a
 * sort, is as cheap as the right index — so the question this can answer is
 * not "is the index used at this size" but "is there an index that CAN answer
 * this shape, filter and order, at all" — which is exactly the regression
 * worth catching.
 *
 * SET LOCAL lasts only until the end of the transaction and is a silent no-op
 * outside one, so the settings and the EXPLAIN must share one interactive
 * transaction (and with it one pooled connection).
 */
async function explain(db: TestDb, statement: string): Promise<string> {
  const rows = await db.prisma.$transaction(async (tx) => {
    for (const setting of PLANNER_ALTERNATIVES_TO_AN_ORDERED_INDEX) {
      await tx.$executeRawUnsafe(`SET LOCAL ${setting} = off`);
    }
    return tx.$queryRawUnsafe<Record<string, string>[]>(`EXPLAIN ${statement}`);
  });
  return rows.map((row) => Object.values(row).join(' ')).join('\n');
}

const PLANNER_ALTERNATIVES_TO_AN_ORDERED_INDEX = [
  'enable_seqscan',
  'enable_bitmapscan',
  'enable_sort',
  'enable_incremental_sort',
] as const;
