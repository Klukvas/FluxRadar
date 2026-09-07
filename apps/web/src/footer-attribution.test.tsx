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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { FLUXLAB_URL, SUPPORT_EMAIL, poweredByFluxLab } from './brand';

// Vitest runs with `apps/web` as its working directory (see blog-page.test.ts).
const SRC = join(resolve(process.cwd()), 'src');
const BASE_CSS = readFileSync(join(SRC, 'styles', 'base.css'), 'utf8');
const TOKENS_CSS = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');

/** The address that was published before support@flux-lab.dev existed. */
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
    expect(SUPPORT_EMAIL).toBe('support@flux-lab.dev');
  });

  it.each([
    ['/faq', signedOut],
    ['/checks', signedOut],
    ['/privacy', signedOut],
    ['/terms', signedOut],
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

describe('Powered by FluxLab attribution', () => {
  it.each([
    ['the home page', '/', signedOut],
    ['the FAQ', '/faq', signedOut],
    ['the coverage page', '/checks', signedOut],
    ['the privacy policy', '/privacy', signedOut],
    ['the terms', '/terms', signedOut],
    ['a signed-in workspace screen', '/profiles', signedIn],
  ])('appears in the footer of %s', async (_label, path, handler) => {
    renderAt(path, handler);

    const link = await screen.findByRole('link', { name: /Powered by FluxLab/ });
    expect(link).toHaveAttribute('href', FLUXLAB_URL);
  });

  it('opens the studio site in a new tab without handing it a window reference', async () => {
    renderAt('/', signedOut);

    const link = await screen.findByRole('link', { name: /Powered by FluxLab/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The new tab is announced, so following the link is not a surprise.
    expect(link).toHaveAccessibleName('Powered by FluxLab (opens in a new tab)');
  });

  it('is translated with the rest of the shell', async () => {
    renderAt('/faq', signedOut);
    await screen.findByRole('link', { name: /Powered by FluxLab/ });

    switchLanguageToUkrainian();

    expect(
      await screen.findByRole('link', { name: new RegExp(poweredByFluxLab.uk) }),
    ).toHaveAttribute('href', FLUXLAB_URL);
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
