import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { saveCookieConsent } from './browser-consent';
import { freeAiLanguageCopy, freeAiInterfaceHint } from './free-ai-language-copy';
import { choosePlanCard } from './new-scan-test-support';
import { NewScanScreen } from './NewScanScreen';
import type { SiteProfile } from './api';
import type { Language } from './i18n';
import { defaultAiLanguage, effectiveAiLanguage } from './site-language';

describe('GEO language default and explicit choice', () => {
  it.each(['en', 'uk', 'ru'] as const)(
    'uses interface %s regardless of the site profile',
    (language) => {
      expect(
        defaultAiLanguage({ targetLanguages: 'Ukrainian, English', language: 'uk' }, language),
      ).toEqual({ language, source: 'interface' });
      expect(effectiveAiLanguage('ru', { targetLanguages: 'Ukrainian' }, language)).toBe('ru');
    },
  );
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
  language: 'en' | 'uk' | 'ru',
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

describe('Free follows the interface at submission', () => {
  it.each([
    ['en', CONSENT_EN, 'Run free check'],
    [
      'uk',
      'Поставити Anthropic (Claude) одне питання про мій бізнес',
      'Запустити безкоштовну перевірку',
    ],
    [
      'ru',
      'Задать Anthropic (Claude) один вопрос о моём бизнесе',
      'Запустить проверку главной страницы',
    ],
  ] as const)(
    '%s ignores a conflicting Ukrainian site and offers no override',
    async (language, consentLabel, launchLabel) => {
      const fetchMock = renderNewScan(language, 'Ukrainian');
      fireEvent.click(await screen.findByLabelText(consentLabel));
      expect(document.querySelector('[name="scan-ai-language"]')).toBeNull();
      expect(screen.getByText(freeAiInterfaceHint[language])).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: launchLabel }));
      expect(await freeCheckBody(fetchMock)).toMatchObject({ aiLanguage: language });
    },
  );

  it('captures the interface language even with consent off, without sending consent', async () => {
    const fetchMock = renderNewScan('en', 'Ukrainian');
    await screen.findByLabelText(CONSENT_EN);
    fireEvent.click(screen.getByRole('button', { name: 'Run free check' }));
    const body = await freeCheckBody(fetchMock);
    expect(body.aiLanguage).toBe('en');
    expect(body).not.toHaveProperty('aiConsent');
  });
});

const paidProfile = {
  id: 'profile-1',
  name: 'My Site',
  domain: 'https://example.com',
  targetLanguages: 'Ukrainian',
} as SiteProfile;
function paidForm(language: Language) {
  return (
    <NewScanScreen
      accountId="account-1"
      profiles={[paidProfile]}
      selectedProfile={paidProfile}
      internalFreeAccess
      language={language}
      initialPlan="Basic"
      onCreated={() => undefined}
      onCheckoutStarted={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onClose={() => undefined}
      onError={() => undefined}
      onCreateProfile={() => undefined}
    />
  );
}
describe('paid GEO language choice', () => {
  it.each(['en', 'uk', 'ru'] as const)(
    'defaults to interface %s and offers all three languages',
    async (language) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(envelope(null))),
      );
      render(paidForm(language));
      const select = await screen.findByRole('combobox', {
        name: freeAiLanguageCopy[language].label,
      });
      expect(select).toHaveValue(language);
      const cards = document.querySelector('.plan-cards');
      expect(cards?.nextElementSibling?.contains(select)).toBe(true);

      expect([...(select as HTMLSelectElement).options].map((option) => option.value)).toEqual([
        'en',
        'ru',
        'uk',
      ]);
    },
  );
  it('preserves a paid override across Free, Complete and interface switches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(envelope(null))),
    );
    const view = render(paidForm('en'));
    fireEvent.change(await screen.findByRole('combobox', { name: freeAiLanguageCopy.en.label }), {
      target: { value: 'uk' },
    });
    choosePlanCard('Free');
    expect(document.querySelector('[name="scan-ai-language"]')).toBeNull();
    choosePlanCard('Complete');
    expect(screen.getByRole('combobox', { name: freeAiLanguageCopy.en.label })).toHaveValue('uk');
    view.rerender(paidForm('ru'));
    expect(screen.getByRole('combobox', { name: freeAiLanguageCopy.ru.label })).toHaveValue('uk');
  });
});
