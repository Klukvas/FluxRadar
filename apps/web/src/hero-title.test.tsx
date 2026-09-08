// The hero title types itself in. What a typed title must not do is hide the
// message from anyone, reflow the page while it lands, read a cursor out to a
// screen reader, or keep animating for a reader who asked the OS for no motion.
// None of that is visible in a snapshot, so it is pinned here as the contract
// the markup and the stylesheet hold between them. The motion itself is
// verified in a real browser at 1440–360.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { HeroTitle } from './HeroTitle';
import { copy, type Language } from './i18n';

const SRC = join(resolve(process.cwd()), 'src');
const BASE_CSS = readFileSync(join(SRC, 'styles', 'base.css'), 'utf8');
const COMPONENT = readFileSync(join(SRC, 'HeroTitle.tsx'), 'utf8');

afterEach(() => {
  cleanup();
});

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

function renderTitle(language: Language) {
  const hero = copy[language].home.hero;
  return render(<HeroTitle id="home-title" line={hero.titleLine1} emphasis={hero.titleEm} />);
}

describe('hero title markup', () => {
  it.each<[Language, string]>([
    ['en', 'One URL. Every signal.'],
    ['uk', 'Одна адреса. Усі сигнали.'],
  ])('names the %s heading with the complete title', (language, name) => {
    renderTitle(language);
    expect(screen.getByRole('heading', { level: 1, name })).toHaveAttribute('id', 'home-title');
  });

  // The reveal delays the paint, never the content: a reader whose animations
  // never run — or who reaches the page with a screen reader before the first
  // step — still has the whole title in front of them.
  it.each<Language>(['en', 'uk'])(
    'has every character of the %s title on first paint',
    (language) => {
      const hero = copy[language].home.hero;
      const { container } = renderTitle(language);
      const heading = container.querySelector('h1') as HTMLElement;
      // The line break is the only thing between the two lines; nothing else in
      // the heading contributes text, so no cursor can leak into the reading.
      expect(heading.textContent).toBe(`${hero.titleLine1}${hero.titleEm}`);
    },
  );

  // Characters are element children, and an accessible name joins element
  // children with a space: read as it stands, the split title announces
  // "O n e U R L .". The heading names itself instead, and the split copy is
  // scenery a screen reader never reaches.
  it.each<[Language, string]>([
    ['en', 'One URL. Every signal.'],
    ['uk', 'Одна адреса. Усі сигнали.'],
  ])('hides the %s split copy behind the name the heading carries', (language, name) => {
    const { container } = renderTitle(language);
    const heading = container.querySelector('h1') as HTMLElement;
    expect(heading.getAttribute('aria-label')).toBe(name);
    const scenery = container.querySelector('h1 > span');
    expect(scenery?.getAttribute('aria-hidden')).toBe('true');
    expect(scenery?.querySelectorAll('.home__type-char').length).toBeGreaterThan(0);
    // Nothing announces itself twice or announces itself again as it lands.
    expect(heading.getAttribute('aria-live')).toBeNull();
    expect(container.querySelectorAll('[role]')).toHaveLength(0);
  });

  it('keeps the two-colour title markup the page already had', () => {
    const hero = copy.en.home.hero;
    const { container } = renderTitle('en');
    expect(container.querySelector('h1 br')).not.toBeNull();
    expect(container.querySelector('h1 em')?.textContent).toBe(hero.titleEm);
  });

  // One step per character, and the same run of steps continues across the line
  // break after a short pause, so the second line follows the first instead of
  // starting over on top of it.
  it('gives every character its own step, in reading order', () => {
    const { container } = renderTitle('en');
    const steps = Array.from(container.querySelectorAll('.home__type-char')).map((character) =>
      Number(character.getAttribute('style')?.replace(/\D/g, '')),
    );
    expect(steps).toEqual([...steps].sort((first, second) => first - second));
    expect(steps[0]).toBe(0);
    // 'One URL.' is eight characters, and the break holds four steps more.
    expect(steps.at(-1)).toBe(8 + 4 + 'Every signal.'.length - 1);
  });

  it('marks only the last character of the title as the one that keeps the cursor', () => {
    const { container } = renderTitle('uk');
    const last = container.querySelectorAll('.home__type-char--last');
    expect(last).toHaveLength(1);
    expect(last[0]?.textContent).toBe('.');
    expect(container.querySelector('h1 em')?.contains(last[0] as Node)).toBe(true);
  });

  // A reveal driven from JS keeps a timer alive, re-renders the heading dozens
  // of times, and hides the title for as long as its state says so. This one is
  // a stylesheet reading an index off each character.
  it('runs without a timer, a state or a layout measurement', () => {
    expect(COMPONENT).not.toMatch(
      /setInterval|setTimeout|requestAnimationFrame|getBoundingClientRect|offsetWidth|scrollWidth|useEffect|useState/,
    );
  });
});

