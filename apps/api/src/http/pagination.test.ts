import { describe, expect, it } from 'vitest';

import { ApiError } from './errors.ts';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_OFFSET,
  pageMetaFrom,
  pageQuerySchema,
  pageRequestFrom,
} from './pagination.ts';

function parse(query: Record<string, string>) {
  return pageRequestFrom(pageQuerySchema.parse(query));
}

describe('page request', () => {
  it('defaults to the first page when nothing is asked for', () => {
    expect(pageRequestFrom({})).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0, page: 1 });
  });

  it('reads the offset/limit spelling', () => {
    expect(parse({ limit: '10', offset: '30' })).toEqual({ limit: 10, offset: 30, page: 4 });
  });

  it('reads the page/pageSize spelling as the same request', () => {
    expect(parse({ pageSize: '10', page: '4' })).toEqual(parse({ limit: '10', offset: '30' }));
  });

  // meta.page has always been part of the response; a client that sends it back
  // must get the rows it names, not silently the first page.
  it('derives the page number from the offset it will actually run with', () => {
    expect(parse({ limit: '25', offset: '50' }).page).toBe(3);
  });

  it('rejects a mixture of the two spellings rather than guessing', () => {
    expect(() => parse({ offset: '10', page: '3' })).toThrow(ApiError);
    expect(() => parse({ limit: '10', pageSize: '20' })).toThrow(ApiError);
  });

  it('accepts limit and pageSize when they agree', () => {
    expect(parse({ limit: '10', pageSize: '10' }).limit).toBe(10);
  });

  it.each([
    ['a page size above the cap', { limit: '101' }],
    ['a zero page size', { limit: '0' }],
    ['a negative offset', { offset: '-1' }],
    ['a fractional page size', { limit: '2.5' }],
    ['a non-numeric page size', { limit: 'all' }],
    ['a page below one', { page: '0' }],
  ])('rejects %s', (_case, query) => {
    expect(() => parse(query as Record<string, string>)).toThrow();
  });

  // Offset paging makes PostgreSQL walk and discard every skipped row, so an
  // unbounded offset is a cheap way to make one request read a whole table.
  it('refuses to page deeper than the offset cap', () => {
    expect(() => parse({ offset: String(MAX_PAGE_OFFSET + 1) })).toThrow();
    expect(() => parse({ limit: '100', page: '100000' })).toThrow(ApiError);
  });

  it('answers a rate-limit-free 400 for a bad page request', () => {
    try {
      parse({ offset: '10', page: '3' });
      expect.unreachable('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).code).toBe('VALIDATION');
    }
  });
});

describe('page meta', () => {
  it('reports another page while rows remain', () => {
    expect(pageMetaFrom({ limit: 10, offset: 0, page: 1 }, 10, 25)).toEqual({
      total: 25,
      page: 1,
      limit: 10,
      hasNext: true,
    });
  });

  it('closes the sequence on the last page', () => {
    expect(pageMetaFrom({ limit: 10, offset: 20, page: 3 }, 5, 25).hasNext).toBe(false);
  });

  // total and the page are two statements about a table that can change between
  // them; an empty page must end the sequence rather than send the client on.
  it('does not promise more after an empty page', () => {
    expect(pageMetaFrom({ limit: 10, offset: 90, page: 10 }, 0, 25).hasNext).toBe(false);
  });
});
