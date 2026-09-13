// Deleting a site from the workspace list. The action sits on the site's own row
// next to New scan / Inspect / Edit profile — hidden inside the edit form it was
// not found at all — and it still asks for the site address before deleting.

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

    const row = rowOf('Gone site');
    const toggle = within(row).getByRole('button', { name: 'Delete' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

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

    fireEvent.click(within(rowOf('Gone site')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(rowOf('Kept site')).getByRole('button', { name: 'Delete' }));

    expect(within(rowOf('Kept site')).getByLabelText('Type kept.example.com to confirm')).toBeVisible();
    expect(within(rowOf('Gone site')).queryByRole('button', { name: 'Delete profile' })).toBeNull();
  });
});
