// Deleting a site from the workspace list. The action sits in the site's own row
// menu, below Reports and Edit profile — hidden inside the edit form it was not
// found at all — and it still asks for the site address before deleting.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const account = { accountId: 'account-1', email: 'operator@example.com' };
const kept = { id: 'profile-kept', name: 'Kept site', domain: 'https://kept.example.com' };
const gone = { id: 'profile-gone', name: 'Gone site', domain: 'https://gone.example.com' };

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Serves the workspace; a DELETE of `gone` removes it from later profile lists. */
function stubWorkspace(): { readonly deletedPaths: readonly string[] } {
  const deletedPaths: string[] = [];
  let profiles: readonly (typeof kept)[] = [kept, gone];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      if (path === '/auth/me') return Promise.resolve(envelope(account));
      if (path === '/profiles') return Promise.resolve(envelope(profiles));
      if (path === `/profiles/${gone.id}` && init.method === 'DELETE') {
        deletedPaths.push(path);
        profiles = [kept];
      }
      return Promise.resolve(envelope(null));
    }),
  );
  return { deletedPaths };
}

async function openSiteProfiles(): Promise<void> {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open workspace' }));
  await screen.findByText('Registered public origins');
}

function rowOf(name: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.profile-row')].find(
    (candidate) => within(candidate).queryByText(name) !== null,
  );
  if (row === undefined) throw new Error(`no profile row for ${name}`);
  return row;
}

/** Opens a row's "⋯" menu and picks one of its items. */
function chooseFromRowMenu(name: string, item: string): void {
  fireEvent.click(within(rowOf(name)).getByRole('button', { name: `Actions for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('site profile rows', () => {
  it('deletes a site from its own row once the address is typed', async () => {
    const { deletedPaths } = stubWorkspace();
    await openSiteProfiles();

    chooseFromRowMenu('Gone site', 'Delete');

    const row = rowOf('Gone site');
    // The confirmation takes focus into the one field it asks for.
    expect(within(row).getByLabelText('Type gone.example.com to confirm')).toHaveFocus();
    const confirm = within(row).getByRole('button', { name: 'Delete profile' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(row).getByLabelText('Type gone.example.com to confirm'), {
      target: { value: 'gone.example.com' },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(document.querySelectorAll('.profile-row')).toHaveLength(1));
    expect(deletedPaths).toEqual([`/profiles/${gone.id}`]);
    expect(rowOf('Kept site')).toBeInTheDocument();
  });

  it('keeps one delete confirmation open at a time', async () => {
    stubWorkspace();
    await openSiteProfiles();

    chooseFromRowMenu('Gone site', 'Delete');
    chooseFromRowMenu('Kept site', 'Delete');

    expect(
      within(rowOf('Kept site')).getByLabelText('Type kept.example.com to confirm'),
    ).toBeVisible();
    expect(within(rowOf('Gone site')).queryByRole('button', { name: 'Delete profile' })).toBeNull();
  });

  it('closes the confirmation on Cancel and hands focus back to the row menu', async () => {
    stubWorkspace();
    await openSiteProfiles();

    chooseFromRowMenu('Gone site', 'Delete');
    fireEvent.click(within(rowOf('Gone site')).getByRole('button', { name: 'Cancel' }));

    expect(within(rowOf('Gone site')).queryByRole('button', { name: 'Delete profile' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Gone site' })).toHaveFocus();
  });

  it('keeps the row to New scan and one menu, walked with the arrow keys', async () => {
    stubWorkspace();
    await openSiteProfiles();

    const row = rowOf('Kept site');
    expect(
      within(row)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['New scan', '']);

    const menuButton = within(row).getByRole('button', { name: 'Actions for Kept site' });
    expect(menuButton).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Reports', 'Edit profile', 'Delete']);
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowUp' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(items[2] as HTMLElement, { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(items[0] as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menuButton).toHaveFocus();
  });
});
