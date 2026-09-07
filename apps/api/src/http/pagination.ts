// One page request, parsed and validated the same way by every list endpoint.
//
// The wire contract is offset/limit — that is what the existing clients send and
// what `meta` has always reported back. `page`/`pageSize` are accepted as the
// equivalent spelling because `meta.page` was already part of the response and a
// client that reads a page number back naturally sends one. The two spellings
// are alternatives, never a mixture: sending both an offset and a page is a
// caller bug that would silently serve the wrong rows, so it is rejected.
//
// A page is always deep-bounded. Offset paging makes the database walk and
// discard every skipped row, so an unbounded `offset` is a cheap way for an
// authenticated client to make PostgreSQL read an entire table per request.

import { z } from 'zod';

import { validationError } from './errors.ts';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
/**
 * How deep offset paging may go. Skipping rows is not free — the database walks
 * and discards every one of them — so this is the point past which a caller is
 * asking for a bulk read rather than a page, and should be filtering instead.
 */
export const MAX_PAGE_OFFSET = 10_000;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  offset: z.coerce.number().int().min(0).max(MAX_PAGE_OFFSET).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
  /** 1-based, derived from offset/limit so `meta.page` always agrees with them. */
  readonly page: number;
}

export interface PageMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly hasNext: boolean;
}

export interface PageDefaults {
  /**
   * Page size for a caller that asked for no page at all. It exists for lists
   * whose natural size is small and bounded per tenant — a site-profile picker
   * shows every profile a workspace has — where a 50-row default would silently
   * drop the tail for a client that predates paging. It never removes the cap:
   * MAX_PAGE_SIZE still bounds what one request can read.
   */
  readonly limit?: number;
}

/** Resolves the two accepted spellings into the single offset/limit the query runs with. */
export function pageRequestFrom(query: PageQuery, defaults: PageDefaults = {}): PageRequest {
  if (query.limit !== undefined && query.pageSize !== undefined && query.limit !== query.pageSize) {
    throw validationError('limit and pageSize disagree; send one of them');
  }
  if (query.offset !== undefined && query.page !== undefined) {
    throw validationError('offset and page are alternatives; send one of them');
  }
  const limit = query.limit ?? query.pageSize ?? defaults.limit ?? DEFAULT_PAGE_SIZE;
  const offset = query.offset ?? (query.page === undefined ? 0 : (query.page - 1) * limit);
  if (offset > MAX_PAGE_OFFSET) {
    throw validationError(`page offset exceeds the maximum of ${MAX_PAGE_OFFSET}`);
  }
  return { limit, offset, page: Math.floor(offset / limit) + 1 };
}

/**
 * `hasNext` is computed from what this page actually returned rather than from
 * `total` alone: the count and the page are two statements about a table that
 * can change between them, and a client paging forward must not be told there
 * is more when the page it just received was the last one.
 */
export function pageMetaFrom(request: PageRequest, returned: number, total: number): PageMeta {
  return {
    total,
    page: request.page,
    limit: request.limit,
    hasNext: returned > 0 && request.offset + returned < total,
  };
}
