// The target-language dropdown as something a reader can actually operate.
//
// The list used to be a `details` element: it opened inside the form and pushed
// the six fields under it down the page, and it could only be reached with a
// mouse. It is now an anchored pop-up, so the three ways a pop-up is expected to
// behave have to hold — it stays open while more than one language is ticked, it
// closes on Escape and on a click outside it, and it can be driven from the
// keyboard alone.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { TargetLanguagesField } from './TargetLanguagesField';
import type { Language } from './i18n';

afterEach(cleanup);

function Picker(props: { initial?: string; language?: Language }) {
  const [value, setValue] = useState(props.initial ?? '');
  return (
    <div>
      <button type="button">Outside</button>
      <TargetLanguagesField
        label="Target languages"
        value={value}
        onChange={setValue}
        placeholder="Choose languages"
        hint="Languages in which potential customers may search for this site."
        language={props.language ?? 'en'}
      />
    </div>
  );
}

const trigger = () => screen.getByRole('button', { name: /Target languages/ });
const options = () => screen.queryByRole('group', { name: 'Target languages' });

describe('the target language dropdown', () => {
  it('keeps the list out of the form until it is asked for', () => {
    render(<Picker />);
    expect(options()).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger());
    expect(options()).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', screen.getByRole('group').parentElement?.id);
  });

  it('stays open while several languages are chosen and counts them', () => {
    render(<Picker />);
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ukrainian' }));
    expect(options()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'English' }));
    expect(options()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Russian' }));

    expect(options()).toBeInTheDocument();
    expect(screen.getByText('3 chosen: Ukrainian, English, Russian')).toBeInTheDocument();
  });

  it('closes on a click outside it without dropping what was chosen', () => {
    render(<Picker />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Russian' }));

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(options()).not.toBeInTheDocument();
    expect(screen.getByText('1 chosen: Russian')).toBeInTheDocument();
  });

  it('closes on Escape and gives focus back to the trigger', () => {
    render(<Picker />);
    fireEvent.click(trigger());
    const ukrainian = screen.getByRole('checkbox', { name: 'Ukrainian' });
    ukrainian.focus();

    fireEvent.keyDown(ukrainian, { key: 'Escape' });
    expect(options()).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('opens and moves through the list from the keyboard alone', () => {
    render(<Picker />);
    trigger().focus();

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(options()).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    boxes[0]?.focus();

    fireEvent.keyDown(boxes[0] as HTMLElement, { key: 'ArrowDown' });
    expect(boxes[1]).toHaveFocus();
    fireEvent.keyDown(boxes[1] as HTMLElement, { key: 'ArrowUp' });
    expect(boxes[0]).toHaveFocus();
    fireEvent.keyDown(boxes[0] as HTMLElement, { key: 'End' });
    expect(boxes.at(-1)).toHaveFocus();
    fireEvent.keyDown(boxes.at(-1) as HTMLElement, { key: 'Home' });
    expect(boxes[0]).toHaveFocus();

    // Space and Enter belong to the checkbox under the cursor, so ticking one
    // must not be read as "choose this and close".
    fireEvent.click(boxes[0] as HTMLElement);
    expect(options()).toBeInTheDocument();
  });

  it('closes when focus leaves the list by Tab', () => {
    render(<Picker />);
    fireEvent.click(trigger());
    const first = screen.getAllByRole('checkbox')[0] as HTMLElement;
    first.focus();

    fireEvent.keyDown(first, { key: 'Tab' });
    const outside = screen.getByRole('button', { name: 'Outside' });
    fireEvent.focusOut(first, { relatedTarget: outside });
    outside.focus();
    expect(options()).not.toBeInTheDocument();
  });

  it('shows a stored unsupported value separately and preserves it until removed', () => {
    render(<Picker initial="Klingon, uk" />);
    expect(screen.getByText('2 chosen: Klingon, Ukrainian')).toBeInTheDocument();

    fireEvent.click(trigger());
    expect(screen.queryByRole('checkbox', { name: 'Klingon' })).not.toBeInTheDocument();
    expect(screen.getByText(/Previously saved languages: Klingon/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ukrainian' })).toBeChecked();
  });

  it('keeps the legacy removal action reachable from the last checkbox by Tab', () => {
    render(<Picker initial="Klingon, uk" />);
    fireEvent.click(trigger());
    const last = screen.getAllByRole('checkbox').at(-1) as HTMLElement;
    const remove = screen.getByRole('button', { name: 'Remove previously saved languages' });
    last.focus();

    fireEvent.keyDown(last, { key: 'Tab' });
    remove.focus();
    expect(options()).toBeInTheDocument();
    expect(remove).toHaveFocus();

    fireEvent.click(remove);
    expect(screen.getByText('1 chosen: Ukrainian')).toBeInTheDocument();
  });

  it('names the count in the reader’s language', () => {
    render(<Picker initial="uk" language="uk" />);
    expect(screen.getByText('Обрано 1: Українська')).toBeInTheDocument();
  });
});
