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
