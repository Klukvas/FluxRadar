// What a control looks like is CSS, and CSS is not laid out under happy-dom.
// What *is* testable is the decision each rule depends on: which field is a
// technical value, and whether the stylesheet still expresses those rules
// positionally. Both were the actual defects, so both are pinned here.
//
// The geometry itself (gaps, insets, overflow at 1440/1024/768/390/360) is
// verified in a real browser, not here.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Field, SelectField } from './components';

// Vitest runs with `apps/web` as its working directory (see blog-page.test.ts).
const BASE_CSS = readFileSync(join(resolve(process.cwd()), 'src', 'styles', 'base.css'), 'utf8');

// `globals` is off, so React Testing Library registers no automatic cleanup;
// every suite here does it explicitly, as the rest of the tests do.
afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

describe('technical fields', () => {
  it('renders a technical value in the monospace face', () => {
    render(<Field label="Site address" technical value="mysite.com" onChange={() => undefined} />);
    expect(screen.getByLabelText('Site address')).toHaveClass('technical-input');
  });

  it('leaves a value written in a person’s own words in the UI face', () => {
    render(<Field label="Display name" value="Product site" onChange={() => undefined} />);
    expect(screen.getByLabelText('Display name')).not.toHaveClass('technical-input');
  });

  it('keeps the error state alongside the technical face', () => {
    render(
      <Field
        label="Site address"
        technical
        error="Not a domain"
        value="???"
        onChange={() => undefined}
      />,
    );
    // Queried by role, not by label: a `.field` wraps its own error text, so
    // the label's accessible name is "Site address Not a domain" here.
    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('technical-input');
    expect(input).toHaveClass('control--error');
  });

  it('marks a select of technical values the same way', () => {
    render(
      <SelectField
        label="Search Console property"
        technical
        value="a"
        onChange={() => undefined}
        options={OPTIONS}
      />,
    );
    expect(screen.getByLabelText('Search Console property')).toHaveClass('technical-input');
  });

  it('leaves a select of human-readable labels in the UI face', () => {
    render(<SelectField label="Profile" value="a" onChange={() => undefined} options={OPTIONS} />);
    expect(screen.getByLabelText('Profile')).not.toHaveClass('technical-input');
  });
});

describe('base.css layout rules', () => {
  // The monospace face used to be applied to whichever field came first in its
  // container, which put a chosen profile name in Monaco and left the site
  // address beside it in the UI font. Nothing may select a control by position
  // again — a field says whether it is technical.
  it('never picks a control by its position among its siblings', () => {
    expect(BASE_CSS).not.toMatch(/\.field:(first|last|nth)-[a-z-]*\([^)]*\)?\s*\.control/);
    expect(BASE_CSS).not.toMatch(/\.field:(first|last)-of-type\s+\.control/);
  });

  // A field label used to sit directly on the control above it, and a "Save"
  // button directly on the select it saves, because nothing inside a panel
  // carried an outer margin.
  it('puts a step of space between anything stacked in a panel', () => {
    expect(BASE_CSS).toMatch(/\.panel > \* \+ \* \{\s*margin-top: var\(--sp-3\);/);
  });

  // A terminal window bleeds its terminal to the frame on purpose; everything
  // else it holds keeps the window inset.
  it('insets a terminal window’s non-terminal content', () => {
    expect(BASE_CSS).toMatch(
      /\.window--terminal \.window__content > \*:not\(\.terminal\) \{\s*margin-inline: var\(--sp-4\);/,
    );
  });

  // Both halves of a split are sized by their content, so the row has to be
  // allowed to break rather than push its action off the window.
  it('lets a heading-and-action row wrap and its text half shrink', () => {
    expect(BASE_CSS).toMatch(/\.split \{[^}]*flex-wrap: wrap;/);
    expect(BASE_CSS).toMatch(/\.split > \* \{\s*min-width: 0;/);
  });

  // A window is a grid item, and a grid item's automatic minimum is its
  // content: a long site address in a title used to widen the whole report.
  it('keeps a window from being widened by its own content', () => {
    expect(BASE_CSS).toMatch(/\.window \{\s*min-width: 0;/);
    expect(BASE_CSS).toMatch(/\.stack \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  });

  // 24px on desktop and 40px on a phone, for buttons and fields alike.
  it('gives buttons and controls the same height at both sizes', () => {
    expect(BASE_CSS).toMatch(/\.button \{[^}]*min-height: 24px;[^}]*line-height: 18px;/);
    expect(BASE_CSS).toMatch(/\.control \{[^}]*min-height: 24px;[^}]*line-height: 18px;/);
    const mobile = BASE_CSS.slice(BASE_CSS.indexOf('@media (max-width: 699px)'));
    expect(mobile).toMatch(/\.button \{\s*min-height: 40px;/);
    expect(mobile).toMatch(/\.control \{\s*min-height: 40px;/);
  });

  // Every row in the open navigation sheet starts on one left edge.
  it('drives the mobile navigation sheet from a single inset token', () => {
    const mobile = BASE_CSS.slice(BASE_CSS.indexOf('@media (max-width: 699px)'));
    expect(mobile).toMatch(/--sheet-inset: var\(--sp-4\);/);
    for (const rule of [
      /\.menubar__sheet-head \{\s*padding: 0 var\(--sheet-inset\);/,
      /\.menubar__group-label \{[^}]*padding: var\(--sp-3\) var\(--sheet-inset\) var\(--sp-1\);/,
      /padding: 0 var\(--sheet-inset\) 0 calc\(var\(--sheet-inset\) - var\(--sheet-rail\)\);/,
    ]) {
      expect(mobile).toMatch(rule);
    }
  });

  // The Ukrainian hints under the hero figures are about twice as long as the
  // English ones; clipped to a single line they lost most of their sentence.
  it('wraps the hero readout hints instead of clipping them', () => {
    const readout = BASE_CSS.slice(
      BASE_CSS.indexOf('.home__readout-cell small'),
      BASE_CSS.indexOf('.home__instrument .terminal'),
    );
    expect(readout).not.toMatch(/white-space: nowrap/);
    expect(readout).toMatch(/overflow-wrap: anywhere/);
  });
});
