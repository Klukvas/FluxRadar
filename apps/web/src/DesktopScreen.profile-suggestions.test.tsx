import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { DesktopScreen } from './DesktopScreen';
import type { Language } from './i18n';
import { AUTOFILL_DEBOUNCE_MS } from './profile-autofill';

const success = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const refusal = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ success: false, data: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function renderForm(
  options: {
    readonly profiles?: readonly SiteProfile[];
    readonly onNotice?: (message: string) => void;
    readonly language?: Language;
    /** An address handed over from the public page, awaiting confirmation. */
    readonly initialDomain?: string;
  } = {},
) {
  const desktopProps = {
    profiles: options.profiles ?? [],
    initialDomain: options.initialDomain ?? null,
    onRefresh: () => Promise.resolve(),
    onProfileDeleted: () => {},
    onSelectProfile: () => {},
    onNewScan: () => {},
    onOpenScan: () => {},
    onRetryScan: () => Promise.resolve(),
    onError: () => {},
    onNotice: options.onNotice ?? (() => {}),
    onOnboarding: () => {},
  };
  const rendered = render(<DesktopScreen {...desktopProps} language={options.language ?? 'en'} />);
  return {
    ...rendered,
    rerenderLanguage: (language: Language) =>
      rendered.rerender(<DesktopScreen {...desktopProps} language={language} />),
  };
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
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toContain('/profiles/suggestions');
    expect(posts[0]?.[1]).toMatchObject({
      body: JSON.stringify({ domain: 'https://clinic.example', targetLanguage: 'en' }),
    });
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

  it('keeps the latest Fill result when an aborted earlier request settles late', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    let request = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path === '/profiles/suggestions')
          return request++ === 0 ? first.promise : second.promise;
        return Promise.resolve(success({}));
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
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    second.resolve(success({ name: 'Second site', industry: 'Latest industry' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('Second site'),
    );
    first.resolve(success({ name: 'First site', industry: 'Stale industry' }));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
      ).toHaveValue('Latest industry'),
    );
    expect(screen.getByPlaceholderText('Product site')).toHaveValue('Second site');
  });

  it('drops a localized proposal that settles after the UI locale changes', async () => {
    const pending = deferred<Response>();
    const form = renderForm();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        new URL(String(input)).pathname === '/profiles/suggestions'
          ? pending.promise
          : Promise.resolve(success([])),
      ),
    );
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'studio.example' },
    });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    form.rerenderLanguage('uk');
    pending.resolve(success({ industry: 'Product studio' }));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('Стоматологія, рекрутингова платформа, інтернет-магазин'),
      ).toHaveValue(''),
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

