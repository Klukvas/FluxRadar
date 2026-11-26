import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Scan, ScanModule } from './api';
import { AI_PROCESSING_NOTICE_VERSION } from './ai-processing-notice';
import { ASK_MAX_RETRIES, ASK_RETRY_MS, FreeAiAsk } from './FreeAiAsk';
import { freePreviewCopy } from './free-preview-copy';

// ─── The AI question on a running Free check's progress screen ────────────────
//
// A check started from the address on the public page is launched without its
// AI question, because nobody was shown the consent. The progress screen asks.
// What must hold: nothing is sent before a yes, nothing after a no, and a yes
// given while the check runs is sent only once the check has finished — the
// API adds the answer to a finished check and refuses any other.
// ─────────────────────────────────────────────────────────────────────────────

const t = freePreviewCopy.en;
const PATH = '/scans/scan-auto/free-ai-preview';

const SKIPPED_GEO: ScanModule = {
  module: 'AI SEO / GEO',
  status: 'Not applicable',
  statusReason: 'ConsentMissing',
  coverage: null,
  score: null,
  applicableChecks: null,
  completedApplicableChecks: null,
  usableOutput: false,
  metadata: {},
};

function scanOf(status: string, modules: readonly ScanModule[] = []): Scan {
  return {
    id: 'scan-auto',
    profileId: 'profile-1',
    plan: 'Free',
    domain: 'https://shop.example.com',
    status,
    statusReason: null,
    scope: { includeSubdomains: false },
    rulesetVersion: 'rules-v1',
    progress: { completedModules: 0, totalModules: 2 },
    startedAt: '2026-11-25T10:00:00.000Z',
    completedAt: null,
    createdAt: '2026-11-25T10:00:00.000Z',
    modules,
  } as unknown as Scan;
}

const RUNNING = scanOf('Running');
const FINISHED = scanOf('Completed', [SKIPPED_GEO]);

function ok(): Response {
  return new Response(JSON.stringify({ success: true, data: { queued: true }, error: null }), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(code: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code, message: 'refused' } }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  );
}

