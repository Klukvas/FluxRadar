import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { CRAWLER_EGRESS_IP } from './bot-copy';

// The public /bot page.
//
// Its reader is somebody who found `FluxRadarBot/0.1 (+https://fluxradar.net/bot)`
// in an access log, or whose site refused our crawl and was told so by a scan
// report. Both messages send them to this URL, so the page must exist, must
// render for a stranger with no session, and must carry the three facts they
// came for: the user agent, the address we crawl from, and a rule to paste.

function renderBot(): ReturnType<typeof vi.fn> {
  window.history.replaceState(null, '', '/bot');
  const fetchMock = vi.fn(
    () => new Response(JSON.stringify({ success: true, data: null, error: null })),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('/bot route', () => {
  it('renders without waiting on a session, and asks for nothing else', async () => {
    window.history.replaceState(null, '', '/bot');
    // The session request never answers: a public document must not depend on it.
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'FluxRadarBot' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/bot');
    // The session read the header follows and the support launcher's probe —
    // neither answers here, and the document rendered anyway.
    expect(
      fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])).pathname),
    ).toEqual(['/auth/me', '/support/status']);
  });

  it('states the exact user agent the crawler sends', async () => {
    renderBot();
    await screen.findByRole('heading', { name: 'FluxRadarBot' });

    // The string an owner will paste into a log search or an allowlist. It must
    // match what the crawler actually sends — `user-agent.test.ts` in
    // @fluxradar/crawler pins the other half of that.
    expect(screen.getByText('FluxRadarBot/0.1 (+https://fluxradar.net/bot)')).toBeInTheDocument();
  });

  it('states the address the crawl comes from', async () => {
    renderBot();
    await screen.findByRole('heading', { name: 'FluxRadarBot' });

    expect(screen.getAllByText(CRAWLER_EGRESS_IP).length).toBeGreaterThan(0);
  });

  it('carries a Cloudflare rule and both robots.txt rules, ready to paste', async () => {
    renderBot();
    await screen.findByRole('heading', { name: 'FluxRadarBot' });

    const snippets = document.querySelectorAll('.legal-snippet pre');
    const bodies = [...snippets].map((node) => node.textContent ?? '');
    expect(bodies.some((body) => body.includes('http.user_agent contains "FluxRadarBot"'))).toBe(
      true,
    );
    // The address belongs in the rule itself, not only in the prose above it.
    expect(bodies.some((body) => body.includes(CRAWLER_EGRESS_IP))).toBe(true);
    expect(bodies.some((body) => body.includes('User-agent: FluxRadarBot\nDisallow: /'))).toBe(
      true,
    );
    expect(bodies.some((body) => body.includes('User-agent: FluxRadarBot\nAllow: /'))).toBe(true);
  });

  it('says it obeys robots.txt', async () => {
    renderBot();
    await screen.findByRole('heading', { name: 'FluxRadarBot' });

    expect(screen.getByRole('heading', { name: 'What it respects' })).toBeInTheDocument();
  });

  it('links every index entry to a section that exists on the page', async () => {
    renderBot();
    await screen.findByRole('heading', { name: 'FluxRadarBot' });

    const index = screen.getByRole('navigation', { name: 'CONTENTS' });
    const anchors = within(index).getAllByRole('link');
    expect(anchors.length).toBe(6);
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      expect(href.startsWith('#bot-')).toBe(true);
      expect(document.getElementById(href.slice(1))).not.toBeNull();
    }
  });

  it('is translated, and keeps the same anchors in both languages', async () => {
    renderBot();
    await screen.findByRole('heading', { name: 'FluxRadarBot' });
    const englishAnchors = within(screen.getByRole('navigation', { name: 'CONTENTS' }))
      .getAllByRole('link')
      .map((anchor) => anchor.getAttribute('href'));

    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
    fireEvent.click(screen.getByRole('option', { name: 'Українська' }));

    const ukrainianIndex = screen.getByRole('navigation', { name: 'ЗМІСТ' });
    expect(
      within(ukrainianIndex)
        .getAllByRole('link')
        .map((anchor) => anchor.getAttribute('href')),
    ).toEqual(englishAnchors);
    // The two technical facts are not translated, and must not be.
    expect(screen.getByText('FluxRadarBot/0.1 (+https://fluxradar.net/bot)')).toBeInTheDocument();
    expect(screen.getAllByText(CRAWLER_EGRESS_IP).length).toBeGreaterThan(0);
  });
});
