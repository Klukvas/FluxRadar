// The "confirm your email" banner: "Hide" lasts for the browser session, a phone
// sees one short line, and a browser that refuses storage still gets a banner
// that renders and hides.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Account } from './api';
import { accountCopy } from './account-copy';
import type { AppModel } from './app-model';
import { VerifyBanner } from './WorkspaceChrome';

const HIDDEN_KEY = 'fluxradar.verifyBannerHidden';
const OWNER: Account = { accountId: 'account-1', email: 'owner@example.com', emailVerified: false };
const OTHER: Account = { accountId: 'account-2', email: 'other@example.com', emailVerified: false };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function fakeApp(language: 'en' | 'uk' = 'en') {
  const resendFromBanner = vi.fn(() => Promise.resolve());
  const setVerifyBannerHidden = vi.fn();
  // The banner reads three members of the model; the rest is not its business.
  const app = { language, resendFromBanner, setVerifyBannerHidden } as unknown as AppModel;
  return { app, resendFromBanner, setVerifyBannerHidden };
}

describe('verify banner', () => {
  it('keeps the full sentence for screen readers beside a short line for phones', () => {
    const { app } = fakeApp('uk');
    render(<VerifyBanner app={app} account={OWNER} />);
    expect(screen.getByText(accountCopy.uk.banner.pending(OWNER.email))).toBeInTheDocument();
    const short = screen.getByText(accountCopy.uk.banner.short.confirm);
    expect(short).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives the delivery failure its own short line', () => {
    const { app } = fakeApp();
    render(
      <VerifyBanner
        app={app}
        account={{ ...OWNER, emailVerification: { status: 'provider-error' } }}
      />,
    );
    expect(screen.getByText(accountCopy.en.email.deliveryFailed)).toBeInTheDocument();
    expect(screen.getByText(accountCopy.en.banner.short.deliveryFailed)).toBeInTheDocument();
  });

  it('still sends the confirmation again', () => {
    const { app, resendFromBanner } = fakeApp();
    render(<VerifyBanner app={app} account={OWNER} />);
    fireEvent.click(screen.getByRole('button', { name: accountCopy.en.banner.resend }));
    expect(resendFromBanner).toHaveBeenCalledTimes(1);
  });

  it('stays hidden for the rest of the session after Hide, for that account only', () => {
    const { app, setVerifyBannerHidden } = fakeApp();
    const first = render(<VerifyBanner app={app} account={OWNER} />);
    fireEvent.click(screen.getByRole('button', { name: accountCopy.en.banner.dismiss }));
    expect(setVerifyBannerHidden).toHaveBeenCalledWith(true);
    expect(window.sessionStorage.getItem(HIDDEN_KEY)).toBe(OWNER.accountId);
    first.unmount();

    // A reload mounts it again with the in-memory flag reset.
    const again = render(<VerifyBanner app={app} account={OWNER} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    again.unmount();

    // Somebody else signing in on the same tab is still asked.
    render(<VerifyBanner app={app} account={OTHER} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders and hides when the browser refuses session storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const { app, setVerifyBannerHidden } = fakeApp();
    render(<VerifyBanner app={app} account={OWNER} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: accountCopy.en.banner.dismiss }));
    expect(setVerifyBannerHidden).toHaveBeenCalledWith(true);
  });
});

// Layout is not computed in the test DOM; what is pinned is that the phone
// rules exist and reach the page. Geometry is checked in a real browser.
describe('narrow-screen stylesheet', () => {
  const src = join(resolve(process.cwd()), 'src');
  const css = readFileSync(join(src, 'styles', 'narrow-screens.css'), 'utf8');

  it('is imported by the app shell', () => {
    expect(readFileSync(join(src, 'App.tsx'), 'utf8')).toContain(
      "import './styles/narrow-screens.css';",
    );
  });

  it('raises the Issue Center and list controls to 40px on phones', () => {
    const phoneStart = css.indexOf('@media (max-width: 600px)');
    expect(phoneStart).toBeGreaterThan(-1);
    const phone = css.slice(phoneStart);
    for (const selector of [
      '.issue-filters .control',
      '.segmented .segmented__option',
      '.data-table .button',
      '.data-table .control',
    ]) {
      expect(phone).toContain(selector);
    }
    expect(phone).toMatch(/min-height:\s*40px/);
  });

  it('shows the short banner line only on phones', () => {
    const [wide, phone] = css.split('@media (max-width: 600px)');
    expect(wide).toMatch(/\.verify-banner__short\s*\{\s*display:\s*none;/);
    expect(phone).toMatch(/\.verify-banner__short\s*\{\s*display:\s*inline;/);
  });
});
