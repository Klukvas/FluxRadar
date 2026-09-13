// Deleting a profile from the workspace: typing the site address is the
// confirmation, and a refusal from the server reads as a sentence about the
// owner's own site rather than as server prose.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { copy } from './i18n';
import { ProfileDeletion } from './ProfileDeletion';

const t = copy.en.workspace;
const PROFILE: SiteProfile = { id: 'profile-1', name: 'Example', domain: 'https://example.com' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface RecordedRequest {
  readonly path: string;
  readonly method: string | undefined;
}

function stubFetch(response: Response): readonly RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      requests.push({ path: new URL(String(input)).pathname, method: init.method });
      return Promise.resolve(response);
    }),
  );
  return requests;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderDeletion() {
  const onDeleted = vi.fn<(profile: SiteProfile) => Promise<void>>(() => Promise.resolve());
  const onError = vi.fn<(message: string) => void>();
  render(
    <ProfileDeletion profile={PROFILE} language="en" onDeleted={onDeleted} onError={onError} />,
  );
  const confirmation = screen.getByLabelText(fillLabel('example.com'));
  const button = screen.getByRole('button', { name: t.deleteProfileButton });
  return { onDeleted, onError, confirmation, button };
}

function fillLabel(domain: string): string {
  return t.deleteProfileConfirmLabel.replace('{domain}', domain);
}

describe('profile deletion', () => {
  it('deletes only once the site address has been typed', async () => {
    const requests = stubFetch(jsonResponse({ success: true, data: null, error: null }, 200));
    const { onDeleted, onError, confirmation, button } = renderDeletion();

    expect(button).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: 'example.co' } });
    expect(button).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: ' Example.com ' } });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(PROFILE));
    expect(requests).toEqual([
      { path: expect.stringMatching(/\/profiles\/profile-1$/), method: 'DELETE' },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ['PROFILE_HAS_ACTIVE_SCAN', t.deleteProfileActiveScan],
    ['PROFILE_HAS_OPEN_CHECKOUT', t.deleteProfileOpenCheckout],
    ['PROFILE_HAS_OPEN_REFUND', t.deleteProfileOpenRefund],
  ])("explains a %s refusal in the owner's words and keeps the profile", async (code, sentence) => {
    stubFetch(
      jsonResponse({ success: false, data: null, error: { code, message: 'server prose' } }, 409),
    );
    const { onDeleted, onError, confirmation, button } = renderDeletion();

    fireEvent.change(confirmation, { target: { value: 'example.com' } });
    fireEvent.click(button);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(sentence));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });
});