// The form reads the site on its own now, so these are the guards around a
// request nobody pressed a button for: when it is allowed to go out, how often,
// what cancels it, and what the owner is told while it happens.
describe('automatic autofill from the pasted address', () => {
  const CHECKING = 'Checking whether we can read this site, then filling in what it states…';
  const FILLED =
    'Filled in what this site’s homepage states. Review it in the section below before saving.';

  beforeEach(() => {
    // `shouldAdvanceTime` keeps `waitFor` and `findBy*` working: without it the
    // clock never moves on its own and their polling never gets a turn.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets the debounce expire and the answer land. */
  async function autofillSettles(extraMs = 0): Promise<void> {
    await act(() => vi.advanceTimersByTimeAsync(AUTOFILL_DEBOUNCE_MS + extraMs));
  }

  function suggestionCalls(mock: ReturnType<typeof vi.fn>): unknown[][] {
    return mock.mock.calls.filter(([input]) => String(input).includes('/profiles/suggestions'));
  }

  function stubSuggestions(suggestion: (input: string) => Response | Promise<Response>) {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname === '/profiles/suggestions' && init?.method === 'POST'
        ? Promise.resolve(suggestion(String(input)))
        : Promise.resolve(success([])),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function typeAddress(value: string): void {
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), { target: { value } });
  }

  it('fills the form from the pasted address with no button pressed', async () => {
    const fetchMock = stubSuggestions(() =>
      success({
        name: 'Public clinic',
        industry: 'Dentist',
        businessDescription: 'Evidence-grounded care',
        targetLanguages: 'en',
      }),
    );
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();

    expect(screen.getByPlaceholderText('Product site')).toHaveValue('Public clinic');
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
    expect(screen.getByText(FILLED)).toBeInTheDocument();
    expect(suggestionCalls(fetchMock)).toHaveLength(1);
    expect(suggestionCalls(fetchMock)[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ domain: 'https://clinic.example', targetLanguage: 'en' }),
    });
    // Reading a homepage is not saving a profile, and it is not buying a scan.
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          (init as RequestInit | undefined)?.method === 'POST' &&
          !String(input).includes('/profiles/suggestions'),
      ),
    ).toHaveLength(0);
  });

  it('says it is checking the site while the read is still running', async () => {
    const pending = deferred<Response>();
    stubSuggestions(() => pending.promise);
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();

    expect(screen.getByText(CHECKING)).toBeInTheDocument();
    pending.resolve(success({ name: 'Public clinic' }));
    await waitFor(() => expect(screen.getByText(FILLED)).toBeInTheDocument());
  });

  it('asks the site once when the typing stops, not once per keystroke', async () => {
    const fetchMock = stubSuggestions(() => success({ name: 'Public clinic' }));
    renderForm();

    // Every one of these is a complete address on its own — a dotted host is
    // valid from "clinic.e" onwards — which is exactly why the delay matters.
    for (const value of ['clinic.e', 'clinic.ex', 'clinic.exa', 'clinic.example']) {
      typeAddress(value);
      await act(() => vi.advanceTimersByTimeAsync(AUTOFILL_DEBOUNCE_MS / 4));
    }
    await autofillSettles();

    expect(suggestionCalls(fetchMock)).toHaveLength(1);
    expect(suggestionCalls(fetchMock)[0]?.[1]).toMatchObject({
      body: JSON.stringify({ domain: 'https://clinic.example', targetLanguage: 'en' }),
    });
  });

  it('reads one address once, however often the same site is pasted again', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    // The same site, respelled and then given a path: one answer covers all three.
    typeAddress('https://clinic.example');
    typeAddress('https://clinic.example/pricing');
    await autofillSettles();

    expect(suggestionCalls(fetchMock)).toHaveLength(1);
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
  });

  // Leaving the address took back everything the read had filled in, so refusing
  // to read it again left the owner with a form this feature had emptied.
  it('fills the form again when the owner comes back to an address they cleared', async () => {
    const fetchMock = stubSuggestions(() =>
      success({
        name: 'Public clinic',
        industry: 'Dentist',
        businessDescription: 'Evidence-grounded care',
      }),
    );
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    fireEvent.change(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine'), {
      target: { value: 'Berlin' },
    });
    typeAddress('');
    await autofillSettles();
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('');
    typeAddress('clinic.example');
    await autofillSettles();

    expect(suggestionCalls(fetchMock)).toHaveLength(2);
    expect(screen.getByPlaceholderText('Product site')).toHaveValue('Public clinic');
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
    expect(
      screen.getByPlaceholderText('A private dental clinic helping families in Kyiv…'),
    ).toHaveValue('Evidence-grounded care');
    // Written by the owner before the round trip, so neither read touches it.
    expect(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine')).toHaveValue('Berlin');
    expect(screen.getByText(FILLED)).toBeInTheDocument();
  });

  it('reads the address it comes back to when the move away was never sent', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    typeAddress('studio.example');
    await act(() => vi.advanceTimersByTimeAsync(AUTOFILL_DEBOUNCE_MS / 2));
    typeAddress('clinic.example');
    await autofillSettles();

    // The address the owner left before the debounce expired was never asked
    // about; the one they came back to was asked again, because leaving it had
    // already taken its first answer out of the form.
    expect(
      suggestionCalls(fetchMock).map(
        ([, init]) => JSON.parse(String((init as RequestInit).body)).domain as string,
      ),
    ).toEqual(['https://clinic.example', 'https://clinic.example']);
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
  });

  it('reads a different address the owner moves on to', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    typeAddress('studio.example');
    await autofillSettles();

    expect(suggestionCalls(fetchMock).map(([, init]) => (init as RequestInit).body)).toEqual([
      JSON.stringify({ domain: 'https://clinic.example', targetLanguage: 'en' }),
      JSON.stringify({ domain: 'https://studio.example', targetLanguage: 'en' }),
    ]);
  });

  it('never reads a half-typed address', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm();

    typeAddress('clinic');
    await autofillSettles();

    expect(suggestionCalls(fetchMock)).toHaveLength(0);
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument();
  });

  it('reads nothing for a saved profile opened for editing', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    const profile: SiteProfile = {
      id: 'saved',
      name: 'Saved profile',
      domain: 'https://saved.example',
    };
    renderForm({ profiles: [profile] });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Saved profile' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit profile' }));
    typeAddress('moved.example');
    await autofillSettles();

    expect(suggestionCalls(fetchMock)).toHaveLength(0);
  });

  it('drops a scheduled read as soon as the owner describes the site themselves', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm();

    typeAddress('clinic.example');
    await act(() => vi.advanceTimersByTimeAsync(AUTOFILL_DEBOUNCE_MS / 2));
    fireEvent.change(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
      { target: { value: 'Marketing agency' } },
    );
    await autofillSettles(1_000);

    expect(suggestionCalls(fetchMock)).toHaveLength(0);
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Marketing agency');
  });

  it('starts no read when the owner has already answered everything', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Product site'), {
      target: { value: 'Written by hand' },
    });
    const written: readonly [string, string][] = [
      ['Dental clinic, recruiting platform, online store', 'Dental clinic'],
      ['A private dental clinic helping families in Kyiv…', 'A clinic in Kyiv'],
      ['Dental implants, cleanings, emergency appointments', 'Implants'],
      ['Kyiv and Kyiv region, Ukraine', 'Kyiv'],
      ['Adults and families looking for a dentist in Kyiv', 'Families'],
    ];
    written.forEach(([placeholder, value]) =>
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } }),
    );
    fireEvent.click(screen.getByText('Choose languages'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'English' }));
    typeAddress('clinic.example');
    await autofillSettles();

    expect(suggestionCalls(fetchMock)).toHaveLength(0);
  });

  it('cancels a scheduled read when the form goes away', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm();

    typeAddress('clinic.example');
    await act(() => vi.advanceTimersByTimeAsync(AUTOFILL_DEBOUNCE_MS / 2));
    cleanup();
    await autofillSettles(1_000);

    expect(suggestionCalls(fetchMock)).toHaveLength(0);
  });

  it('tells the owner how to let our crawler in, and still lets them save', async () => {
    const fetchMock = stubSuggestions(() =>
      refusal(409, 'SITE_ACCESS_DENIED', 'this site refused our crawler'),
    );
    renderForm();

    typeAddress('walled.example');
    await autofillSettles();

    expect(
      screen.getByText(
        /We could not read this site, so nothing was filled in\..*WAF or bot protection.*save the profile and describe the site yourself\./s,
      ),
    ).toBeInTheDocument();
    expect(suggestionCalls(fetchMock)).toHaveLength(1);
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  });

  // What the automatic read said is an answer about this address, so the moment
  // the owner asks the same question again by hand it stops standing: a refusal
  // left under the address while the retry is running, or after it succeeded,
  // describes a read that has been superseded.
  it('drops what the automatic refusal said once the owner retries by hand', async () => {
    const pending = deferred<Response>();
    let reads = 0;
    const fetchMock = stubSuggestions(() => {
      reads += 1;
      return reads === 1
        ? refusal(409, 'SITE_ACCESS_DENIED', 'this site refused our crawler')
        : pending.promise;
    });
    renderForm();

    typeAddress('walled.example');
    await autofillSettles();
    const refused = /We could not read this site, so nothing was filled in\./;
    expect(screen.getByText(refused)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    const audience = screen.getByPlaceholderText(
      'Adults and families looking for a dentist in Kyiv',
    );
    fireEvent.change(audience, { target: { value: 'Local families' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));

    await waitFor(() => expect(suggestionCalls(fetchMock)).toHaveLength(2));
    expect(screen.queryByText(refused)).not.toBeInTheDocument();

    pending.resolve(
      success({ name: 'Walled clinic', industry: 'Dentist', targetAudience: 'Anyone at all' }),
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('Walled clinic'),
    );
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
    expect(screen.queryByText(refused)).not.toBeInTheDocument();
    // The one answer the owner gave by hand is theirs, refusal or not.
    expect(audience).toHaveValue('Local families');
  });

  it('drops what the automatic read filled in when a manual retry then fails', async () => {
    const notice = vi.fn();
    let reads = 0;
    stubSuggestions(() => {
      reads += 1;
      return reads === 1
        ? success({ name: 'Public clinic', industry: 'Dentist' })
        : new Response('', { status: 503 });
    });
    renderForm({ onNotice: notice });

    typeAddress('clinic.example');
    await autofillSettles();
    expect(screen.getByText(FILLED)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));

    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        'Could not read public details from this site. You can still save it manually.',
      ),
    );
    // The failure is spoken once, in the notice: the line under the address must
    // not go on claiming the site was read.
    expect(screen.queryByText(FILLED)).not.toBeInTheDocument();
  });

  it('keeps the neutral sentence for a failure the site did not cause', async () => {
    stubSuggestions(() => new Response('', { status: 500 }));
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();

    expect(
      screen.getByText(
        'Could not read public details from this site. You can still save it manually.',
      ),
    ).toBeInTheDocument();
  });

  it('never overwrites a display name the owner typed first', async () => {
    stubSuggestions(() => success({ name: 'Public clinic', industry: 'Dentist' }));
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Product site'), {
      target: { value: 'Client landing page' },
    });
    typeAddress('clinic.example');
    await autofillSettles();

    expect(screen.getByPlaceholderText('Product site')).toHaveValue('Client landing page');
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
  });

  it('reads an address carried in from the page the owner typed it on', async () => {
    const fetchMock = stubSuggestions(() => success({ industry: 'Dentist' }));
    renderForm({ initialDomain: 'carried.example' });

    await autofillSettles();

    expect(suggestionCalls(fetchMock)).toHaveLength(1);
    expect(suggestionCalls(fetchMock)[0]?.[1]).toMatchObject({
      body: JSON.stringify({ domain: 'https://carried.example', targetLanguage: 'en' }),
    });
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
  });

  it('keeps the proposal note when Fill is pressed after the form filled itself', async () => {
    const fetchMock = stubSuggestions(() =>
      success({ name: 'Public clinic', industry: 'Dentist' }),
    );
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    await waitFor(() => expect(suggestionCalls(fetchMock)).toHaveLength(2));

    // The second read has nothing left to write, but the values in the fields
    // are still the homepage's, so the note above them has to stay.
    await waitFor(() =>
      expect(
        screen.getByText('Suggested from the public homepage. Review and edit before saving.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText('Product site')).toHaveValue('Public clinic');
  });

  // An edit that leaves the origin alone used to abort the read it had just
  // started, and the dedupe then refused to start another: the form went quiet
  // with nothing filled in.
  it('keeps the read in flight when the address is edited inside the same site', async () => {
    const pending = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname !== '/profiles/suggestions')
        return Promise.resolve(success([]));
      signals.push(init!.signal!);
      return pending.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    expect(screen.getByText(CHECKING)).toBeInTheDocument();
    typeAddress('clinic.example/pricing');
    await autofillSettles();

    expect(screen.getByText(CHECKING)).toBeInTheDocument();
    expect(signals.map((signal) => signal.aborted)).toEqual([false]);
    pending.resolve(success({ name: 'Public clinic', industry: 'Dentist' }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Product site')).toHaveValue('Public clinic'),
    );
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Dentist');
    expect(screen.getByText(FILLED)).toBeInTheDocument();
    expect(suggestionCalls(fetchMock)).toHaveLength(1);
  });

  it('keeps what a refusal said when the address is repasted unchanged', async () => {
    const fetchMock = stubSuggestions(() =>
      refusal(409, 'SITE_ACCESS_DENIED', 'this site refused our crawler'),
    );
    renderForm();

    typeAddress('walled.example');
    await autofillSettles();
    const refused = /We could not read this site, so nothing was filled in\./;
    expect(screen.getByText(refused)).toBeInTheDocument();
    typeAddress('https://walled.example/');
    await autofillSettles();

    expect(screen.getByText(refused)).toBeInTheDocument();
    expect(suggestionCalls(fetchMock)).toHaveLength(1);
  });

  // One site's answer must not stay behind in the form once the address names
  // another, or the owner saves a profile describing the site they moved off.
  it('replaces everything it filled in from one site when the address moves to another', async () => {
    // The request body names the site, so the stub answers as each one would.
    const bySite = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname !== '/profiles/suggestions')
        return Promise.resolve(success([]));
      const asked = JSON.parse(String(init?.body ?? '{}')).domain as string;
      return Promise.resolve(
        success(
          asked === 'https://clinic.example'
            ? {
                name: 'Public clinic',
                industry: 'Dentist',
                businessDescription: 'Evidence-grounded care',
                offerings: 'Implants',
                region: 'Kyiv',
                targetAudience: 'Families',
                targetLanguages: 'uk',
              }
            : {
                name: 'Public studio',
                industry: 'Product studio',
                businessDescription: 'Ships SaaS apps',
                offerings: 'SaaS development',
                region: 'United States',
                targetAudience: 'Founders',
                targetLanguages: 'en',
              },
        ),
      );
    });
    vi.stubGlobal('fetch', bySite);
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    expect(screen.getByPlaceholderText('Product site')).toHaveValue('Public clinic');
    typeAddress('studio.example');
    await autofillSettles();

    expect(screen.getByPlaceholderText('Product site')).toHaveValue('Public studio');
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Product studio');
    expect(
      screen.getByPlaceholderText('A private dental clinic helping families in Kyiv…'),
    ).toHaveValue('Ships SaaS apps');
    expect(
      screen.getByPlaceholderText('Dental implants, cleanings, emergency appointments'),
    ).toHaveValue('SaaS development');
    expect(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine')).toHaveValue(
      'United States',
    );
    expect(
      screen.getByPlaceholderText('Adults and families looking for a dentist in Kyiv'),
    ).toHaveValue('Founders');
    expect(screen.getByText('1 chosen: English')).toBeInTheDocument();
    expect(suggestionCalls(bySite)).toHaveLength(2);
  });

  it('takes back only its own values when the address moves on, never the owner’s', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname !== '/profiles/suggestions')
        return Promise.resolve(success([]));
      const asked = JSON.parse(String(init?.body ?? '{}')).domain as string;
      return Promise.resolve(
        success(
          asked === 'https://clinic.example'
            ? { industry: 'Dentist', businessDescription: 'Evidence-grounded care' }
            : {
                industry: 'Product studio',
                businessDescription: 'Ships SaaS apps',
                targetAudience: 'Founders',
              },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    fireEvent.change(
      screen.getByPlaceholderText('Adults and families looking for a dentist in Kyiv'),
      { target: { value: 'In-house engineers' } },
    );
    typeAddress('studio.example');
    await autofillSettles();

    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('Product studio');
    expect(
      screen.getByPlaceholderText('A private dental clinic helping families in Kyiv…'),
    ).toHaveValue('Ships SaaS apps');
    // The owner answered this one themselves, so neither site's answer touches it.
    expect(
      screen.getByPlaceholderText('Adults and families looking for a dentist in Kyiv'),
    ).toHaveValue('In-house engineers');
  });

  it('clears the proposal when the address stops being one, and says nothing stale', async () => {
    stubSuggestions(() => success({ name: 'Public clinic', industry: 'Dentist' }));
    renderForm();

    typeAddress('clinic.example');
    await autofillSettles();
    fireEvent.change(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine'), {
      target: { value: 'Berlin' },
    });
    typeAddress('');
    await autofillSettles();

    expect(screen.getByPlaceholderText('Product site')).toHaveValue('');
    expect(
      screen.getByPlaceholderText('Dental clinic, recruiting platform, online store'),
    ).toHaveValue('');
    expect(screen.getByPlaceholderText('Kyiv and Kyiv region, Ukraine')).toHaveValue('Berlin');
    expect(screen.queryByText(FILLED)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Suggested from the public homepage. Review and edit before saving.'),
    ).not.toBeInTheDocument();
  });

  it('abandons a read in flight when the form goes away', async () => {
    const pending = deferred<Response>();
    const notice = vi.fn();
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (new URL(String(input)).pathname !== '/profiles/suggestions')
          return Promise.resolve(success([]));
        signals.push(init!.signal!);
        return pending.promise;
      }),
    );
    renderForm({ onNotice: notice });

    typeAddress('clinic.example');
    await autofillSettles();
    expect(signals).toHaveLength(1);
    cleanup();

    expect(signals[0]!.aborted).toBe(true);
    // A read that settles anyway answers a screen nobody is on: no fields to
    // write to, and nothing to say to the owner.
    pending.resolve(success({ name: 'Late public title', contextLanguage: 'source' }));
    await autofillSettles();
    expect(notice).not.toHaveBeenCalled();
  });

  it('says so when the homepage states nothing it could reuse', async () => {
    stubSuggestions(() => success({}));
    renderForm();

    typeAddress('empty.example');
    await autofillSettles();

    expect(
      screen.getByText(
        'This site’s homepage states nothing we could reuse, so the details below are yours to fill in.',
      ),
    ).toBeInTheDocument();
  });
});