describe('hero title stylesheet contract', () => {
  it('delays each character by its own step, and never runs the reveal twice', () => {
    const character = block('.home__type-char {');
    expect(character).toMatch(
      /animation: home-type-char var\(--type-char-fade, 90ms\) ease-out\s*\n\s*calc\(var\(--type-step, 0\) \* var\(--type-step-duration, 45ms\)\) backwards;/,
    );
    expect(character).not.toMatch(/infinite/);
    // The pace lives on the heading, so both lines are typed at one speed.
    expect(block('.home h1 {')).toMatch(/--type-step-duration: 45ms;/);
  });

  // Anything but `opacity` would relayout the heading under the reader: a
  // character that starts narrow, clipped or displaced moves the line it is on.
  it('animates nothing that can move the title', () => {
    for (const frames of ['@keyframes home-type-char', '@keyframes home-type-caret']) {
      const animated = block(frames)
        .split('\n')
        .filter((line) => /^\s+[a-z-]+:/.test(line));
      expect(animated.length).toBeGreaterThan(0);
      for (const declaration of animated) {
        expect(declaration.trim()).toMatch(/^opacity:/);
      }
    }
  });

  // The character is visible unless a keyframe says otherwise, so a dropped or
  // unsupported animation leaves the title readable rather than blank.
  it('holds the hidden state in the keyframes, not on the character', () => {
    expect(block('@keyframes home-type-char')).toMatch(/from \{\s*\n\s*opacity: 0;/);
    expect(block('.home__type-char {')).not.toMatch(/opacity:/);
  });

  it('draws the cursor beside the character without giving it room in the line', () => {
    const caret = block('.home__type-char::after {');
    expect(caret).toMatch(/position: absolute;/);
    expect(caret).toMatch(/left: 100%;/);
    // Hidden until its own step arrives, so no cursor is painted ahead of the
    // character it belongs to.
    expect(caret).toMatch(/opacity: 0;/);
  });

  // Regression, and the reason the rule above carries the hidden state: filling
  // the cursor forwards asks `steps(1)` what it resolves to at the very end of
  // its interval, and a delay of `calc(step * 45ms)` beyond about 990ms lands on
  // a progress of 0.9999999999999984 — a hair short of the jump. The step held
  // the *from* value, and every cursor from the 22nd character on stayed painted
  // as a solid block over the end of the title: five of them in Ukrainian, two
  // in English, at every width. Without a fill the cursor falls back to the
  // `opacity: 0` it already has, which cannot land on the wrong side of a jump.
  it('lets the cursor fall back to its own hidden state instead of filling forwards', () => {
    const caret = block('.home__type-char::after {');
    expect(caret).toMatch(/animation: home-type-caret /);
    expect(caret).not.toMatch(/forwards/);
  });

  it('lets the cursor go after a few blinks instead of running for the visit', () => {
    expect(block('.home__type-char--last::after {')).toMatch(
      /animation: home-type-caret-blink 520ms linear\s*\n\s*calc\([^)]*\)[^;]*\) 3 forwards;/,
    );
    expect(BASE_CSS).not.toMatch(/home-type-caret[a-z-]* [^;]*infinite/);
  });
});

describe('hero title with motion turned off', () => {
  const reduced = block('@media (prefers-reduced-motion: reduce) {\n  .home__type-char');

  it('shows the complete title at once rather than a delayed one', () => {
    expect(reduced).toMatch(/\.home__type-char \{\s*\n\s*animation: none;/);
  });

  it('does not draw the cursor at all', () => {
    expect(reduced).toMatch(/\.home__type-char::after \{\s*\n\s*content: none;/);
  });
});
