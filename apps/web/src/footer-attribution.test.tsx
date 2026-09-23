import { saveCookieConsent } from './browser-consent';
// Two outward-facing facts that used to be spelled out in place, and were wrong
// in different ways: the contact address on the public pages was a personal
// gmail account, and nothing anywhere pointed at the studio behind the product.
//
// Both now come from `brand.ts`, so what is worth pinning is not the literals
// alone but that every customer-facing surface reads them — and that the old
// address has not survived anywhere a customer can see it.
//
// happy-dom lays out no CSS, so the layout half of this file asserts on the
// decisions the stylesheet encodes (own row, wrapping footer, declared colour,
// focus ring) rather than on pixels. Geometry is checked in a real browser.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { FLUXLAB_URL, SUPPORT_EMAIL, createdByFluxLab } from './brand';

// Vitest runs with `apps/web` as its working directory (see blog-page.test.ts).
const SRC = join(resolve(process.cwd()), 'src');
const BASE_CSS = readFileSync(join(SRC, 'styles', 'base.css'), 'utf8');
const TOKENS_CSS = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');

/** The personal address that preceded the shared product support mailbox. */
const RETIRED_CONTACT = 'pavlenkoandrey56@gmail.com';

const account = { accountId: 'account-1', email: 'operator@example.com' };

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST_ERROR', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function stubApi(handler: (path: string) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(new URL(String(input)).pathname))),
  );
}

const signedOut = (path: string): Response =>
  path === '/auth/me' ? failure(401, 'session required') : envelope(null);

/** A completed scan and the report the workspace opens for it. */
const reportScan = {
  id: 'scan-1',
  profileId: 'profile-1',
  plan: 'Free',
  domain: 'https://example.com',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-09-06T00:00:00.000Z',
  completedAt: '2026-09-06T00:01:00.000Z',
  createdAt: '2026-09-06T00:00:00.000Z',
  modules: [],
};

function signedInReport(path: string): Response {
  if (path === `/scans/${reportScan.id}`) return envelope(reportScan);
  if (path === `/scans/${reportScan.id}/dashboard`)
    return envelope({
      scan: reportScan,
      overall: {
        verdict: 'insufficient_data',
        score: null,
        weightedCoverage: 0,
        moduleWeights: [],
      },
      modules: [],
    });
  return signedIn(path);
}

function signedIn(path: string): Response {
  if (path === '/auth/me') return envelope(account);
  if (path === '/profiles') return envelope([]);
  if (path === '/scans/active') return envelope(null);
  if (path === '/scans') return envelope([]);
  if (path === '/integrations') return envelope([]);
  return envelope(null);
}

function renderAt(path: string, handler: (path: string) => Response): void {
  window.history.replaceState(null, '', path);
  stubApi(handler);
  render(<App />);
}

function switchLanguageToUkrainian(): void {
  fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
  fireEvent.click(screen.getByRole('option', { name: 'Українська' }));
}

/** Every `.ts`/`.tsx` under `src` that ships to a customer — tests excluded. */
function productionSources(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return [];
    return [path];
  });
}

/** The hex a `--token` resolves to, read from the one file that defines them. */
function token(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(TOKENS_CSS)?.[1];
  if (value === undefined) throw new Error(`tokens.css defines no --${name}`);
  return value;
}

/** The body of a rule, so an assertion cannot match a declaration next door. */
function rule(selector: string): string {
  const start = BASE_CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`base.css has no rule for ${selector}`);
  return BASE_CSS.slice(start, BASE_CSS.indexOf('}', start));
}

/** WCAG 2.1 contrast ratio, 1–21. */
function contrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const packed = Number.parseInt(hex.slice(1), 16);
    const linear = (channel: number): number =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return (
      0.2126 * linear(((packed >> 16) & 0xff) / 255) +
      0.7152 * linear(((packed >> 8) & 0xff) / 255) +
      0.0722 * linear((packed & 0xff) / 255)
    );
  };
  const one = luminance(foreground);
  const other = luminance(background);
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  for (const managed of document.head.querySelectorAll('[data-fluxradar-seo]')) managed.remove();
});

describe('published contact address', () => {
  it('is the shared support mailbox, not a personal account', () => {
    expect(SUPPORT_EMAIL).toBe('support@fluxradar.net');
  });

  it.each([
    ['/faq', signedOut],
    ['/checks', signedOut],
    ['/bot', signedOut],
    ['/privacy', signedOut],
    ['/terms', signedOut],
    ['/cookies', signedOut],
  ])('offers it as a mailto link on %s', async (path, handler) => {
    renderAt(path, handler);

    // A page may publish it more than once — in the document body and again in
    // the footer — and every one of them has to be the mailbox, not a label.
    const links = await screen.findAllByRole('link', { name: SUPPORT_EMAIL });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  });

  it('has no trace of the retired address in customer-facing web source', () => {
    const offenders = productionSources(SRC).filter((path) =>
      readFileSync(path, 'utf8').toLowerCase().includes(RETIRED_CONTACT),
    );
    expect(offenders).toEqual([]);
  });
});

