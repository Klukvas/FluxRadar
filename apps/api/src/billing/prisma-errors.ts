import { Prisma } from '@prisma/client';

/**
 * True when the error is a Prisma P2002 unique-constraint violation whose
 * target mentions the given field. JSON serialization keeps this compatible
 * with Prisma's provider-specific target representation.
 */
export function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  return JSON.stringify(target ?? '').includes(field);
}

// During the expand phase the legacy paddle* unique indexes still exist beside
// the provider-neutral ones, and a database trigger fills both columns. A
// duplicate event or order can therefore be reported against either index, and
// which one PostgreSQL names first is not something the handlers may depend on.
// These two helpers ask the only question the handlers actually have: "is this a
// redelivery?" — never "which index noticed".

/** A webhook event id that has already been stored, under either index. */
export function isDuplicateEventId(error: unknown): boolean {
  return isUniqueViolation(error, 'providerEventId') || isUniqueViolation(error, 'paddleEventId');
}

/** A transaction/order id that already has a purchase, under either index. */
export function isDuplicateTransactionId(error: unknown): boolean {
  return (
    isUniqueViolation(error, 'providerTransactionId') ||
    isUniqueViolation(error, 'paddleTransactionId')
  );
}
