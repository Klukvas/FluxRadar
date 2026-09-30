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
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/profiles/suggestions' && init?.method === 'POST') {
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
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
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
    expect(
      screen.getByPlaceholderText('A private dental clinic helping families in Kyiv…'),
    ).toHaveValue('Evidence-grounded care');
    expect(
      screen.getByPlaceholderText('Dental implants, cleanings, emergency appointments'),
    ).toHaveValue('Implants, emergencies');
  });

  it('fills the business type, served region and audience the page states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new URL(String(input)).pathname === '/profiles/suggestions'
            ? success({
                name: 'Bright Smile',
                industry: 'Dentist',
                region: 'Kyiv and Kyiv region',
                targetAudience: 'Families with children',
                targetLanguages: 'uk, en',
              })
            : success([]),
        ),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'clinic.example' },
    });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('Bright Smile'),
    );
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
    expect(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine')).toHaveValue(
      'Kyiv and Kyiv region',
    );
    expect(
      screen.getByPlaceholderText('Adults and families looking for a dentist in Kyiv'),
    ).toHaveValue('Families with children');
    expect(screen.getByText(/2 chosen: Ukrainian, English/)).toBeInTheDocument();
  });

  // A page that states three of six fields must say which three it did not, or
  // a half-filled form reads as a broken autofill.
  it('names the fields the page stated nothing about instead of leaving them unexplained', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new URL(String(input)).pathname === '/profiles/suggestions'
            ? success({
                name: 'fluxLab.dev',
                businessDescription: 'Kyiv product studio behind SaaS apps.',
                offerings: 'SaaS Development, Dedicated Development Teams',
                region: 'United States, Ukraine',
                targetLanguages: 'en, uk',
              })
            : success([]),
        ),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'flux-lab.example' },
    });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('fluxLab.dev'),
    );
    expect(
      screen.getByText(
        'We could not identify the business or site type and who it is for in the homepage’s public metadata, so those stay empty — fill them in yourself.',
      ),
    ).toBeInTheDocument();
  });

  it('never overwrites a business type, region or audience the owner wrote', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new URL(String(input)).pathname === '/profiles/suggestions'
            ? success({
                industry: 'Dentist',
                region: 'United States',
                targetAudience: 'Families with children',
              })
            : success([]),
        ),
      ),
    );
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'clinic.example' },
    });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.change(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
      {
        target: { value: 'Marketing agency' },
      },
    );
    fireEvent.change(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine'), {
      target: { value: 'Berlin' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('Adults and families looking for a dentist in Kyiv'),
      {
        target: { value: 'In-house engineers' },
      },
    );
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
      ).toHaveValue('Marketing agency'),
    );
    expect(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine')).toHaveValue('Berlin');
    expect(
      screen.getByPlaceholderText('Adults and families looking for a dentist in Kyiv'),
    ).toHaveValue('In-house engineers');
  });

  it('drops a proposal for the new fields that arrives after the owner typed one', async () => {
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
      target: { value: 'clinic.example' },
    });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    fireEvent.change(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine'), {
      target: { value: 'Berlin' },
    });
    pending.resolve(success({ region: 'United States', industry: 'Dentist' }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine')).toHaveValue('Berlin'),
    );
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('');
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
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
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
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
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
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        'Could not read public details from this site. You can still save it manually.',
      ),
    );
    expect(screen.getByRole('button', { name: 'Save profile' })).not.toBeDisabled();
  });
});

describe('profile context translation', () => {
  it('translates only human context and restores the original value', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/profiles/context-translation') {
        return Promise.resolve(success({ industry: 'Продуктова студія' }));
      }
      return Promise.resolve(success([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm();
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    const field = screen.getByPlaceholderText('Dental clinic, recruiting platform, online store');
    fireEvent.change(field, { target: { value: 'Product studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Translate context to English' }));
    await waitFor(() => expect(field).toHaveValue('Продуктова студія'));
    expect(screen.getByRole('button', { name: 'Restore original text' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/profiles/context-translation'),
      expect.objectContaining({
        body: JSON.stringify({ targetLanguage: 'en', industry: 'Product studio' }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore original text' }));
    expect(field).toHaveValue('Product studio');
  });

  it('keeps an edit made while a translation is pending', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        new URL(String(input)).pathname === '/profiles/context-translation'
          ? pending.promise
          : Promise.resolve(success([])),
      ),
    );
    renderForm();
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    const field = screen.getByPlaceholderText('Dental clinic, recruiting platform, online store');
    fireEvent.change(field, { target: { value: 'Product studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Translate context to English' }));
    fireEvent.change(field, { target: { value: 'Owner wording' } });
    pending.resolve(success({ industry: 'Translated wording' }));
    await waitFor(() => expect(field).toHaveValue('Owner wording'));
  });

  it('does not restore over a later manual edit and reports an unavailable provider', async () => {
    const notice = vi.fn();
    let translationAttempt = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (new URL(String(input)).pathname !== '/profiles/context-translation') {
          return Promise.resolve(success([]));
        }
        translationAttempt += 1;
        return translationAttempt === 1
          ? Promise.resolve(success({ industry: 'Translated wording' }))
          : Promise.resolve(
              new Response(
                JSON.stringify({
                  success: false,
                  data: null,
                  error: { code: 'VALIDATION', message: 'Translation is temporarily unavailable.' },
                }),
                { status: 400, headers: { 'content-type': 'application/json' } },
              ),
            );
      }),
    );
    renderForm({ onNotice: notice });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    const field = screen.getByPlaceholderText('Dental clinic, recruiting platform, online store');
    fireEvent.change(field, { target: { value: 'Product studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Translate context to English' }));
    await waitFor(() => expect(field).toHaveValue('Translated wording'));
    fireEvent.change(field, { target: { value: 'Owner wording' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore original text' }));
    expect(field).toHaveValue('Owner wording');
    fireEvent.click(screen.getByRole('button', { name: 'Translate context to English' }));
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        'Translation is temporarily unavailable. You can continue editing the original text.',
      ),
    );
  });
});
