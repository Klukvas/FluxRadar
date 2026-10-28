// The Accounts list under the owner dashboard's numbers: who signed up, and
// what each account has done since.
//
// English only, like the rest of /admin/stats (see AdminStats.tsx). The screen
// mounts it once the numbers have loaded, so a visitor who gets "Not available"
// never sends a request for accounts, and keeps it mounted through a period
// switch, so the page and search survive one. If the list itself is not
// available it draws nothing, rather than a second "Not available".

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  loadAdminAccounts,
  setTestAccount,
  type AccountSort,
  type AdminAccountRow,
  type AdminAccounts,
  type AdminAccountsRequest,
  type AdminAccountsResult,
  type SortDirection,
} from './admin-accounts';
import { RetryPanel } from './AdminRetryPanel';
import { Button, Checkbox, DataTable, EmptyState, Field, SkeletonRows } from './components';

const countFormat = new Intl.NumberFormat('en');
const FIRST_PAGE: AdminAccountsRequest = {
  page: 1,
  query: '',
  excludeTest: false,
  sort: null,
  dir: 'asc',
};
const MAX_EMAIL_LENGTH = 254;

/** The columns in the order the table draws them; the sort key each one orders by. */
const SORTABLE_COLUMNS: readonly {
  readonly key: AccountSort;
  readonly label: string;
  readonly numeric?: boolean;
}[] = [
  { key: 'email', label: 'Email' },
  { key: 'registered', label: 'Registered' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'tutorial', label: 'Tutorial' },
  { key: 'freeCheck', label: 'Free check' },
  { key: 'scans', label: 'Scans', numeric: true },
  { key: 'purchases', label: 'Purchases', numeric: true },
  { key: 'lastActivity', label: 'Last activity' },
  { key: 'testAccount', label: 'Test account' },
];

type LoadState = { readonly kind: 'loading' } | AdminAccountsResult;

const LOADING: LoadState = { kind: 'loading' };

/** The UTC calendar day, as the dashboard's "Days are UTC" promises. */
function formatDay(instant: string): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/** The page and search on screen, its answer, and the two ways to ask again. */
function useAccountList() {
  const [request, setRequest] = useState<AdminAccountsRequest>(FIRST_PAGE);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>(LOADING);
  /** Addresses whose flag change is on its way to the API, to keep their button quiet. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // The synchronous twin of `pending`: the state update lands on the next
  // render, so only a ref can stop a second click inside the same frame.
  const pendingRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    // A slow answer for the page or search the owner just left must not
    // replace the one they moved to.
    let isCurrent = true;
    void loadAdminAccounts(request).then((result) => {
      if (isCurrent) setState(result);
    });
    return () => {
      isCurrent = false;
    };
  }, [request, attempt]);

  const ask = (next: AdminAccountsRequest): void => {
    setState(LOADING);
    setRequest(next);
  };
  const retry = (): void => {
    setState(LOADING);
    setAttempt((count) => count + 1);
  };

  /**
   * Flips one row's test flag on screen at once, then asks the API. A refusal
   * (or a page that moved on) puts the row back to the flag it showed before
   * the click; a reload after that shows what the server actually holds.
   */
  const markTest = (email: string, testAccount: boolean): void => {
    if (pendingRef.current.has(email)) return;
    pendingRef.current = new Set(pendingRef.current).add(email);
    setPending((current) => new Set(current).add(email));
    setRowFlag(email, testAccount);
    void setTestAccount(email, testAccount).then((result) => {
      pendingRef.current = new Set(
        [...pendingRef.current].filter((pendingEmail) => pendingEmail !== email),
      );
      setPending((current) => {
        const next = new Set(current);
        next.delete(email);
        return next;
      });
      if (result.kind !== 'updated') setRowFlag(email, !testAccount);
    });
  };

  function setRowFlag(email: string, testAccount: boolean): void {
    setState((current) => {
      if (current.kind !== 'ready') return current;
      const rows = current.accounts.rows.map((row) =>
        row.email === email ? { ...row, testAccount } : row,
      );
      return { kind: 'ready', accounts: { ...current.accounts, rows } };
    });
  }

  return { request, state, pending, ask, retry, markTest };
}

