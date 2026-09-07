import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// The public /faq page has to answer, in plain language, what every FluxRadar
// check looks at and where the honest limits are. These tests assert on the
// load-bearing claims — the ones a buyer would act on — rather than on whole
// paragraphs, so the copy can be edited without breaking the suite.

function stubApi(handler: (path: string) => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(handler(new URL(String(input)).pathname)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderFaq(): ReturnType<typeof vi.fn> {
  window.history.replaceState(null, '', '/faq');
  const fetchMock = stubApi(
    () => new Response(JSON.stringify({ success: true, data: null, error: null })),
  );
  render(<App />);
  return fetchMock;
}

function switchLanguageToUkrainian() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
  fireEvent.click(screen.getByRole('option', { name: 'Українська' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('/faq route', () => {
  it('renders the FAQ for a visitor with no account and no session request', async () => {
    const fetchMock = renderFaq();

    expect(
      await screen.findByRole('heading', { name: 'Every check, explained in plain language' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/faq');
    // A public document must not depend on being signed in.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('links every index entry to a section that exists on the page', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    const index = screen.getByRole('navigation', { name: 'CONTENTS' });
    const anchors = within(index).getAllByRole('link');
    expect(anchors.length).toBeGreaterThanOrEqual(10);
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href.startsWith('#faq-')).toBe(true);
      expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
  });

  it('offers a way back to the home page and the full coverage document', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(screen.getByRole('link', { name: /Back to home/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Audit coverage' })).toHaveAttribute('href', '/checks');
  });
});

// Regression: /faq shipped the workspace header. A visitor with no account met
// four controls they could not use (Profiles, Scan, Reports, Integrations), and
// between the burger breakpoint and roughly 1000px that row scrolled sideways
// inside the bar and clipped its last items — the Blog link among them.
describe('/faq header is the public one', () => {
  function headerNav(): HTMLElement {
    return screen.getByRole('navigation', { name: 'Site menu' });
  }

  it('offers exactly the destinations a reader without an account can reach', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    const links = within(headerNav()).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/', '/faq', '/blog']);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'FluxRadar',
      'Home',
      'FAQ',
      'Blog',
    ]);
  });

  it('carries no workspace control a signed-out reader could not use', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    const nav = headerNav();
    for (const label of ['Profiles', 'Scan', 'Reports', 'Integrations']) {
      expect(within(nav).queryByRole('button', { name: label })).toBeNull();
    }
    // The only header buttons left are the burger and the language combobox,
    // and neither of those is ever disabled.
    for (const button of within(nav).getAllByRole('button')) {
      expect(button).not.toBeDisabled();
    }
  });

  it('tells a screen reader which of the three pages is open', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    const nav = headerNav();
    expect(within(nav).getByRole('link', { name: 'FAQ' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the language switch the rest of the site uses', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    switchLanguageToUkrainian();

    const nav = screen.getByRole('navigation', { name: 'Site menu' });
    expect(within(nav).getByRole('link', { name: 'Головна' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Блог' })).toHaveAttribute('href', '/blog');
  });
});

describe('/faq content — what each check does', () => {
  it('explains the SEO module concretely', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    const section = screen.getByRole('heading', {
      name: 'SEO — being found by search engines',
    }).parentElement as HTMLElement;
    expect(within(section).getByText(/Sixteen rule-based checks/i)).toBeInTheDocument();
    expect(within(section).getByText(/canonical tags/i)).toBeInTheDocument();
    // It must not promise ranking data the scan cannot produce.
    expect(within(section).getByText(/Not from a scan/i)).toBeInTheDocument();
  });

  it('names the AI crawlers it checks and keeps provider visibility optional', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(screen.getByText(/GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot/)).toBeInTheDocument();
    expect(screen.getByText(/only if you switch it on for that scan/i)).toBeInTheDocument();
  });

  it('describes security as a passive OWASP ASVS profile, not a penetration test', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(
      screen.getByRole('heading', { name: 'Security — the public OWASP ASVS profile' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no fuzzing, no injection attempt/i)).toBeInTheDocument();
    expect(screen.getByText(/does not claim ASVS compliance on your behalf/i)).toBeInTheDocument();
  });

  it('names the accessibility standards and refuses to claim conformance', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(
      screen.getByRole('heading', {
        name: 'Accessibility — WCAG 2.2, EN 301 549, Section 508',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/EN 301 549 \(the European public-sector requirement\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/no automated tool can honestly offer that/i)).toBeInTheDocument();
  });

  it('explains structured data and social previews', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(screen.getByText(/machine-readable block \(JSON-LD\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Open Graph and card tags/i)).toBeInTheDocument();
  });

  it('explains the privacy and consent signals without claiming a GDPR audit', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(screen.getByText(/does not click a banner/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Is this a GDPR audit?' })).toBeInTheDocument();
  });

  it('is explicit that Core Web Vitals come from Google data, not from the crawler', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(
      screen.getByRole('heading', { name: 'Do you measure Core Web Vitals?' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Not from our own crawler/i)).toBeInTheDocument();
    expect(screen.getByText(/PageSpeed Insights and field metrics/i)).toBeInTheDocument();
    expect(
      screen.getByText(/reported as unavailable rather than filled in with a guess/i),
    ).toBeInTheDocument();
  });

  it('separates what is public from what needs a connected data source', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(
      screen.getByRole('heading', { name: 'What is public, and what needs a connection' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/needs nothing from you but a public address/i)).toBeInTheDocument();
    // Named in the SEO answer too, so both mentions are expected here.
    expect(screen.getAllByText(/Google Search Console or Bing Webmaster Tools/)).toHaveLength(2);
    expect(screen.getByText(/instead of inventing a number/i)).toBeInTheDocument();
  });

  it('explains the profile, scan and report workflow', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(screen.getByRole('heading', { name: 'What is a profile?' })).toBeInTheDocument();
    expect(screen.getByText(/does not start a scan and does not charge you/i)).toBeInTheDocument();
    expect(screen.getByText(/Basic results are kept for 30 days/i)).toBeInTheDocument();
  });

  it('states the price of both products and that Complete has no add-on', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    expect(screen.getByText(/Basic \(\$55\)/)).toBeInTheDocument();
    expect(screen.getByText(/Complete \(\$120\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/no extra "full audit" item to buy on top of Complete/i),
    ).toBeInTheDocument();
  });
});

describe('/faq content — Ukrainian', () => {
  it('renders the same sections in Ukrainian after switching language', async () => {
    renderFaq();
    await screen.findByRole('heading', { name: 'Every check, explained in plain language' });

    switchLanguageToUkrainian();

    expect(
      screen.getByRole('heading', { name: 'Кожна перевірка простими словами' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Безпека — публічний профіль OWASP ASVS' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Доступність — WCAG 2.2, EN 301 549, Section 508' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Шістнадцять правил/)).toBeInTheDocument();
    expect(screen.getByText(/Не власним обходом/)).toBeInTheDocument();
    expect(screen.getAllByText(/Google Search Console або Bing Webmaster Tools/)).toHaveLength(2);
    // The Ukrainian page must be a real translation, not English fallback text.
    expect(screen.queryByText(/Sixteen rule-based checks/i)).not.toBeInTheDocument();
  });
});