function stubFetch(respond: () => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(respond()));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBodies(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
  return fetchMock.mock.calls
    .filter(([input]) => new URL(String(input)).pathname === PATH)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the AI question on a running Free check', () => {
  it('asks with the disclosure beside the button and says only one model is asked', () => {
    const fetchMock = stubFetch(ok);
    render(<FreeAiAsk scan={RUNNING} settled={false} language="en" />);

    expect(screen.getByText(t.ask.oneModel)).toBeInTheDocument();
    const describedBy = screen
      .getByRole('button', { name: t.ask.yes })
      .getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(t.consent.body);
    // Showing the question sends nothing.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('holds a yes given while the check runs and sends it when the check has finished', async () => {
    const fetchMock = stubFetch(ok);
    const view = render(<FreeAiAsk scan={RUNNING} settled={false} language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    expect(screen.getByRole('status')).toHaveTextContent(t.ask.queued);
    expect(sentBodies(fetchMock)).toHaveLength(0);

    view.rerender(<FreeAiAsk scan={FINISHED} settled language="en" />);
    expect(await screen.findByText(t.ask.requested)).toBeInTheDocument();
    // The Free record and nothing else: the API refuses any other body.
    expect(sentBodies(fetchMock)).toEqual([
      { aiConsent: { providers: ['anthropic'], noticeVersion: AI_PROCESSING_NOTICE_VERSION } },
    ]);
  });

  it('sends at once when the check had already finished', async () => {
    const fetchMock = stubFetch(ok);
    render(<FreeAiAsk scan={FINISHED} settled language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    expect(await screen.findByText(t.ask.requested)).toBeInTheDocument();
    expect(sentBodies(fetchMock)).toHaveLength(1);
  });

  it('sends nothing after a no, says so, and keeps the keyboard on the card', () => {
    const fetchMock = stubFetch(ok);
    const view = render(<FreeAiAsk scan={RUNNING} settled={false} language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.no }));
    view.rerender(<FreeAiAsk scan={FINISHED} settled language="en" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(t.ask.declined);
    expect(status.parentElement).toHaveFocus();
    expect(screen.queryByRole('button', { name: t.ask.yes })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves the focus to the answer once yes is pressed', () => {
    stubFetch(ok);
    render(<FreeAiAsk scan={RUNNING} settled={false} language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));

    expect(screen.getByRole('status').parentElement).toHaveFocus();
  });

  // The answer node is remounted when it turns into an alert; the focus must
  // not fall back to the top of the page with it.
  it('keeps the focus on the card when the answer turns into a failure', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(() => refused('FREE_AI_PREVIEW_FREE_ONLY'));
    render(<FreeAiAsk scan={FINISHED} settled language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    const alert = await screen.findByRole('alert');

    expect(alert.parentElement).toHaveFocus();
    errorLog.mockRestore();
  });

  // The screen around the card hides "Open report" and "you can close this page"
  // while a yes waits: leaving would drop it.
  it('says when a yes is waiting to be sent, and when it no longer is', async () => {
    stubFetch(ok);
    const onHeldChange = vi.fn();
    const view = render(
      <FreeAiAsk scan={RUNNING} settled={false} language="en" onHeldChange={onHeldChange} />,
    );
    expect(onHeldChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    expect(onHeldChange).toHaveBeenLastCalledWith(true);

    view.rerender(<FreeAiAsk scan={FINISHED} settled language="en" onHeldChange={onHeldChange} />);
    expect(await screen.findByText(t.ask.requested)).toBeInTheDocument();
    expect(onHeldChange).toHaveBeenLastCalledWith(false);
  });

  it('lets go of the screen when the card goes away while a yes is held', () => {
    stubFetch(ok);
    const onHeldChange = vi.fn();
    const view = render(
      <FreeAiAsk scan={RUNNING} settled={false} language="en" onHeldChange={onHeldChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    expect(onHeldChange).toHaveBeenLastCalledWith(true);

    view.unmount();

    expect(onHeldChange).toHaveBeenLastCalledWith(false);
  });

  it('does not take the focus when the answer is sent on its own', async () => {
    stubFetch(ok);
    const view = render(
      <>
        <FreeAiAsk scan={RUNNING} settled={false} language="en" />
        <button type="button">Elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();

    view.rerender(
      <>
        <FreeAiAsk scan={FINISHED} settled language="en" />
        <button type="button">Elsewhere</button>
      </>,
    );

    expect(await screen.findByText(t.ask.requested)).toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
  });

  it('does not ask at all once the check has finished without a skipped AI row', () => {
    const fetchMock = stubFetch(ok);
    const filled = scanOf('Completed', [
      { ...SKIPPED_GEO, status: 'Completed', statusReason: null },
    ]);
    render(<FreeAiAsk scan={filled} settled language="en" />);

    expect(screen.queryByText(t.ask.heading)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes quietly when the API says this site never gets the answer', async () => {
    stubFetch(() => refused('FREE_AI_PREVIEW_ALLOWLISTED'));
    render(<FreeAiAsk scan={FINISHED} settled language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));

    await waitFor(() => expect(screen.queryByText(t.ask.heading)).toBeNull());
    expect(screen.queryByText(t.ask.failed)).toBeNull();
  });

  it('tries again while the API still reads the check as unfinished, then gives up plainly', async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = stubFetch(() => refused('FREE_AI_PREVIEW_SCAN_NOT_FINISHED'));
    render(<FreeAiAsk scan={FINISHED} settled language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASK_RETRY_MS * (ASK_MAX_RETRIES + 1));
    });

    expect(sentBodies(fetchMock)).toHaveLength(ASK_MAX_RETRIES + 1);
    expect(screen.getByRole('alert')).toHaveTextContent(t.ask.failed);
    errorLog.mockRestore();
  });

  it('does not repeat a refusal that waiting cannot change', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = stubFetch(() => refused('FREE_AI_PREVIEW_FREE_ONLY'));
    render(<FreeAiAsk scan={FINISHED} settled language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    expect(await screen.findByText(t.ask.failed)).toBeInTheDocument();
    expect(sentBodies(fetchMock)).toHaveLength(1);
    errorLog.mockRestore();
  });

  it('reads "already added" as the answer being on its way, not as a failure', async () => {
    stubFetch(() => refused('FREE_AI_PREVIEW_ALREADY_ADDED'));
    render(<FreeAiAsk scan={FINISHED} settled language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    expect(await screen.findByText(t.ask.requested)).toBeInTheDocument();
  });

  // An operator-allowlisted site: its AI row is not the skipped one, and the
  // report has no button, so "you can add it in the report" would be untrue.
  it('closes without sending when the finished check has no skipped AI row to fill', async () => {
    const fetchMock = stubFetch(ok);
    const allowlisted = scanOf('Completed', [
      { ...SKIPPED_GEO, statusReason: 'FreePreviewAllowlistedOrigin' },
    ]);
    const view = render(<FreeAiAsk scan={RUNNING} settled={false} language="en" />);

    fireEvent.click(screen.getByRole('button', { name: t.ask.yes }));
    view.rerender(<FreeAiAsk scan={allowlisted} settled language="en" />);

    await waitFor(() => expect(screen.queryByText(t.ask.heading)).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks nothing of a check that ended without a report', () => {
    stubFetch(ok);
    render(<FreeAiAsk scan={scanOf('Failed')} settled language="en" />);

    expect(screen.queryByText(t.ask.heading)).toBeNull();
  });
});