export function AccountsSection() {
  const { request, state, pending, ask, retry, markTest } = useAccountList();
  const [draft, setDraft] = useState('');

  if (state.kind === 'unavailable') return null;

  const clear = (): void => {
    // "Clear" is the search's clear button: the chosen sort and the test-account
    // filter are the owner's view of the list and survive it.
    setDraft('');
    ask({ ...request, page: 1, query: '' });
  };

  /**
   * The order the table actually draws, with the API's default read as the
   * "Registered" column descending: the indicator can mark it from the first
   * render, and clicking it once flips to ascending like every other column.
   */
  const sort: AccountSort = request.sort ?? 'registered';
  const dir: SortDirection = request.sort === null ? 'desc' : request.dir;
  const chooseSort = (key: AccountSort): void => {
    ask({
      ...request,
      page: 1,
      sort: key,
      dir: sort === key ? (dir === 'asc' ? 'desc' : 'asc') : 'asc',
    });
  };
  const chooseTestFilter = (excludeTest: boolean): void => {
    ask({ ...request, page: 1, excludeTest });
  };

  return (
    <section className="admin-stats__section" aria-label="Accounts">
      <h2 className="section-heading">Accounts</h2>
      <p className="muted">
        Every registered account. Click a column heading to sort by it. Purchases leave out
        test-mode orders, and an account marked as a test account is never counted in the numbers
        above — free checks cannot be attributed to an account and still count.
      </p>
      <SearchForm
        draft={draft}
        isQueryActive={request.query !== ''}
        excludeTest={request.excludeTest}
        onDraft={setDraft}
        onSearch={() => ask({ ...request, page: 1, query: draft.trim() })}
        onClear={clear}
        onExcludeTest={chooseTestFilter}
      />
      <AccountsBody
        state={state}
        query={request.query}
        excludeTest={request.excludeTest}
        sort={sort}
        dir={dir}
        pending={pending}
        onPage={(page) => ask({ ...request, page })}
        onRetry={retry}
        onSort={chooseSort}
        onMarkTest={markTest}
      />
    </section>
  );
}

function SearchForm(props: {
  draft: string;
  isQueryActive: boolean;
  excludeTest: boolean;
  onDraft: (draft: string) => void;
  onSearch: () => void;
  onClear: () => void;
  onExcludeTest: (excludeTest: boolean) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSearch();
  };
  return (
    <form className="admin-accounts__search" role="search" onSubmit={submit}>
      <Field
        label="Search by email"
        name="q"
        value={props.draft}
        onChange={props.onDraft}
        autoComplete="off"
        maxLength={MAX_EMAIL_LENGTH}
      />
      <div className="button-row">
        <Button type="submit">Search</Button>
        {props.isQueryActive ? <Button onClick={props.onClear}>Clear</Button> : null}
        <Checkbox
          className="admin-accounts__test-filter"
          label="Hide test accounts"
          checked={props.excludeTest}
          onChange={props.onExcludeTest}
        />
      </div>
    </form>
  );
}

