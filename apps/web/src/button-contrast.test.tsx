// A button paints its own background, so the one thing it may not do is take
// its foreground from whatever surface it lands on. On the home page it did:
// `button { color: inherit }` plus `.home { color: #fff }` put white text on
// the button's own platinum face at about 1.2:1, and "Sign in" and "Start with
// a public site" were the two that showed it worst.
//
// happy-dom lays out no CSS, so what is pinned here is the decision behind the
// pixels: the button declares a foreground of its own, and that colour clears
// WCAG AA against every background the button actually takes.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from './components';

const STYLES = join(resolve(process.cwd()), 'src', 'styles');
const BASE_CSS = readFileSync(join(STYLES, 'base.css'), 'utf8');
const TOKENS_CSS = readFileSync(join(STYLES, 'tokens.css'), 'utf8');

afterEach(() => {
  cleanup();
});

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

function channels(hex: string): { red: number; green: number; blue: number } {
  const packed = Number.parseInt(hex.slice(1), 16);
  return {
    red: ((packed >> 16) & 0xff) / 255,
    green: ((packed >> 8) & 0xff) / 255,
    blue: (packed & 0xff) / 255,
  };
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const linear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const { red, green, blue } = channels(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG 2.1 contrast ratio, 1–21. */
function contrast(foreground: string, background: string): number {
  const one = luminance(foreground);
  const other = luminance(background);
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

describe('default button foreground', () => {
  it('declares its own colour instead of inheriting the surface', () => {
    expect(rule('.button')).toMatch(/color: var\(--button-fg\);/);
  });

  it('renders the class that rule targets', () => {
    render(<Button>Sign in</Button>);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toHaveClass('button');
    expect(button).toHaveClass('button--default');
  });

  // Resting, hover and pressed are three different backgrounds under the same
  // text. All three are AA, so the label never dips below readable mid-press.
  it.each([
    ['resting', 'plat-100'],
    ['hover', 'plat-50'],
    ['pressed', 'plat-300'],
  ])('clears AA for normal text against the %s background', (_state, background) => {
    expect(contrast(token('button-fg'), token(background))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // The user asked for blue, and "dark enough to pass" would also be satisfied
  // by black; this keeps the hue where the choice was made.
  it('is a blue, not a neutral dark', () => {
    const { red, green, blue } = channels(token('button-fg'));
    expect(blue).toBeGreaterThan(red);
    expect(blue).toBeGreaterThan(green);
  });

  // The base rule replaces the *inherited* colour, not the deliberate ones. Blue
  // was asked for on the two buttons that were unreadable; the pricing cards
  // keep the black call to action they have always rendered.
  it('leaves the pricing cards their own black foreground', () => {
    expect(rule('.home__plan .button')).toMatch(/color: var\(--plat-900\);/);
    expect(contrast(token('plat-900'), token('plat-100'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // Basic used to take that black by inheriting it from the card, which only
  // worked while `.button` had no colour of its own. Both cards must be named.
  it('names both pricing cards rather than leaving one to inherit', () => {
    expect(BASE_CSS).not.toMatch(/\.home__plan--complete \.button \{[^}]*color:/);
  });

  // Blue and black are both readable; what would be a bug is a third button
  // somewhere still taking its colour from the surface behind it.
  it('is the only default-button colour the home page inherits from nothing', () => {
    expect(rule('.button')).not.toMatch(/color: inherit;/);
  });

  it('keeps a visible focus ring on the button', () => {
    expect(BASE_CSS).toMatch(/button:focus-visible[^{]*\{[^}]*outline: 2px dotted/);
    // The home surface is dark, so the ring is recoloured to stay visible
    // against both the page and the button's own platinum face.
    expect(BASE_CSS).toMatch(
      /\.home button:focus-visible \{\s*\n\s*outline-color: var\(--term-green\);/,
    );
  });
});

describe('primary buttons stay distinct', () => {
  // The green primary carries its own pair, so the shared foreground must not
  // flatten the two variants into one look.
  it.each(['.home__last-call .button--primary', '.home__account-actions .button--primary'])(
    'keeps %s on its own green-on-dark pair',
    (selector) => {
      const body = rule(selector);
      expect(body).toMatch(/background: var\(--term-green\);/);
      expect(body).toMatch(/color: var\(--term-bg\);/);
    },
  );

  it('reads the green primary at AA as well', () => {
    expect(contrast(token('term-bg'), token('term-green'))).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('does not paint a primary in the default foreground', () => {
    expect(token('button-fg')).not.toBe(token('term-bg'));
  });
});

// The hero's copy column sat on the bare desktop blue, where its small text
// measured 3.3–4.4:1. It is a dark panel now, and every colour painted on it is
// read from the stylesheets here, so a later colour change that drops a pair
// below AA fails instead of shipping.
describe('hero copy panel contrast', () => {
  const HERO_CSS = readFileSync(join(STYLES, 'home-hero.css'), 'utf8');
  const FORM_CSS = readFileSync(join(STYLES, 'hero-site-form.css'), 'utf8');

  function ruleIn(css: string, selector: string): string {
    const start = css.indexOf(`\n${selector} {`);
    if (start === -1) throw new Error(`no rule for ${selector}`);
    return css.slice(start, css.indexOf('}', start));
  }

  /** The colour a declaration names, as a six-digit hex. */
  function declared(body: string, property: string): string {
    const value = new RegExp(`\\n\\s*${property}: ([^;]+);`).exec(body)?.[1]?.trim();
    if (value === undefined) throw new Error(`no ${property} in ${body}`);
    const variable = /^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1];
    if (variable !== undefined) return token(variable);
    if (/^#[0-9a-f]{3}$/i.test(value)) {
      return `#${[...value.slice(1)].map((digit) => digit + digit).join('')}`;
    }
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    throw new Error(`${property}: ${value} is not a colour this test can read`);
  }

  const panel = (): string => declared(ruleIn(HERO_CSS, '.home-hero__panel'), 'background');

  it('puts the copy column on the terminal background, in a bordered window', () => {
    const body = ruleIn(HERO_CSS, '.home-hero__panel');
    expect(body).toMatch(/background: var\(--term-bg\);/);
    expect(body).toMatch(/border: 1px solid var\(--plat-900\);/);
    expect(body).toMatch(/box-shadow: 2px 2px 0 /);
  });

  // The title inherits the panel's colour; a colour of its own would escape
  // the pairs checked below.
  it('lets the title take the panel colour', () => {
    expect(rule('.home h1')).not.toMatch(/\n\s*color:/);
  });

  it.each<[string, () => string]>([
    ['title and panel text', () => declared(ruleIn(HERO_CSS, '.home-hero__panel'), 'color')],
    ['lede', () => declared(rule('.home__lede'), 'color')],
    ['form label', () => declared(ruleIn(FORM_CSS, '.home__site-label'), 'color')],
    ['note under the form', () => declared(ruleIn(FORM_CSS, '.home__site-hint'), 'color')],
    ['invalid-address error', () => declared(ruleIn(FORM_CSS, '.home__site-hint--error'), 'color')],
    ['trust list', () => declared(ruleIn(HERO_CSS, '.home-hero__trust'), 'color')],
    ['trust tick', () => declared(ruleIn(HERO_CSS, '.home-hero__check'), 'color')],
    ['pricing link', () => declared(rule('.home__text-action'), 'color')],
    ['pricing link on hover', () => declared(rule('.home__text-action:hover'), 'color')],
  ])('reads the %s at AA on the panel', (_name, colour) => {
    expect(contrast(colour(), panel())).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // The placeholder sits on the field's own white face, not on the panel.
  it('reads the field placeholder at AA on the field', () => {
    const placeholder = ruleIn(FORM_CSS, '.home__site-input::placeholder');
    expect(placeholder).toMatch(/opacity: 1;/);
    const field = declared(ruleIn(FORM_CSS, '.home__site-input'), 'background');
    expect(contrast(declared(placeholder, 'color'), field)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // Focus rings and the invalid outline are non-text indicators: 3:1.
  it.each<[string, () => string]>([
    [
      'link and button focus ring',
      () => declared(rule('.home a:focus-visible,\n.home button:focus-visible'), 'outline-color'),
    ],
    [
      'field focus ring',
      () => declared(ruleIn(HERO_CSS, '.home-hero__panel input:focus-visible'), 'outline-color'),
    ],
    ['invalid-field outline', () => token('term-red')],
  ])('keeps the %s visible on the panel', (_name, colour) => {
    expect(contrast(colour(), panel())).toBeGreaterThanOrEqual(3);
  });

  it('draws the invalid-field outline in --term-red', () => {
    expect(ruleIn(FORM_CSS, ".home__site-input[aria-invalid='true']")).toMatch(
      /outline: 2px solid var\(--term-red\);/,
    );
  });
});
