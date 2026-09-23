// One lock, taken in one order, by everything that decides a scan's fate.
//
// PostgreSQL runs on READ COMMITTED, where every statement gets its own
// snapshot: reading a scan and then writing what that read implies is two
// decisions, not one, and anything that commits in between lands inside the
// gap. The Action Plan has three writers with exactly that shape — a finished
// generation, a re-run clearing the scan's plans, and retention deleting the
// scan — so each of them takes this lock on the scan row before it reads.
//
// Taking it FIRST is what keeps the three from deadlocking: retention writes
// the scan's child rows before the scan row, a completion writes a plan row
// after it, and without a common first lock those two orders are a cycle
// (PostgreSQL 40P01, one transaction aborted — and retention's transaction can
// be the whole of an account or profile deletion).

import { Prisma } from '@prisma/client';

/**
 * Locks the scan row for the rest of the transaction and reports whether it is
 * still there. PostgreSQL releases the lock on commit or rollback, so no path
 * can leak it.
 *
 * A caller that gets `false` must treat the scan as gone rather than carry on:
 * the row may have been deleted by the transaction this one just waited for.
 */
export async function lockScanRow(tx: Prisma.TransactionClient, scanId: string): Promise<boolean> {
  const locked = await tx.$queryRaw<
    readonly { readonly id: string }[]
  >`SELECT "id" FROM "Scan" WHERE "id" = ${scanId} FOR UPDATE`;
  return locked.length > 0;
}

/**
 * Locks several scan rows, always in id order.
 *
 * The order is the point. Two deletions whose id sets overlap would otherwise
 * be free to take the same two rows in opposite orders, which is a deadlock
 * between two retention transactions rather than between retention and a
 * generation. Rows that are already gone are simply not returned; the caller
 * deletes by id set either way.
 */
export async function lockScanRows(
  tx: Prisma.TransactionClient,
  scanIds: readonly string[],
): Promise<void> {
  if (scanIds.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "Scan" WHERE "id" IN (${Prisma.join([...scanIds])}) ORDER BY "id" FOR UPDATE`;
}