function AccountsBody(props: {
  state: Exclude<LoadState, { readonly kind: 'unavailable' }>;
  query: string;
  excludeTest: boolean;
  sort: AccountSort;
  dir: SortDirection;
  pending: ReadonlySet<string>;
  onPage: (page: number) => void;
  onRetry: () => void;
  onSort: (sort: AccountSort) => void;
  onMarkTest: (email: string, testAccount: boolean) => void;
}) {
  const { state } = props;
  if (state.kind === 'loading') return <SkeletonRows rows={4} />;
  if (state.kind === 'failed') {
    return (
      <RetryPanel
        title="The accounts could not be loaded"
        message={state.message}
        onRetry={props.onRetry}
      />
    );
  }
  const { accounts } = state;
  if (accounts.rows.length === 0) {
    // A filter that hid everything is not an empty table: the accounts exist.
    const filtered = props.query !== '' || props.excludeTest;
    return (
      <EmptyState
        title={filtered ? 'No accounts match' : 'No accounts'}
        action={
          accounts.page > 1 ? <Button onClick={() => props.onPage(1)}>First page</Button> : null
        }
      />
    );
  }
  return (
    <>
      <AccountsTable
        rows={accounts.rows}
        sort={props.sort}
        dir={props.dir}
        pending={props.pending}
        onSort={props.onSort}
        onMarkTest={props.onMarkTest}
      />
      <Pager accounts={accounts} onPage={props.onPage} />
    </>
  );
}

function AccountsTable(props: {
  rows: readonly AdminAccountRow[];
  sort: AccountSort;
  dir: SortDirection;
  pending: ReadonlySet<string>;
  onSort: (sort: AccountSort) => void;
  onMarkTest: (email: string, testAccount: boolean) => void;
}) {
  return (
    <DataTable>
      <thead>
        <tr>
          {SORTABLE_COLUMNS.map((column) => {
            const active = column.key === props.sort;
            return (
              <th
                key={column.key}
                className={column.numeric ? 'admin-stats__num' : undefined}
                aria-sort={
                  active
                    ? props.dir === 'asc'
                      ? ('ascending' as const)
                      : ('descending' as const)
                    : undefined
                }
              >
                <button
                  type="button"
                  className="admin-accounts__sort"
                  onClick={() => props.onSort(column.key)}
                >
                  {column.label}
                  <span aria-hidden="true" className="admin-accounts__sort-arrow">
                    {active ? (props.dir === 'asc' ? '↑' : '↓') : null}
                  </span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row) => (
          <tr key={row.email}>
            <td data-label="Email" className="technical">
              {row.email}
            </td>
            <td data-label="Registered">{formatDay(row.createdAt)}</td>
            <td data-label="Confirmed">{row.emailVerified ? 'yes' : '—'}</td>
            <td data-label="Tutorial">
              {row.tutorial === 'completed'
                ? 'Completed'
                : row.tutorial === 'skipped'
                  ? 'Skipped'
                  : 'Pending'}
            </td>
            <td data-label="Free check">
              {row.freeCheckUsedAt === null ? '—' : formatDay(row.freeCheckUsedAt)}
            </td>
            <td data-label="Scans" className="admin-stats__num">
              {countFormat.format(row.scans)}
            </td>
            <td data-label="Purchases" className="admin-stats__num">
              {countFormat.format(row.purchases)}
            </td>
            <td data-label="Last activity">{formatDay(row.lastActivityAt)}</td>
            <td data-label="Test account">
              <button
                type="button"
                className="button admin-accounts__test"
                aria-pressed={row.testAccount}
                aria-label={`${row.testAccount ? 'Unmark' : 'Mark'} ${row.email} as a test account`}
                disabled={props.pending.has(row.email)}
                onClick={() => props.onMarkTest(row.email, !row.testAccount)}
              >
                {row.testAccount ? 'Test ✓' : 'Mark test'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function Pager(props: { accounts: AdminAccounts; onPage: (page: number) => void }) {
  const { page, pageSize, total, rows } = props.accounts;
  const first = (page - 1) * pageSize + 1;
  const last = first + rows.length - 1;
  return (
    <div className="admin-accounts__pager">
      <p className="muted">
        Showing {countFormat.format(first)}–{countFormat.format(last)} of{' '}
        {countFormat.format(total)}
      </p>
      <div className="button-row">
        <Button disabled={page <= 1} onClick={() => props.onPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={last >= total} onClick={() => props.onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
