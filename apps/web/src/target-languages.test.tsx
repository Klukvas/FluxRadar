// Picking a profile's target languages from a list.
//
// The field was free text: "Українська, російська" and "Ukrainian, Russian"
// reached the AI prompt as two different inputs. The picker stores English
// names, and an older value it does not recognise stays in the profile.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { TargetLanguagesField } from './TargetLanguagesField';
import {
  formatTargetLanguages,
  parseTargetLanguages,
  targetLanguageLabel,
} from './target-languages';

afterEach(cleanup);

describe('target language values', () => {
  it('reads an older Ukrainian free-text value as the listed languages', () => {
    expect(parseTargetLanguages('Українська, російська, англійська')).toEqual([
      'Ukrainian',
      'Russian',
      'English',
    ]);
  });

  it('recognises codes and native names, and keeps what it does not know as written', () => {
    expect(parseTargetLanguages('uk; Deutsch\nKlingon')).toEqual([
      'Ukrainian',
      'German',
      'Klingon',
    ]);
  });

  it('names a language once however often it was spelled', () => {
    expect(parseTargetLanguages('English, english, en')).toEqual(['English']);
  });

  it('shows a stored name in the reader’s language', () => {
    expect(targetLanguageLabel('Ukrainian', 'uk')).toBe('Українська');
    expect(targetLanguageLabel('Klingon', 'uk')).toBe('Klingon');
    expect(formatTargetLanguages(['Ukrainian', 'Polish'])).toBe('Ukrainian, Polish');
  });
});

function Picker(props: { initial: string; values: string[] }) {
  const [value, setValue] = useState(props.initial);
  return (
    <TargetLanguagesField
      label="Target languages"
      value={value}
      onChange={(next) => {
        setValue(next);
        props.values.push(next);
      }}
      placeholder="Choose languages"
      hint="Languages in which potential customers may search for this site."
      language="en"
    />
  );
}

/** The dropdown's trigger, which is also what says how many languages are chosen. */
const trigger = () => screen.getByRole('button', { name: /Target languages/ });

describe('the target language picker', () => {
  it('adds and removes a language by its checkbox and says what is chosen', () => {
    const values: string[] = [];
    render(<Picker initial="" values={values} />);
    expect(screen.getByText('Choose languages')).toBeInTheDocument();
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ukrainian' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Russian' }));
    expect(values.at(-1)).toBe('Ukrainian, Russian');
    expect(screen.getByText('2 chosen: Ukrainian, Russian')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ukrainian' }));
    expect(values.at(-1)).toBe('Russian');
  });

  it('keeps a legacy entry without offering it as a new choice', () => {
    const values: string[] = [];
    render(<Picker initial="Українська, Klingon" values={values} />);
    fireEvent.click(trigger());

    expect(screen.getByRole('checkbox', { name: 'Ukrainian' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Klingon' })).not.toBeInTheDocument();
    expect(screen.getByText(/Previously saved languages: Klingon/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'English' }));
    expect(values.at(-1)).toBe('Ukrainian, Klingon, English');
    fireEvent.click(screen.getByRole('button', { name: 'Remove previously saved languages' }));
    expect(values.at(-1)).toBe('Ukrainian, English');
  });
});
