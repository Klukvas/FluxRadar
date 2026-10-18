// Leftovers of the "audit station" chrome that persona reviews still read as a
// tool for programmers: the station label in the menu bar, the numbered index
// chips on the home sections, and two floating buttons that covered the last
// lines of every page on a phone. Layout is not computed under happy-dom, so the
// phone fix is pinned as the stylesheet decisions it depends on (see
// control-layout.test.tsx); the geometry was checked in a real browser at 375px.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MenuBar } from './components';
import { CookieSettingsButton } from './CookieConsent';
import { HomeScreen } from './HomeScreen';
import { copy, type Language } from './i18n';
import { SupportWidget } from './SupportWidget';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LANGUAGES: readonly Language[] = ['en', 'uk'];
const STATION_WORDING = /STATION|СТАНЦІ|v0\.1/i;

// Vitest runs with `apps/web` as its working directory (see blog-page.test.ts).
function stylesheet(name: string): string {
  return readFileSync(join(resolve(process.cwd()), 'src', 'styles', name), 'utf8');
}

function phoneBlocks(css: string): string {
  const opening = '@media (max-width: 699px) {';
  const blocks: string[] = [];
  for (let at = css.indexOf(opening); at !== -1; at = css.indexOf(opening, at + 1)) {
    blocks.push(css.slice(at, css.indexOf('\n}', at)));
  }
  if (blocks.length === 0) throw new Error('stylesheet has no 699px media query');
  return blocks.join('\n');
}

function renderHome(language: Language) {
  return render(
    <HomeScreen
      signedIn={false}
      onStart={vi.fn()}
      onStartSite={vi.fn()}
      onChoosePlan={vi.fn()}
      onLogin={vi.fn()}
      onRegister={vi.fn()}
      onOpenWorkspace={vi.fn()}
      language={language}
      onLanguageChange={vi.fn()}
      authOpen={false}
      authAction={null}
      authMode="register"
      authError={null}
      onAuthError={vi.fn()}
      onAuthed={vi.fn(async () => undefined)}
      onCloseAuth={vi.fn()}
    />,
  );
}

describe('menu bar without the station label', () => {
  it.each(LANGUAGES)('keeps the language switcher and drops the station line (%s)', (language) => {
    const view = render(
      <MenuBar
        active="home"
        onNavigate={vi.fn()}
        signedIn={false}
        language={language}
        onLanguageChange={vi.fn()}
      />,
    );
    const nav = view.container.querySelector('nav.menubar') as HTMLElement;
    expect(nav.textContent).not.toMatch(STATION_WORDING);
    expect(nav.querySelector('.menubar__system, .menubar__sheet-status')).toBeNull();
    expect(screen.getByRole('combobox', { name: copy[language].nav.language })).toBeInTheDocument();
  });

  it('leaves no stylesheet rule for the removed station label', () => {
    expect(stylesheet('base.css')).not.toMatch(/\.menubar__system|\.menubar__sheet-status/);
  });
});

describe('home sections without index chips', () => {
  it.each(LANGUAGES)('shows each section eyebrow as words only (%s)', (language) => {
    const view = renderHome(language);
    expect(view.container.querySelector('.home__eyebrow-index')).toBeNull();
    const eyebrows = [...view.container.querySelectorAll('.home__eyebrow')];
    expect(eyebrows.length).toBeGreaterThan(0);
    for (const eyebrow of eyebrows) {
      expect(eyebrow.textContent?.trim()).not.toMatch(/^\d/);
    }
    expect(screen.getByText(copy[language].home.capabilities.eyebrow)).toBeInTheDocument();
    expect(view.container.querySelector('.home__footer')?.textContent).not.toMatch(STATION_WORDING);
  });

  it('leaves no stylesheet rule for the removed chip', () => {
    expect(stylesheet('base.css')).not.toMatch(/\.home__eyebrow-index/);
  });
});

describe('floating buttons on a phone', () => {
  it('shrinks the support launcher to an icon at the 699px phone width', () => {
    const phone = phoneBlocks(stylesheet('support.css'));
    expect(phone).toMatch(
      /\.button\.support-launcher \{[^}]*width: var\(--support-launcher-size\);[^}]*padding: 0;/,
    );
    expect(phone).toMatch(/\.support-launcher__label \{\s*display: none;/);
  });

  // In the left corner it covered the hero's left-aligned «Ціни та що входить у
  // звіт ↓» link at 375px; the right corner is free once the cookie launcher
  // sits in the page flow.
  it('moves the support launcher to the bottom-right corner on a phone', () => {
    const phone = phoneBlocks(stylesheet('support.css'));
    expect(phone).toMatch(/\.button\.support-launcher \{\s*left: auto;\s*right: var\(--sp-2\);/);
  });

  // A fixed button covers whatever scrolls under it; the page ends with a strip
  // at least as tall as the button and its gap, so scrolled to the end the last
  // line, the footer and the cookie settings button stay above it.
  it('reserves bottom space for the support launcher on a phone', () => {
    const phone = phoneBlocks(stylesheet('support.css'));
    expect(phone).toMatch(
      /body:has\(\.button\.support-launcher\) \{\s*padding-bottom: calc\(\s*var\(--support-launcher-size\) \+ var\(--sp-2\) \+\s*max\(var\(--sp-2\), env\(safe-area-inset-bottom\)\)\s*\);/,
    );
    expect(stylesheet('support.css')).toMatch(/--support-launcher-size: 44px;/);
  });

  it('drops the cookie settings launcher into the page flow as a small text button', () => {
    const phone = phoneBlocks(stylesheet('cookie-consent.css'));
    expect(phone).toMatch(
      /\.cookie-consent-dock\.cookie-consent-dock--launcher-only \{\s*position: static;/,
    );
    expect(phone).toMatch(
      /\.cookie-consent-dock--launcher-only \.cookie-settings-button \{[^}]*font-size: 12px;/,
    );
  });

  it.each<[Language, string]>([
    ['en', 'Contact support'],
    ['uk', 'Звернутися до підтримки'],
  ])('keeps an accessible name on the icon-only support launcher (%s)', async (language, name) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { available: true }, error: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    render(<SupportWidget language={language} accountEmail={null} />);
    expect(await screen.findByRole('button', { name })).toBeInTheDocument();
  });

  it.each<[Language, string]>([
    ['en', 'Cookie settings'],
    ['uk', 'Налаштування cookies'],
  ])('keeps a visible name on the cookie settings button (%s)', (language, name) => {
    render(<CookieSettingsButton language={language} />);
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
});
