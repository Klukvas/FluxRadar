import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { DesktopScreen } from './DesktopScreen';

const success = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function renderForm(
  options: {
    readonly profiles?: readonly SiteProfile[];
    readonly onNotice?: (message: string) => void;
  } = {},
) {
  render(
    <DesktopScreen
      profiles={options.profiles ?? []}
      onRefresh={() => Promise.resolve()}
      onProfileDeleted={() => {}}
      onSelectProfile={() => {}}
      onNewScan={() => {}}
      onOpenScan={() => {}}
      onRetryScan={() => Promise.resolve()}
      onError={() => {}}
      onNotice={options.onNotice ?? (() => {})}
      onOnboarding={() => {}}
      language="en"
    />,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile suggestions', () => {
  it('applies public suggestions without creating or updating a profile before Save', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/profiles/suggestions') {
        return Promise.resolve(
          success({
            name: 'Public clinic',
            businessDescription: 'Evidence-grounded care',
            offerings: 'Implants, emergencies',
            targetLanguages: 'en',
          }),
        );
      }
      return Promise.resolve(success([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'clinic.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get details from site' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('Public clinic'),
    );
    expect(
      screen.getByText('Suggested from the public homepage. Review and edit before saving.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(
      fetchMock.mock.calls.find(([input]) => String(input).includes('/profiles/suggestions'))?.[0],
    ).toContain('/profiles/suggestions');
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    expect(
      screen.getByPlaceholderText('A private dental clinic helping families in Kyiv…'),
    ).toHaveValue('Evidence-grounded care');
    expect(
      screen.getByPlaceholderText('Dental implants, cleanings, emergency appointments'),
    ).toHaveValue('Implants, emergencies');
  });

  it('keeps a manual name when an older request returns after an address edit', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (new URL(String(input)).pathname === '/profiles/suggestions') return pending.promise;
        return Promise.resolve(success([]));
      }),
    );
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'first.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get details from site' }));
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'second.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('Product site'), {
      target: { value: 'Manual name' },
    });
    pending.resolve(success({ name: 'Old public title' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('Manual name'),
    );
  });

  it('does not let a pending new-profile suggestion overwrite a saved profile opened for edit', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (new URL(String(input)).pathname === '/profiles/suggestions') return pending.promise;
        return Promise.resolve(success([]));
      }),
    );
    const profile: SiteProfile = {
      id: 'saved',
      name: 'Saved profile',
      domain: 'https://saved.example',
    };
    renderForm({ profiles: [profile] });
    fireEvent.click(screen.getByRole('button', { name: '+ Add a site' }));
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'new.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get details from site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Saved profile' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit profile' }));
    pending.resolve(success({ name: 'Stale public title' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('Saved profile'),
    );
  });

  it('reports a suggestion failure but leaves manual profile save available', async () => {
    const notice = vi.fn();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/profiles/suggestions')
        return Promise.resolve(new Response('', { status: 503 }));
      if (path === '/profiles' && init?.method === 'POST') {
        return Promise.resolve(success({ id: 'new' }));
      }
      return Promise.resolve(success([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm({ onNotice: notice });
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'manual.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('Product site'), {
      target: { value: 'Manual profile' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get details from site' }));
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        'Could not read public details from this site. You can still save it manually.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Save profile' })).not.toBeDisabled();
  });
});
