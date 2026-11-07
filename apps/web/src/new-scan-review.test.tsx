import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { freeReportCopy } from './free-report-copy';
import { App } from './App';
import { saveCookieConsent } from './browser-consent';
import { copy, type Language } from './i18n';
import { freePreviewCopy } from './free-preview-copy';
import { findingsCopy } from './findings-copy';
import { newScanCopy } from './new-scan-copy';
import { choosePlanCard } from './new-scan-test-support';
import { DEFAULT_SCOPE_FORM, profileScanConfigFromForm } from './scan-scope';

const PROFILE = {
  id: 'profile-1',
  name: 'Review site',
  domain: 'https://example.com',
  targetLanguages: 'Ukrainian',
  scanConfig: profileScanConfigFromForm(DEFAULT_SCOPE_FORM, 'Free'),
  scanConfigVersion: 1,
};
const SCAN = {
  id: 'scan-1',
  profileId: PROFILE.id,
  plan: 'Free',
  domain: PROFILE.domain,
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 2 },
  startedAt: null,
  completedAt: '2026-11-07T00:00:00Z',
  createdAt: '2026-11-07T00:00:00Z',
  modules: [],
};
const MODULES = [
  {
    module: 'SEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: null,
    applicableChecks: 4,
    completedApplicableChecks: 4,
    usableOutput: true,
    metadata: {
      freeCheck: true,
      checks: [],
      ruleChecks: ['SEO-ONPAGE-001', 'SEO-ONPAGE-002', 'SEO-ONPAGE-003', 'SEO-TECH-008'].map(
        (ruleId) => ({ ruleId, title: ruleId, applicableTargets: 1, affectedTargets: 0 }),
      ),
    },
  },
  {
    module: 'AI SEO / GEO',
    status: 'Unavailable',
    statusReason: 'ConsentMissing',
    coverage: null,
    score: null,
    usableOutput: false,
    metadata: {},
  },
];
function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    headers: { 'content-type': 'application/json' },
  });
}
function open(
  path: string,
  language: Language = 'en',
  siteLanguages = 'Ukrainian',
  settingsSource: 'saved' | 'last-scan' = 'saved',
) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/auth/me')
      return Promise.resolve(
        envelope({ accountId: 'account-1', email: 'review@example.test', emailVerified: true }),
      );
    if (path === '/profiles')
      return Promise.resolve(
        envelope([
          {
            ...PROFILE,
            targetLanguages: siteLanguages,
            scanConfig: settingsSource === 'saved' ? PROFILE.scanConfig : null,
          },
        ]),
      );
    if (path === '/profiles/profile-1/scans')
      return Promise.resolve(
        envelope(
          settingsSource === 'last-scan'
            ? [{ ...SCAN, scope: { ...SCAN.scope, maxDepth: 3 } }]
            : [],
        ),
      );
    if (path === '/scans/scan-1') return Promise.resolve(envelope(SCAN));
    if (path.endsWith('/dashboard'))
      return Promise.resolve(
        envelope({
          scan: SCAN,
          overall: {
            verdict: 'insufficient_data',
            score: null,
            weightedCoverage: 0,
            moduleWeights: [],
          },
          modules: MODULES,
          geoObservations: [],
        }),
      );
    if (path.endsWith('/issues/summary'))
      return Promise.resolve(envelope({ totalOpen: 0, groups: [] }));
    if (path === '/billing/checkout-config')
      return Promise.resolve(
        envelope({
          provider: 'creem',
          available: true,
          mode: 'test',
          unavailableReason: null,
          plans: ['Basic', 'Complete'].map((plan) => ({
            plan,
            priceUsd: 49,
            currency: 'USD',
            available: true,
          })),
        }),
      );
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  saveCookieConsent({ preferences: true, analytics: false });
  window.localStorage.setItem('fluxradar.language', language);
  window.history.replaceState(null, '', path);
  render(<App />);
  return fetchMock;
}
function summary() {
  return within(screen.getByRole('region', { name: /Your report|Ваш звіт|Ваш отчёт/ }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('report upgrade navigation', () => {
  it.each(['preview', 'upsell', 'seo'] as const)(
    'opens the form at the top from the real %s CTA without resetting control changes',
    async (caller) => {
      const scroll = vi.spyOn(window, 'scrollTo');
      open('/scans/scan-1');
      if (caller === 'seo')
        fireEvent.click(await screen.findByRole('button', { name: copy.en.report.checks.show }));
      const label =
        caller === 'seo'
          ? freeReportCopy.en.upgrade
          : caller === 'preview'
            ? freePreviewCopy.en.preview.unlockAction
            : findingsCopy.en.upsell.action;
      const button = await screen.findByRole('button', { name: label });
      scroll.mockClear();
      fireEvent.click(button);
      await screen.findByText(newScanCopy.en.summary.title);
      expect(window.location.pathname).toBe('/scan');
      expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
      await waitFor(() =>
        expect(document.querySelector('input[name="scan-plan"][value="Complete"]')).toBeChecked(),
      );
      scroll.mockClear();
      choosePlanCard('Free');
      fireEvent.click(screen.getByLabelText(freePreviewCopy.en.consent.checkbox));
      expect(document.querySelector('[name="scan-ai-language"]')).toBeNull();
      expect(scroll).not.toHaveBeenCalled();
    },
  );
});

describe('the Free confirmation summary', () => {
  it.each([
    ['en', 'Claude answer', 'not requested', 'one, in English'],
    ['uk', 'Відповідь Claude', 'не запитується', 'одна, українською'],
    ['ru', 'Ответ Claude', 'не запрашивается', 'один, на русском'],
  ] as const)(
    'shows the real opt-in and chosen language in %s',
    async (language, label, off, expected) => {
      open('/scan', language);
      await screen.findByLabelText(freePreviewCopy[language].consent.checkbox);
      expect(summary().getByText(label).parentElement).toHaveTextContent(off);
      fireEvent.click(screen.getByLabelText(freePreviewCopy[language].consent.checkbox));
      expect(summary().getByText(label).parentElement).toHaveTextContent(expected);
      expect(document.querySelector('[name="scan-ai-language"]')).toBeNull();
      const technical = screen.getByRole('group', {
        name: newScanCopy[language].technicalTitle,
        hidden: true,
      });
      expect(within(technical).getByText(label).parentElement).toHaveTextContent(expected);
      expect(
        within(technical).getByText(copy[language].newScan.launchSummaryAi).parentElement,
      ).toHaveTextContent(
        language === 'en'
          ? 'Full GEO audit not included'
          : language === 'uk'
            ? 'Повна GEO-перевірка не входить'
            : 'Полная GEO-проверка не входит',
      );
      fireEvent.click(screen.getByLabelText(freePreviewCopy[language].consent.checkbox));
      expect(summary().getByText(label).parentElement).toHaveTextContent(off);
      for (const plan of ['Basic', 'Complete']) {
        choosePlanCard(plan);
        await waitFor(() => expect(summary().queryByText(label)).toBeNull());
        expect(within(technical).queryByText(label)).toBeNull();
        expect(
          within(technical).getByText(copy[language].newScan.launchSummaryAi).parentElement,
        ).toHaveTextContent(copy[language].newScan.launchSummaryEnabled);
      }
    },
  );
  it('confirms Russian for a Russian interface', async () => {
    open('/scan', 'ru', 'Russian');
    fireEvent.click(await screen.findByLabelText(freePreviewCopy.ru.consent.checkbox));
    expect(summary().getByText('Ответ Claude').parentElement).toHaveTextContent('один, на русском');
  });
});

describe('saved settings without scan history', () => {
  it.each([
    ['en', 'Loaded this site’s scan settings.'],
    ['uk', 'Завантажено налаштування перевірки для цього сайту.'],
    ['ru', 'Загружены настройки проверки для этого сайта.'],
  ] as const)('does not invent a previous scan in %s', async (language, note) => {
    const fetchMock = open('/scan', language);
    expect(await screen.findByText(note)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input)).pathname === '/profiles/profile-1/scans',
      ),
    ).toBe(false);
  });
});

describe('settings restored from the last scan without a saved configuration', () => {
  it.each([
    ['en', 'Loaded this site’s scan settings.'],
    ['uk', 'Завантажено налаштування перевірки для цього сайту.'],
    ['ru', 'Загружены настройки проверки для этого сайта.'],
  ] as const)(
    'describes loaded settings without claiming they are saved in %s',
    async (language, note) => {
      const fetchMock = open('/scan', language, 'Ukrainian', 'last-scan');
      expect(await screen.findByText(note)).toBeInTheDocument();
      expect(screen.getByText(copy[language].newScan.configurationNewBody)).toBeInTheDocument();
      expect(
        fetchMock.mock.calls.some(
          ([input]) => new URL(String(input)).pathname === '/profiles/profile-1/scans',
        ),
      ).toBe(true);
    },
  );
});
