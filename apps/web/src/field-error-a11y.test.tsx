import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Field } from './components';

// How a rejected field says which message is about it.
//
// `role="alert"` announces the message once, at the moment it appears. Someone
// who tabs back to the field afterwards — the usual way a form is corrected —
// had nothing left: the control said it was invalid and never said why. The
// message is now the input's own description, so it is read out with the field
// every time the field is reached, and a screen with several rejected fields
// gives each one its own message rather than all of them the first.

const MESSAGE = 'Enter a whole number of pages, 1 or more.';

afterEach(cleanup);

/** The description ties the message to the control by id; this is that element. */
function describedElement(input: HTMLElement): HTMLElement | null {
  const id = input.getAttribute('aria-describedby');
  return id === null ? null : document.getElementById(id);
}

describe('a field carrying a rejected value', () => {
  it('reads its message as the input own description', () => {
    render(<Field label="Maximum pages" value="0" onChange={() => undefined} error={MESSAGE} />);

    const input = screen.getByRole('textbox', { name: /^Maximum pages/ });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(MESSAGE);
    expect(describedElement(input)).toBe(screen.getByRole('alert'));
  });

  it('keeps the same id when the message changes, so the link never dangles', () => {
    const { rerender } = render(
      <Field label="Maximum pages" value="0" onChange={() => undefined} error={MESSAGE} />,
    );
    const before = screen
      .getByRole('textbox', { name: /^Maximum pages/ })
      .getAttribute('aria-describedby');

    rerender(
      <Field label="Maximum pages" value="-3" onChange={() => undefined} error="Try again." />,
    );

    const input = screen.getByRole('textbox', { name: /^Maximum pages/ });
    expect(input.getAttribute('aria-describedby')).toBe(before);
    expect(describedElement(input)).toHaveTextContent('Try again.');
  });

  it('gives two rejected fields two different messages', () => {
    render(
      <>
        <Field label="Maximum pages" value="0" onChange={() => undefined} error={MESSAGE} />
        <Field
          label="Maximum crawl depth"
          value="-1"
          onChange={() => undefined}
          error="Enter a whole crawl depth, 0 or more."
        />
      </>,
    );

    const pages = screen.getByRole('textbox', { name: /^Maximum pages/ });
    const depth = screen.getByRole('textbox', { name: /^Maximum crawl depth/ });
    expect(pages.getAttribute('aria-describedby')).not.toBe(depth.getAttribute('aria-describedby'));
    expect(pages).toHaveAccessibleDescription(MESSAGE);
    expect(depth).toHaveAccessibleDescription('Enter a whole crawl depth, 0 or more.');
  });
});

describe('a field with nothing wrong with it', () => {
  it('describes nothing and claims nothing', () => {
    render(
      <Field
        label="Site address"
        value="https://example.com"
        onChange={() => undefined}
        hint="The public origin to check."
      />,
    );

    const input = screen.getByRole('textbox', { name: /^Site address/ });
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // An empty string is not a message: it would render an alert with nothing in
  // it and point the field at it.
  it('treats an empty message as no message', () => {
    render(<Field label="Site address" value="" onChange={() => undefined} error="" />);

    const input = screen.getByRole('textbox', { name: /^Site address/ });
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');
  });
});