describe('Created by FluxLab attribution', () => {
  // "Працює на FluxLab" said the product *runs on* FluxLab, as if the studio
  // were a platform the service depends on; the English credited its maker.
  // Both lines now say the one true thing, and neither wording survives in
  // customer-facing source.
  it('credits FluxLab as the maker, and means the same in both languages', () => {
    expect(createdByFluxLab.en).toBe('Created by FluxLab');
    expect(createdByFluxLab.uk).toBe('Створено FluxLab');
    const offenders = productionSources(SRC).filter((path) =>
      /Powered by FluxLab|Працює на FluxLab/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['the home page', '/', signedOut],
    ['the FAQ', '/faq', signedOut],
    ['the coverage page', '/checks', signedOut],
    ['the crawler page', '/bot', signedOut],
    ['the privacy policy', '/privacy', signedOut],
    ['the terms', '/terms', signedOut],
    ['a signed-in workspace screen', '/profiles', signedIn],
    ['an open report', `/scans/${reportScan.id}`, signedInReport],
  ])('appears in the footer of %s', async (_label, path, handler) => {
    renderAt(path, handler);

    const link = await screen.findByRole('link', { name: /Created by FluxLab/ });
    expect(link).toHaveAttribute('href', FLUXLAB_URL);
  });

  it('opens the studio site in a new tab without handing it a window reference', async () => {
    renderAt('/', signedOut);

    const link = await screen.findByRole('link', { name: /Created by FluxLab/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The new tab is announced, so following the link is not a surprise.
    expect(link).toHaveAccessibleName('Created by FluxLab (opens in a new tab)');
  });

  it('is translated with the rest of the shell', async () => {
    renderAt('/faq', signedOut);
    await screen.findByRole('link', { name: /Created by FluxLab/ });

    switchLanguageToUkrainian();

    expect(
      await screen.findByRole('link', { name: new RegExp(createdByFluxLab.uk) }),
    ).toHaveAttribute('href', FLUXLAB_URL);
  });
});

// A report was the only page on the site that ended in nothing: the workspace
// shell closed with the studio attribution alone, so an owner reading a report
// had no way out to the coverage page, the policies or the field notes that
// every public page offers.
describe('the site footer on a report', () => {
  it('offers the standing links the public pages end with', async () => {
    renderAt(`/scans/${reportScan.id}`, signedInReport);
    await screen.findByText('Site audit report');

    // Scoped to the footer: the menu bar above links to /faq and /blog too, and
    // the point here is where the reader lands at the *end* of the page.
    const footer = within(document.querySelector('footer') as HTMLElement);
    const links = [
      ['Audit coverage', '/checks'],
      ['FAQ', '/faq'],
      ['Privacy policy', '/privacy'],
      ['Terms of service', '/terms'],
      // FastSpring's activation checklist asks for a clear link to the refund
      // policy, which lives as a section of the terms rather than a page.
      ['Refund policy', '/terms#terms-paid'],
      // The page the crawler's own user agent points at. Somebody whose site
      // refused FluxRadarBot has to be able to reach it from anywhere on the
      // site, not only from the +URL in an access log.
      ['Our crawler', '/bot'],
      ['Field notes', '/blog'],
    ] as const;
    for (const [label, href] of links) {
      expect(footer.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
    // The brand line, and the attribution the footer already carried.
    expect(footer.getByText('FLUXRADAR / BY FLUXLAB')).toBeTruthy();
    expect(footer.getByRole('link', { name: /Created by FluxLab/ })).toBeTruthy();
  });

  it('has exactly one footer, in the shell rather than in the screen', async () => {
    renderAt(`/scans/${reportScan.id}`, signedInReport);
    await screen.findByText('Site audit report');

    expect(document.querySelectorAll('footer')).toHaveLength(1);
    // The shell's, not the report window's: it sits outside the report content.
    expect(document.querySelector('footer')).toHaveClass('desktop__footer');
  });

  it('is translated with the rest of the workspace', async () => {
    saveCookieConsent({ preferences: true, analytics: false });
    window.localStorage.setItem('fluxradar.language', 'uk');
    renderAt(`/scans/${reportScan.id}`, signedInReport);
    await screen.findByText('Звіт аудиту сайту');

    const footer = within(document.querySelector('footer') as HTMLElement);
    expect(footer.getByRole('link', { name: 'Покриття аудиту' })).toHaveAttribute(
      'href',
      '/checks',
    );
    expect(footer.getByRole('link', { name: 'Нотатки з практики' })).toHaveAttribute(
      'href',
      '/blog',
    );
  });
});

// Regression, workspace half: on a viewport taller than a two-card report the
// footer stopped where the content ran out and left bare desktop under it.
describe('workspace footer sits on the floor of a short page', () => {
  it('stretches the desktop so the footer has a floor to reach', () => {
    expect(rule('.workspace-shell')).toMatch(/flex-direction: column;/);
    expect(rule('.workspace-shell > .desktop')).toMatch(/flex: 1 0 auto;/);
    expect(rule('.app-shell')).toMatch(/min-height: 100vh;/);
  });

  it('sinks it the same way the public document footer is sunk', () => {
    const footer = rule('.desktop__footer');
    expect(footer).toMatch(/position: sticky;/);
    expect(footer).toMatch(/top: 100vh;/);
    // It has to be able to wrap, or the links crowd the attribution row.
    expect(footer).toMatch(/flex-wrap: wrap;/);
  });

  // The column that gives it that floor is also a flex item, and a flex item
  // with `margin: 0 auto` is sized to its content rather than stretched. Until
  // it asked for the width, the workspace shrink-wrapped whatever screen was
  // open — the reports list rendered 823px wide in English and 925px in
  // Ukrainian instead of the 1100px the profiles screen kept — and the intro
  // header and this footer narrowed with it.
  it('keeps the desktop full width while it takes the slack', () => {
    expect(rule('.workspace-shell > .desktop')).toMatch(/width: 100%;/);
    // The width the column is actually meant to stop at, left where it was.
    // Read with a leading newline: `.desktop {` is a substring of the rule
    // above, so `rule('.desktop')` would hand back that one instead.
    const desktop = rule('\n.desktop');
    expect(desktop).toMatch(/max-width: 1100px;/);
    expect(desktop).toMatch(/margin: 0 auto;/);
  });

  // The floor was reported missing on the reports list, which is the shortest
  // screen the workspace has — an empty list is a heading and one card. The
  // floor belongs to the shell, so what this pins is that the list is inside
  // that shell: one footer, in the stretched column, in the flex shell.
  it('wraps the reports list in the shell that carries the floor', async () => {
    renderAt('/reports', signedIn);
    await screen.findByText('No reports yet');

    expect(document.querySelectorAll('footer')).toHaveLength(1);
    const footer = document.querySelector('footer') as HTMLElement;
    expect(footer).toHaveClass('desktop__footer');
    // The chain the sticky floor depends on, from the inside out: the sunk
    // footer sits in the column that takes the slack, in the flex shell that
    // gives it slack to take.
    expect(footer.parentElement).toHaveClass('desktop');
    expect(footer.parentElement?.parentElement).toHaveClass('workspace-shell');
  });

  it('stacks brand, links and attribution on a phone', () => {
    const mobile = BASE_CSS.slice(BASE_CSS.indexOf('@media (max-width: 699px)'));
    expect(mobile).toMatch(/\.desktop__footer \{\s*display: grid;/);
    expect(mobile).toMatch(/\.desktop__footer-links \{\s*justify-content: start;/);
  });
});

describe('attribution styling', () => {
  it('takes a row of its own so the footer above it keeps its layout', () => {
    expect(rule('.powered-by')).toMatch(/flex: 0 0 100%;/);
    // A full-width flex item only drops to a new line if the footer wraps.
    expect(rule('.legal-footer')).toMatch(/flex-wrap: wrap;/);
    expect(rule('.home__footer')).toMatch(/flex-wrap: wrap;/);
  });

  it('gives the workspace footer the same rule and type as the public ones', () => {
    const workspace = rule('.desktop__footer');
    expect(workspace).toMatch(/border-top: 1px solid #8c9bb3;/);
    expect(workspace).toMatch(/font: 10px var\(--mono-font\);/);
  });

  // The workspace footer links were the last set on the site with no ring of
  // their own: no rule gives a bare `a` one, so they fell back to whatever the
  // browser draws while `.legal-shell a` and `.powered-by__link` drew green.
  it('rings the workspace footer links the way the public footers are rung', () => {
    const workspace = rule('.desktop__footer a:focus-visible');
    expect(workspace).toMatch(/outline: 2px dotted var\(--term-green\);/);
    expect(workspace).toMatch(/outline-offset: 3px;/);
    // The same ring, not a second look: this is what the public documents draw.
    expect(rule('.legal-shell a:focus-visible')).toMatch(
      /outline: 2px dotted var\(--term-green\);/,
    );
  });

  it('declares a foreground at least as legible as the footer text beside it', () => {
    const declared = /color: (#[0-9a-f]{6});/i.exec(rule('.powered-by .powered-by__link'))?.[1];
    expect(declared).toBeDefined();

    const surface = token('desktop');
    // #d5deeb is what `.legal-footer`/`.home__footer` paint their own text in.
    expect(contrast(declared as string, surface)).toBeGreaterThanOrEqual(
      contrast('#d5deeb', surface),
    );
  });

  it('shows a focus ring of its own, in every footer it appears in', () => {
    expect(rule('.powered-by .powered-by__link:focus-visible')).toMatch(/outline: 2px dotted/);
  });
});

// The last shell on the site with no floor at all. `.legal-shell` and
// `.workspace-shell` were both given one; the marketing home page kept a footer
// that simply ended where the last section did, so a viewport taller than the
// page — a short locale, a zoomed-out desktop — left bare desktop under it.
describe('home footer sits on the floor of a short page', () => {
  it('makes the home shell a column its page stretches to fill', () => {
    expect(rule('.home-shell')).toMatch(/flex-direction: column;/);
    expect(rule('.home-shell > .home')).toMatch(/flex: 1 0 auto;/);
    // Same reason the workspace column needs it: an auto cross-axis margin
    // sizes a flex item to its content instead of stretching it.
    expect(rule('.home-shell > .home')).toMatch(/width: 100%;/);
    expect(rule('.app-shell')).toMatch(/min-height: 100vh;/);
  });

  it('sinks the footer the same way every other footer on the site is sunk', () => {
    const footer = rule('.home__footer');
    expect(footer).toMatch(/position: sticky;/);
    expect(footer).toMatch(/top: 100vh;/);
  });

  // Every shell that renders a footer now expresses the same three decisions,
  // so a new page cannot be added with a footer that floats.
  it('leaves no footer-bearing shell without a floor', () => {
    for (const [shell, main, footer] of [
      ['.home-shell', '.home-shell > .home', '.home__footer'],
      ['.legal-shell', '.legal-main', '.legal-footer'],
      ['.workspace-shell', '.workspace-shell > .desktop', '.desktop__footer'],
    ] as const) {
      expect(rule(shell)).toMatch(/flex-direction: column;/);
      expect(rule(main)).toMatch(/flex: 1 0 auto;/);
      expect(rule(footer)).toMatch(/top: 100vh;/);
    }
  });
});

// A report that is still loading, and one that could not be opened, are ordinary
// workspace screens: they render inside the shell that carries the floor, so the
// footer they end with is the same one and reaches the same place.
describe('the workspace footer survives the report’s loading and error states', () => {
  it('keeps one floored footer while the report is loading', async () => {
    // The dashboard request never settles, so the screen stays on LoadingState.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/dashboard')) return new Promise<Response>(() => undefined);
        return Promise.resolve(signedInReport(path));
      }),
    );
    window.history.replaceState(null, '', `/scans/${reportScan.id}`);
    render(<App />);

    // The report window is open on its loading state, not on a report.
    await screen.findByText('Report dashboard');
    expect(document.querySelector('.loading')).not.toBeNull();
    const footer = document.querySelector('footer') as HTMLElement;
    expect(footer).toHaveClass('desktop__footer');
    expect(footer.parentElement?.parentElement).toHaveClass('workspace-shell');
  });

  it('keeps one floored footer when the report could not be opened', async () => {
    renderAt(`/scans/${reportScan.id}`, (path) =>
      path.endsWith('/dashboard') ? failure(500, 'nope') : signedInReport(path),
    );

    await screen.findByText('This report could not be opened');
    expect(document.querySelectorAll('footer')).toHaveLength(1);
    const footer = document.querySelector('footer') as HTMLElement;
    expect(footer).toHaveClass('desktop__footer');
    expect(footer.parentElement?.parentElement).toHaveClass('workspace-shell');
  });
});

// Regression: on a viewport taller than the document, the footer of a public
// page stopped wherever the text ran out and left the desktop bare beneath it.
describe('public document footer sits on the floor of a short page', () => {
  it('lets the document grow into a viewport its text does not fill', () => {
    expect(rule('.legal-shell')).toMatch(/flex-direction: column;/);
    expect(rule('.legal-main')).toMatch(/flex: 1 0 auto;/);
    // `.app-shell` is what makes the column a viewport tall to begin with.
    expect(rule('.app-shell')).toMatch(/min-height: 100vh;/);
  });

  // A sticky top of one viewport asks for a position below the fold; the main
  // element clamps it back to its own bottom edge, which is the floor of a short
  // page and the end of the flow on a long one. Geometry is checked in a browser.
  it('sinks the footer without moving it on a document that already scrolls', () => {
    const footer = rule('.legal-footer');
    expect(footer).toMatch(/position: sticky;/);
    expect(footer).toMatch(/top: 100vh;/);
    expect(footer).toMatch(/margin-top: 42px;/);
  });
});
