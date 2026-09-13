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

  // A label names what is being chosen; what choosing it means belongs under
  // the control, in the same slot a `Field` puts it — not folded back into the
  // label, which is how the scan screen ended up calling its profile picker a
  // public origin.
  it('lets a select explain itself in the hint a field already has', () => {
    render(
      <SelectField
        label="Profile"
        hint="Public pages only."
        value="a"
        onChange={() => undefined}
        options={OPTIONS}
      />,
    );
    const hint = screen.getByText('Public pages only.');
    expect(hint).toHaveClass('field__hint');
    // Inside the label, so the hint is part of the control's accessible name
    // rather than floating text a screen reader never reaches.
    expect(hint.closest('label')).toContainElement(screen.getByLabelText(/Profile/));
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

  // A report used to be a block of grey text on the window's own grey, with no
  // boundary of its own: the only separator was a bottom hairline whose
  // `:last-child` exception matched every row, because each row is the only
  // child of its <li>. The card must not depend on a sibling to be visible.
  it('draws a report as a card with its own boundary, not a hairline between rows', () => {
    const card = BASE_CSS.slice(
      BASE_CSS.indexOf('.report-row {'),
      BASE_CSS.indexOf('.report-row__copy {'),
    );
    expect(card).toMatch(/border: 1px solid var\(--plat-900\);/);
    expect(card).toMatch(/background: #fff;/);
    expect(card).not.toMatch(/border-bottom: 1px solid/);
    expect(BASE_CSS).not.toMatch(/\.report-row:last-child/);
    expect(BASE_CSS).toMatch(/\.report-list \{[^}]*gap: var\(--sp-2\);/);
  });

  // The status is read twice — as the chip's words and as the card's edge — so
  // every colour family the chip can pick has an edge to match it.
  it('gives each status family its own accent edge on the card', () => {
    expect(BASE_CSS).toMatch(/\.report-row \{[^}]*border-left-width: 4px;/);
    for (const kind of ['ok', 'high', 'warning', 'error', 'info', 'neutral']) {
      expect(BASE_CSS).toMatch(new RegExp(`\\.report-row--${kind} \\{\\s*border-left-color:`));
    }
  });

  // Only the button in a card is actionable, so hover marks the card without
  // promising a click — and keyboard focus, which lands on that button, still
  // has to say which of twenty identical buttons is in hand.
  it('marks a hovered card and the card holding keyboard focus', () => {
    expect(BASE_CSS).toMatch(/\.report-row:hover \{[^}]*background: var\(--plat-50\);/);
    expect(BASE_CSS).toMatch(
      /\.report-row:focus-within \{[^}]*outline: 2px solid var\(--selection\);/,
    );
    // The design system animates the cursor, the spinner, the progress zebra
    // and a window opening — nothing else (§9) — and allows no blurred shadow
    // (§11). The hover lift is a hard offset, and no state here animates.
    const card = BASE_CSS.slice(
      BASE_CSS.indexOf('.report-row {'),
      BASE_CSS.indexOf('.report-row__copy {'),
    );
    expect(card).not.toMatch(/transition[a-z-]*:/);
    expect(card).toMatch(/1px 1px 0 rgba\(0, 0, 0, 0\.25\);/);
  });

  // A site address and a timestamp are technical values (§2), and they were the
  // one place on the card still set in the body face.
  it('sets the card’s technical values in the monospace face', () => {
    expect(BASE_CSS).toMatch(/\.report-row__domain \{\s*font: bold 14px\/1\.3 var\(--mono-font\);/);
    expect(BASE_CSS).toMatch(/\.report-row__meta \{[^}]*var\(--mono-font\);/);
    // A hostname has no spaces to break at and can be longer than its column.
    expect(BASE_CSS).toMatch(/\.report-row__domain \{[^}]*overflow-wrap: anywhere;/);
  });

  // A report card reports how the check ended and offers the control that acts
  // on it. The chip sat in the copy column and the button in a column centred
  // on the whole card, so the pair drifted apart the moment a long address
  // wrapped — the finding `.integration-row` was already fixed for.
  it('keeps a report’s status and its action on one aligned line', () => {
    expect(BASE_CSS).toMatch(
      /\.report-row__action \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: var\(--sp-2\);/,
    );
    // And the pair keeps the card's first line — the one holding the address it
    // reports on — rather than centring on copy of an unknown height.
    expect(BASE_CSS).toMatch(/\.report-row \{[^}]*align-items: start;/);
    // Nothing groups the chip with the address any more, so the class that did
    // is gone rather than left behind as a dead rule.
    expect(BASE_CSS).not.toMatch(/\.report-row__identity/);
  });

  // On a phone the action moves under the copy, so the row's gap becomes the
  // vertical space above a 40px tap target.
  it('stacks a report card and keeps its columns unbreakable at both sizes', () => {
    expect(BASE_CSS).toMatch(/\.report-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
    const mobile = BASE_CSS.slice(BASE_CSS.indexOf('@media (max-width: 699px)'));
    expect(mobile).toMatch(
      /\.report-row \{\s*grid-template-columns: minmax\(0, 1fr\);[^}]*gap: var\(--sp-3\);/,
    );
    expect(mobile).toMatch(/\.report-row__action \{\s*justify-content: start;/);
  });

  // An integration row reports a status and offers the control that changes it.
  // The chip sat in the copy column and the button in a column centred on the
  // whole row, so the pair drifted apart as soon as the copy ran past one line.
  it('keeps a connection’s status and its action on one aligned line', () => {
    expect(BASE_CSS).toMatch(
      /\.integration-row__action \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: var\(--sp-2\);/,
    );
    // And the pair keeps the row's first line rather than centring on copy it
    // has no relationship to.
    expect(BASE_CSS).toMatch(/\.integration-row \{[^}]*align-items: start;/);
    const mobile = BASE_CSS.slice(BASE_CSS.indexOf('@media (max-width: 699px)'));
    expect(mobile).toMatch(/\.integration-row \{\s*grid-template-columns: 1fr;/);
    expect(mobile).toMatch(/\.integration-row__action \{\s*justify-content: start;/);
  });

  // The row now holds two paragraphs — what the connection gives you, and which
  // services it covers — so neither may be styled by which one comes first.
  it('styles a connection’s explanation by name, not by position in the row', () => {
    expect(BASE_CSS).not.toMatch(/\.integration-row__copy p \{/);
    expect(BASE_CSS).toMatch(/\.integration-row__why \{[^}]*max-width: 68ch;/);
    expect(BASE_CSS).toMatch(/\.integration-row__services \{[^}]*color: var\(--plat-600\);/);
    // A row label keeps the row's own size; the heading level is structure.
    expect(BASE_CSS).toMatch(/\.integration-row__name \{[^}]*font-size: inherit;/);
  });

  // The window lays its children out in plain flow, so a block ends exactly
  // where the next one starts. The help panel and the first row of section cards
  // met with no space at all and read as one slab; so did the sentence about the
  // Issue Center and the row of buttons under it.
  it('keeps the report’s blocks apart at one consistent step', () => {
    expect(BASE_CSS).toMatch(/\.module-grid \{[^}]*margin-top: var\(--sp-4\);/);
    // The disclosure under the cards stands off them by the same step.
    expect(BASE_CSS).toMatch(/\.plan-scope \{[^}]*margin-top: var\(--sp-4\);/);
  });

  // The rule above used to name one sentence — `.report-help__cta` — so only the
  // report's own action row was ever spaced. Every other window ended with its
  // buttons flush against whatever was above them: "Open report" sat on the
  // bottom edge of the section list on the progress window, and the checkout
  // dialog's controls sat on its terminal panel.
  it('stands every window’s action row off the block above it', () => {
    expect(BASE_CSS).toMatch(
      /\.window:not\(\.window--terminal\) > \.window__content > \* \+ \.button-row \{\s*margin-top: var\(--sp-4\);/,
    );
  });

  // `* + .button-row`, not `.button-row`: a window whose *first* child is a row
  // of controls — the styleguide's chip row — would otherwise be pushed off its
  // own top edge by the same rule that fixes the ones at the bottom.
  it('leaves a window that opens with controls on its own top edge', () => {
    const rule = /\.window__content > (\S+) \+ \.button-row/.exec(BASE_CSS)?.[1];
    expect(rule).toBe('*');
  });

  // Terminal windows are excluded because their content is a grid that already
  // carries a gap; the margin would be added on top of it.
  it('does not double the gap inside a terminal window', () => {
    expect(BASE_CSS).toMatch(/\.window--terminal \.window__content \{[^}]*gap: var\(--sp-3\);/);
    expect(BASE_CSS).toMatch(/\.window:not\(\.window--terminal\) > \.window__content/);
  });

  // A section's check list opens under the card that was clicked, not below the
  // whole grid, where on a Complete report it would land rows away from the
  // click. It spans the grid. Dense packing was tried to fill the cell beside an
  // opened left-column card, but it pulled the next card above the list on
  // screen while the list stayed before it in the markup — a reading order that
  // no longer matched what was shown (WCAG 1.3.2).
  it('opens a check list across the grid, without reordering the cards', () => {
    expect(BASE_CSS).toMatch(/\.module-checks \{[^}]*grid-column: 1 \/ -1;/);
    expect(BASE_CSS).not.toMatch(/grid-auto-flow:[^;]*dense/);
  });

  // `border-color` on the opened card would repaint the status accent on its
  // left edge, and a failed section would stop reading as failed while open.
  it('marks the opened card without repainting its status edge', () => {
    const open = BASE_CSS.slice(
      BASE_CSS.indexOf('.module-card--open {'),
      BASE_CSS.indexOf('.module-card__actions {'),
    );
    expect(open).toMatch(/box-shadow:/);
    expect(open).not.toMatch(/border[a-z-]*:/);
  });

  // A finished section's coverage was drawn with the design system's progress
  // zebra (§7) — the texture that means "still going" — and at 100% beside a
  // Completed chip it read as a bar still filling.
  it('draws a finished measurement flat, and never animates it', () => {
    const result = BASE_CSS.slice(
      BASE_CSS.indexOf('.progress--result .progress__fill {'),
      BASE_CSS.indexOf('.progress__caption {'),
    );
    expect(result).toMatch(/background: #333399;/);
    expect(result).not.toMatch(/repeating-linear-gradient/);
    expect(result).toMatch(/transition: none;/);
    // The live bar keeps the zebra: this is a variant, not a replacement.
    expect(BASE_CSS).toMatch(/\.progress__fill \{[^}]*repeating-linear-gradient/);
  });

  // The card carries its result as its own edge as well as in the chip, so a
  // grid of ten sections can be scanned for the one that failed.
  it('gives each result its own accent edge on a section card', () => {
    expect(BASE_CSS).toMatch(/\.module-card \{[^}]*border-left-width: 4px;/);
    for (const kind of ['ok', 'high', 'warning', 'error', 'info', 'neutral']) {
      expect(BASE_CSS).toMatch(new RegExp(`\\.module-card--${kind} \\{\\s*border-left-color:`));
    }
  });

  // The disclosure holds two lists side by side on a wide window and stacks them
  // on a narrow one, without a breakpoint of its own: a check title is an
  // unbroken technical string and its column has to be allowed to be small.
  it('lets the plan-scope lists stack rather than overflow', () => {
    expect(BASE_CSS).toMatch(
      /\.plan-scope__columns \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(220px, 1fr\)\);/,
    );
    expect(BASE_CSS).toMatch(/\.plan-scope__detail \{[^}]*overflow-wrap: anywhere;/);
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
