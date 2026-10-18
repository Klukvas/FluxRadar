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
import { copy, type Language } from './i18n';

afterEach(() => {
  cleanup();
});

const LANGUAGES: readonly Language[] = ['en', 'uk'];
const STATION_WORDING = /STATION|СТАНЦІ|v0\.1/i;

// Vitest runs with `apps/web` as its working directory (see blog-page.test.ts).
function stylesheet(name: string): string {
  return readFileSync(join(resolve(process.cwd()), 'src', 'styles', name), 'utf8');
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
