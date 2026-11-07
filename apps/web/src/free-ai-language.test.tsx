import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { saveCookieConsent } from './browser-consent';
import { freeAiLanguageCopy } from './free-ai-language-copy';
import { defaultAiLanguage, effectiveAiLanguage, resolveSiteLanguage } from './site-language';

// D-237 (owner decision, superseding W1's "reader language wins"): the Free AI
// question is asked in the site's language when its profile names Ukrainian or
// English, else in the UI language at launch; the owner can pick either, and
// the pick is what the request carries.

describe('the AI question language', () => {
  it.each([
    ['site uk, UI en', { targetLanguages: 'Ukrainian' }, 'en', 'uk', 'site'],
    ['site en, UI uk', { targetLanguages: 'English' }, 'uk', 'en', 'site'],
    ['site ru, UI uk', { targetLanguages: 'Russian', language: 'ru' }, 'uk', 'uk', 'interface'],
    ['site ru, UI en', { targetLanguages: 'Russian' }, 'en', 'en', 'interface'],
    ['empty site, UI uk', { targetLanguages: null, language: null }, 'uk', 'uk', 'interface'],
    ['"Russian, Ukrainian", UI en', { targetLanguages: 'Russian, Ukrainian' }, 'en', 'uk', 'site'],
    ['legacy "Українська"', { targetLanguages: 'Українська' }, 'en', 'uk', 'site'],
    ['legacy tag "uk-UA"', { targetLanguages: 'uk-UA' }, 'en', 'uk', 'site'],
    ['only the language field', { targetLanguages: null, language: 'uk' }, 'en', 'uk', 'site'],
    ['no profile, UI uk', null, 'uk', 'uk', 'interface'],
  ] as const)('%s', (_case, profile, ui, language, source) => {
    expect(defaultAiLanguage(profile, ui)).toEqual({ language, source });
  });

  it('lets the explicit choice win over the site and the UI', () => {
    const ukrainianSite = { targetLanguages: 'Ukrainian' };
    expect(effectiveAiLanguage('en', ukrainianSite, 'uk')).toBe('en');
    expect(effectiveAiLanguage('uk', { targetLanguages: 'English' }, 'en')).toBe('uk');
    expect(effectiveAiLanguage(null, ukrainianSite, 'en')).toBe('uk');
  });

  it('names no site language for an unsupported one', () => {
    expect(resolveSiteLanguage({ targetLanguages: 'Russian, Polish', language: 'ru' })).toBeNull();
  });
});

const account = { accountId: 'account-1', email: 'operator@example.com' };
const scan = {
  id: 'scan-1',
  profileId: 'profile-1',
  plan: 'Free' as const,
  domain: 'https://example.com',
  status: 'Running',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 0, totalModules: 1 },
  startedAt: null,
  completedAt: null,
  createdAt: '2026-11-07T00:00:00.000Z',
  modules: [],
};

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const pathOf = (input: RequestInfo | URL): string => new URL(String(input)).pathname;

function renderNewScan(
  language: 'en' | 'uk',
  siteLanguages: string | null,
): ReturnType<typeof vi.fn> {
  const profile = {
    id: 'profile-1',
    name: 'My Site',
    domain: 'https://example.com',
    targetLanguages: siteLanguages,
  };
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = pathOf(input);
    if (path === '/auth/me') return Promise.resolve(envelope(account));
    if (path === '/profiles') return Promise.resolve(envelope([profile]));
    if (path === '/scans/active') return Promise.resolve(envelope(null));
    if (path === '/profiles/profile-1/scans') return Promise.resolve(envelope([]));
    if (path.endsWith('/free-check')) return Promise.resolve(envelope(scan));
    if (path.startsWith('/scans/')) return Promise.resolve(envelope(scan));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  saveCookieConsent({ preferences: true, analytics: false });
  window.localStorage.setItem('fluxradar.language', language);
  window.history.replaceState(null, '', '/scan');
  render(<App />);
  return fetchMock;
}

async function freeCheckBody(
  fetchMock: ReturnType<typeof vi.fn>,
): Promise<Record<string, unknown>> {
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([input]) => pathOf(input).endsWith('/free-check'))).toBe(
      true,
    ),
  );
  const call = fetchMock.mock.calls.find(([input]) => pathOf(input).endsWith('/free-check'));
  return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
}

const CONSENT_EN = 'Ask Anthropic (Claude) one question about my business';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('the Free plan step language selector', () => {
  it('sends no language at all when the AI consent box is left unticked', async () => {
    const fetchMock = renderNewScan('en', 'Ukrainian');
    await screen.findByLabelText(CONSENT_EN);
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));
    const body = await freeCheckBody(fetchMock);
    expect(body).not.toHaveProperty('language');
    expect(body).not.toHaveProperty('aiConsent');
  });

  it('appears only once the AI consent box is ticked', async () => {
    renderNewScan('en', 'Ukrainian');
    const consent = await screen.findByLabelText(CONSENT_EN);
    expect(screen.queryByLabelText('Language of the AI answer')).toBeNull();
    fireEvent.click(consent);
    expect(screen.getByLabelText('Language of the AI answer')).toBeEnabled();
    fireEvent.click(consent);
    expect(screen.queryByLabelText('Language of the AI answer')).toBeNull();
  });

  it('preselects the site language for an English reader and asks in Ukrainian', async () => {
    const fetchMock = renderNewScan('en', 'Ukrainian, English');
    fireEvent.click(await screen.findByLabelText(CONSENT_EN));
    const select = screen.getByRole('combobox', { name: 'Language of the AI answer' });
    expect(select).toHaveValue('uk');
    expect(screen.getByRole('option', { name: 'Українська' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(select).toHaveAccessibleDescription(freeAiLanguageCopy.en.hint.site);

    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));
    expect(await freeCheckBody(fetchMock)).toMatchObject({ language: 'uk' });
  });

  it('sends the owner’s explicit choice instead of the site language', async () => {
    const fetchMock = renderNewScan('en', 'Ukrainian');
    fireEvent.click(await screen.findByLabelText(CONSENT_EN));
    fireEvent.change(screen.getByRole('combobox', { name: 'Language of the AI answer' }), {
      target: { value: 'en' },
    });
    expect(screen.getByText(freeAiLanguageCopy.en.chosen)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));
    expect(await freeCheckBody(fetchMock)).toMatchObject({ language: 'en' });
  });

  it('falls back to the interface language for a Russian site, and says why', async () => {
    const fetchMock = renderNewScan('uk', 'Russian');
    fireEvent.click(
      await screen.findByLabelText('Поставити Anthropic (Claude) одне питання про мій бізнес'),
    );
    const select = screen.getByRole('combobox', { name: 'Мова відповіді ШІ' });
    expect(select).toHaveValue('uk');
    expect(screen.getByText(freeAiLanguageCopy.uk.hint.interface)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Запустити безкоштовну перевірку' }));
    expect(await freeCheckBody(fetchMock)).toMatchObject({ language: 'uk' });
  });
});
