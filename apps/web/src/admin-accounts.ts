// What the owner dashboard's Accounts list reads from GET /admin/accounts.
//
// Checked row by row before anything is drawn, for the same reason as
// admin-stats.ts: the workspace test mocks answer unknown paths with `null` or
// a scan-shaped object, and an unchecked payload would put "undefined" in a
// table — or crash every unrelated test that happens to render the dashboard.
// Anything that is not the documented shape is treated like the API's 404.

import { isListOf, isShape } from './admin-stats';
import { ApiRequestError, apiRequest } from './api';
import { isCount } from './module-metadata';

/** The API route, under the API origin. */
export const ADMIN_ACCOUNTS_PATH = '/admin/accounts';
export const ACCOUNTS_PAGE_SIZE = 50;

export interface AdminAccountRow {
  readonly email: string;
  readonly createdAt: string;
  readonly emailVerified: boolean;
  readonly freeCheckUsedAt: string | null;
  readonly scans: number;
  readonly purchases: number;
  readonly lastActivityAt: string;
}

export interface AdminAccounts {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly rows: readonly AdminAccountRow[];
}

export interface AdminAccountsRequest {
  /** 1-based. */
  readonly page: number;
  /** Part of an email address; empty asks for every account. */
  readonly query: string;
}

export type AdminAccountsResult =
  | { readonly kind: 'ready'; readonly accounts: AdminAccounts }
  /** 404, or an answer this screen cannot read: nothing to show and nothing to retry. */
  | { readonly kind: 'unavailable' }
  /** Network, session or server trouble: worth another try. */
  | { readonly kind: 'failed'; readonly message: string };

export function adminAccountsUrl(request: AdminAccountsRequest): string {
  const query = request.query.trim();
  const params = new URLSearchParams({
    page: String(request.page),
    ...(query === '' ? {} : { q: query }),
  });
  return `${ADMIN_ACCOUNTS_PATH}?${params.toString()}`;
}

export async function loadAdminAccounts(
  request: AdminAccountsRequest,
): Promise<AdminAccountsResult> {
  try {
    const accounts = readAdminAccounts(await apiRequest<unknown>(adminAccountsUrl(request)));
    return accounts === null ? { kind: 'unavailable' } : { kind: 'ready', accounts };
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 404) return { kind: 'unavailable' };
    return {
      kind: 'failed',
      message: caught instanceof Error ? caught.message : 'The accounts could not be loaded.',
    };
  }
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isAccountRow(value: unknown): value is AdminAccountRow {
  return (
    isShape(value) &&
    typeof value.email === 'string' &&
    isInstant(value.createdAt) &&
    typeof value.emailVerified === 'boolean' &&
    (value.freeCheckUsedAt === null || isInstant(value.freeCheckUsedAt)) &&
    isCount(value.scans) &&
    isCount(value.purchases) &&
    isInstant(value.lastActivityAt)
  );
}

/** One page of accounts, or null when the answer is not the shape this list draws. */
export function readAdminAccounts(value: unknown): AdminAccounts | null {
  if (!isShape(value)) return null;
  const { page, pageSize, total, rows } = value;
  if (!isCount(page) || page < 1 || !isCount(pageSize) || pageSize < 1 || !isCount(total)) {
    return null;
  }
  if (!isListOf(rows, isAccountRow)) return null;
  return {
    page,
    pageSize,
    total,
    rows: rows.map((row) => ({
      email: row.email,
      createdAt: row.createdAt,
      emailVerified: row.emailVerified,
      freeCheckUsedAt: row.freeCheckUsedAt,
      scans: row.scans,
      purchases: row.purchases,
      lastActivityAt: row.lastActivityAt,
    })),
  };
}
