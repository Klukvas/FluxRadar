// The coverage strip runs. What a running strip must not do is run off the
// page, say its labels twice to a screen reader, or keep moving for a reader
// who asked the OS for no motion — and none of that is visible in a snapshot,
// so it is pinned here as the contract the CSS and the markup hold between
// them. The motion itself is verified in a real browser at 1440–360.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CoverageTicker } from './CoverageTicker';
import { copy, type Language } from './i18n';

const SRC = join(resolve(process.cwd()), 'src');
const BASE_CSS = readFileSync(join(SRC, 'styles', 'base.css'), 'utf8');
const COMPONENT = readFileSync(join(SRC, 'CoverageTicker.tsx'), 'utf8');

afterEach(() => {
  cleanup();
});

/** The strip's labels in a language, in the order the home page passes them. */
function items(language: Language): string[] {
  const ticker = copy[language].home.ticker;
  return [
    ticker.seo,
    ticker.aiSeo,
    ticker.security,
    ticker.accessibility,
    ticker.reliability,
    ticker.privacy,
  ];
}

/** The declarations of one at-rule or rule, up to its matching close. */
function block(opener: string): string {
  const start = BASE_CSS.indexOf(opener);
  if (start === -1) throw new Error(`base.css has no ${opener}`);
  let depth = 0;
  for (let at = BASE_CSS.indexOf('{', start); at < BASE_CSS.length; at += 1) {
    if (BASE_CSS[at] === '{') depth += 1;
    if (BASE_CSS[at] === '}') {
      depth -= 1;
      if (depth === 0) return BASE_CSS.slice(start, at + 1);
    }
  }
  throw new Error(`base.css never closes ${opener}`);
}

describe('coverage ticker markup', () => {
  it('announces its labels exactly once', () => {
    const labels = items('en');
    render(<CoverageTicker label="FluxRadar audit coverage" items={labels} />);
    const list = screen.getByRole('list', { name: 'FluxRadar audit coverage' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(labels);
    // Roles are queried through the accessibility tree, so the visual second
    // pass must not add a seventh item anywhere on the page.
    expect(screen.getAllByRole('listitem')).toHaveLength(labels.length);
  });

  it('paints the labels twice, so the loop has something to hand over to', () => {
    const labels = items('en');
    const { container } = render(<CoverageTicker label="Coverage" items={labels} />);
    expect(container.querySelectorAll('.home__ticker-group')).toHaveLength(2);
    expect(container.querySelectorAll('.home__ticker-group li')).toHaveLength(labels.length * 2);
  });

  it('hides the second pass from assistive technology', () => {
    const { container } = render(<CoverageTicker label="Coverage" items={items('en')} />);
    const [visible, duplicate] = Array.from(container.querySelectorAll('.home__ticker-group'));
    if (visible === undefined || duplicate === undefined) {
      throw new Error('the strip renders two passes');
    }
    expect(visible.getAttribute('aria-hidden')).toBeNull();
    expect(duplicate.getAttribute('aria-hidden')).toBe('true');
    expect(visible.textContent).toBe(duplicate.textContent);
  });

  it.each<Language>(['en', 'uk'])('renders the %s labels from the dictionary', (language) => {
    const labels = items(language);
    render(<CoverageTicker label={copy[language].home.ticker.ariaLabel} items={labels} />);
    const list = screen.getByRole('list', { name: copy[language].home.ticker.ariaLabel });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(labels);
  });

  // A marquee driven from JS re-measures on every resize and font swap, and
  // keeps a timer alive for as long as the tab is open. This one is CSS.
  it('runs without a timer or a layout measurement', () => {
    expect(COMPONENT).not.toMatch(
      /setInterval|setTimeout|requestAnimationFrame|getBoundingClientRect|offsetWidth|scrollWidth|useEffect|useState/,
    );
  });
});

describe('coverage ticker stylesheet contract', () => {
  it('clips the running track instead of widening the page', () => {
    const ticker = block('.home__ticker {');
    expect(ticker).toMatch(/overflow: hidden;/);
    expect(ticker).toMatch(/max-width: 100%;/);
    // The strip sits inside `.home`, which is the last line of defence against
    // a `max-content` track scrolling the document sideways.
    expect(block('.home {')).toMatch(/overflow: hidden;/);
  });

  it('drives the loop from a linear, infinite animation on the track', () => {
    expect(block('.home__ticker-track {')).toMatch(
      /animation: home-ticker-run [\d.]+s linear infinite;/,
    );
  });

  // Half the track is the second pass, so -50% lands the strip exactly where it
  // started. Any other end value shows a seam.
  it('hands over at exactly half the track', () => {
    const frames = block('@keyframes home-ticker-run');
    expect(frames).toMatch(/from \{\s*transform: translateX\(0\);/);
    expect(frames).toMatch(/to \{\s*transform: translateX\(-50%\);/);
  });

  // Anything but `transform` would relayout or repaint the strip 60 times a
  // second for as long as the page is open.
  it('animates nothing but transform', () => {
    const animated = block('@keyframes home-ticker-run')
      .split('\n')
      .filter((line) => /^\s+[a-z-]+:/.test(line));
    expect(animated.length).toBeGreaterThan(0);
    for (const declaration of animated) {
      expect(declaration.trim()).toMatch(/^transform:/);
    }
  });

  it('stops the strip while it is hovered or holds focus', () => {
    expect(BASE_CSS).toMatch(
      /\.home__ticker:hover \.home__ticker-track,\s*\n\.home__ticker:focus-within \.home__ticker-track \{\s*\n\s*animation-play-state: paused;/,
    );
  });
});

describe('coverage ticker with motion turned off', () => {
  const reduced = block('@media (prefers-reduced-motion: reduce) {\n  .home__ticker-track');

  it('stops the track rather than leaving it mid-slide', () => {
    expect(reduced).toMatch(/\.home__ticker-track \{[^}]*animation: none;/);
    expect(reduced).toMatch(/\.home__ticker-track \{[^}]*transform: none;/);
  });

  // Pinned at zero inside a clipping frame, a single-line track would hide
  // every label past the second. Wrapping keeps all six on the page.
  it('reflows the labels into a wrapped row so all of them stay readable', () => {
    expect(reduced).toMatch(/\.home__ticker-track \{[^}]*flex-wrap: wrap;/);
    expect(reduced).toMatch(/\.home__ticker-track \{[^}]*width: auto;/);
    expect(reduced).toMatch(/\.home__ticker-group \{[^}]*flex-wrap: wrap;/);
    expect(reduced).toMatch(/\.home__ticker-group \{[^}]*min-width: 0;/);
  });

  it('drops the second pass, which has nothing left to hand over to', () => {
    expect(reduced).toMatch(/\.home__ticker-group\[aria-hidden='true'\] \{\s*display: none;/);
  });
});
