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
/** Where the owner marks one account as a test account, or back. */
export const ADMIN_ACCOUNT_TEST_PATH = '/admin/accounts/test-account';
export const ACCOUNTS_PAGE_SIZE = 50;

export type TutorialStatus = 'pending' | 'completed' | 'skipped';

export interface AdminAccountRow {
  readonly email: string;
  readonly createdAt: string;
  readonly emailVerified: boolean;
  readonly freeCheckUsedAt: string | null;
  readonly scans: number;
  readonly purchases: number;
  readonly lastActivityAt: string;
  readonly tutorial: TutorialStatus;
  readonly testAccount: boolean;
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

function isTutorialStatus(value: unknown): value is TutorialStatus {
  return value === 'pending' || value === 'completed' || value === 'skipped';
}

/**
 * A row as it may arrive: `tutorial` and `testAccount` are optional so a web
 * build shipped ahead of the API, or an API rolled back, still draws the list —
 * the missing fields read as their defaults rather than vanishing with it.
 */
type AccountRowInput = Omit<AdminAccountRow, 'tutorial' | 'testAccount'> & {
  readonly tutorial?: TutorialStatus;
  readonly testAccount?: boolean;
};

function isAccountRow(value: unknown): value is AccountRowInput {
  return (
    isShape(value) &&
    typeof value.email === 'string' &&
    isInstant(value.createdAt) &&
    typeof value.emailVerified === 'boolean' &&
    (value.freeCheckUsedAt === null || isInstant(value.freeCheckUsedAt)) &&
    isCount(value.scans) &&
    isCount(value.purchases) &&
    isInstant(value.lastActivityAt) &&
    (value.tutorial === undefined || isTutorialStatus(value.tutorial)) &&
    (value.testAccount === undefined || typeof value.testAccount === 'boolean')
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
      tutorial: row.tutorial ?? 'pending',
      testAccount: row.testAccount ?? false,
    })),
  };
}

export type TestAccountResult =
  | { readonly kind: 'updated' }
  /** 404: the address is no longer in the tables, so nothing was marked. */
  | { readonly kind: 'unavailable' }
  /** Network, session or server trouble: the flag is not what the owner asked for. */
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Marks one account as a test account, or back. The address is the exact
 * spelling the list showed — the API refuses any other.
 */
export async function setTestAccount(
  email: string,
  testAccount: boolean,
): Promise<TestAccountResult> {
  try {
    await apiRequest<unknown>(ADMIN_ACCOUNT_TEST_PATH, {
      method: 'PATCH',
      body: JSON.stringify({ email, testAccount }),
    });
    return { kind: 'updated' };
  } catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 404) return { kind: 'unavailable' };
    return {
      kind: 'failed',
      message: caught instanceof Error ? caught.message : 'The account could not be updated.',
    };
  }
}
