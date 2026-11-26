import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Scan } from './api';
import { freePreviewCopy } from './free-preview-copy';
import { copy } from './i18n';
import { ScanScreen } from './ScanProgress';

// ─── The progress screen around the AI question ──────────────────────────────
//
// A yes given while the check runs is sent by this screen when the check ends.
// Until then the screen must not tell the owner they may close it, and must not
// offer the button that takes them away — either would drop the yes.
// ─────────────────────────────────────────────────────────────────────────────

const t = copy.en.scanProgress;
const ask = freePreviewCopy.en.ask;

function scanOf(overrides: Partial<Scan>): Scan {
  return {
    id: 'scan-auto',
    profileId: 'profile-1',
    plan: 'Free',
    domain: 'https://shop.example.com',
    status: 'Running',
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 0, totalModules: 2 },
    startedAt: new Date().toISOString(),
    completedAt: null,
    createdAt: new Date().toISOString(),
    modules: [],
    ...overrides,
  } as unknown as Scan;
}

function renderScreen(scan: Scan, askFreeAi = true) {
  // The screen polls the scan it shows; answer with the same scan.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: scan, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  return render(
    <ScanScreen
      scan={scan}
      language="en"
      askFreeAi={askFreeAi}
      onUpdate={() => {}}
      onDone={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the progress screen while a yes to the AI question waits', () => {
  it('stops saying the page can be closed once yes is pressed', () => {
    renderScreen(scanOf({}));
    expect(screen.getByText(t.closePage)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: ask.yes }));

    expect(screen.queryByText(t.closePage)).toBeNull();
    expect(screen.getByText(ask.queued)).toBeInTheDocument();
  });

  it('holds back "Open report" while the finished report is still being prepared', () => {
    renderScreen(scanOf({ status: 'Completed', reportReady: false }));
    expect(screen.getByRole('button', { name: t.openReport })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: ask.yes }));

    expect(screen.queryByRole('button', { name: t.openReport })).toBeNull();
  });

  it('sends the held yes when the check ends, then gives "Open report" back', async () => {
    const view = renderScreen(scanOf({}));
    fireEvent.click(screen.getByRole('button', { name: ask.yes }));

    const finished = scanOf({
      status: 'Completed',
      reportReady: true,
      completedAt: new Date().toISOString(),
      modules: [
        {
          module: 'AI SEO / GEO',
          status: 'Not applicable',
          statusReason: 'ConsentMissing',
          coverage: null,
          score: null,
          applicableChecks: null,
          completedApplicableChecks: null,
          usableOutput: false,
          metadata: {},
        },
      ],
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: String(input).endsWith('/free-ai-preview') ? { queued: true } : finished,
            error: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    view.rerender(
      <ScanScreen
        scan={finished}
        language="en"
        askFreeAi
        onUpdate={() => {}}
        onDone={() => {}}
        onReports={() => {}}
        onError={() => {}}
      />,
    );

    expect(await screen.findByText(ask.requested)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/free-ai-preview')),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: t.openReport })).toBeInTheDocument();
  });

  it('leaves the screen as it was for a check that does not ask', () => {
    renderScreen(scanOf({}), false);

    expect(screen.queryByText(ask.heading)).toBeNull();
    expect(screen.getByText(t.closePage)).toBeInTheDocument();
  });

  it('does not ask on a paid scan, whatever it is told', () => {
    renderScreen(scanOf({ plan: 'Basic' }));

    expect(screen.queryByText(ask.heading)).toBeNull();
  });
});