describe('localized profile context', () => {
  it('uses the one suggestion response as localized context and keeps the target picker unchanged', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/profiles/suggestions')
        return Promise.resolve(success({ industry: 'Product studio', targetLanguages: 'en, ru' }));
      return Promise.resolve(success([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'studio.example' },
    });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    const field = screen.getByPlaceholderText('Dental clinic, recruiting platform, online store');
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    await waitFor(() => expect(field).toHaveValue('Product studio'));
    expect(screen.queryByRole('button', { name: 'Restore original text' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Translate context/ })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/profiles/suggestions')),
    ).toHaveLength(1);
    expect(screen.getByText(/2 chosen: English, Russian/)).toBeInTheDocument();
  });
  it('warns when the one response contains deterministic source-language fallback', async () => {
    const notice = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        return path === '/profiles/suggestions'
          ? Promise.resolve(success({ industry: 'Product studio', contextLanguage: 'source' }))
          : Promise.resolve(success([]));
      }),
    );
    renderForm({ onNotice: notice });
    fireEvent.change(screen.getByPlaceholderText('mysite.com'), {
      target: { value: 'studio.example' },
    });
    fireEvent.click(screen.getByText(/Describe the site for AI visibility checks/));
    const field = screen.getByPlaceholderText('Dental clinic, recruiting platform, online store');
    fireEvent.click(screen.getByRole('button', { name: 'Fill from site' }));
    await waitFor(() =>
      expect(notice).toHaveBeenCalledWith(
        'AI context suggestions are unavailable, so source-language public details are shown. Review and edit them before saving.',
      ),
    );
    expect(field).toHaveValue('Product studio');
  });
});
