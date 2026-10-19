import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteNextSteps } from './SiteNextSteps';

// Each site's block shows the plan of its last scan. A stored scan of a retired
// plan comes back from the API as a legacy value, which the block has to name
// as archived rather than print the identifier.

const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

function scanOf(plan: string) {
  return {
    id: 'scan-1',
    profileId: profile.id,
    plan,
    domain: 'https://example.com',
    status: 'Completed',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 1, totalModules: 1 },
    startedAt: '2026-09-07T10:00:00.000Z',
    completedAt: '2026-09-07T10:04:00.000Z',
    createdAt: '2026-09-07T10:00:00.000Z',
    modules: [],
  };
}

function envelope<T>(data: T, meta?: object): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta === undefined ? {} : { meta }) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function renderBlocks(plan: string, language: 'en' | 'uk') {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const { pathname } = new URL(String(input));
      if (pathname === `/profiles/${profile.id}/scans`) {
        return Promise.resolve(envelope([scanOf(plan)]));
      }
      if (pathname === '/scans') {
        return Promise.resolve(envelope([], { total: 1, page: 1, limit: 1 }));
      }
      return Promise.resolve(envelope(null));
    }),
  );
  render(
    <SiteNextSteps
      language={language}
      locked={false}
      profiles={[profile]}
      onAddSite={() => undefined}
      onNewScan={() => undefined}
      onOpenScan={() => undefined}
      onRetryScan={() => Promise.resolve()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the plan on a site block', () => {
  it.each([
    ['WebsiteAudit', 'uk', 'Website Audit (архів)'],
    ['WebsiteAudit', 'en', 'Website Audit (archived)'],
    ['Legacy', 'uk', 'Архівний тариф'],
  ] as const)('names the legacy %s plan in %s as %s', async (plan, language, name) => {
    renderBlocks(plan, language);

    expect(await screen.findByText(name)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('WebsiteAudit');
    expect(document.body.textContent).not.toMatch(/\bLegacy\b/);
  });

  it('names a current plan as itself', async () => {
    renderBlocks('Complete', 'en');

    expect(await screen.findByText('Complete')).toBeInTheDocument();
  });
});
