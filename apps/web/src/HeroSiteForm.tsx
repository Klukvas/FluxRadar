// The home page's first question: which site?
//
// The hero's call to action used to open a registration form and
// nothing else, so a visitor typed their address for the first time three
// screens later, after a tour and an eight-field profile form. The address is
// now asked for where the promise is made, carried through sign-up, and checked
// the moment the account exists.

import { useId, useState, type FormEvent } from 'react';

import { Button } from './components';
import type { Language } from './i18n';
import { normalizeSiteAddress } from './site-address-input';
import './styles/hero-site-form.css';

// The label, placeholder and note belong to the hero's copy; only the
// validation message is the form's own.
const INVALID_ADDRESS: Record<Language, string> = {
  en: 'Enter a public website address, like yoursite.com.',
  uk: 'Введіть адресу публічного сайту, наприклад yoursite.com.',
};

export function HeroSiteForm(props: {
  language: Language;
  label: string;
  placeholder: string;
  submitLabel: string;
  /** What the check covers, said under the field until an error replaces it. */
  note: string;
  /** The normalised origin the visitor typed, or null when they left the field empty. */
  onStart: (site: string | null) => void;
}) {
  const [address, setAddress] = useState('');
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (address.trim() === '') {
      props.onStart(null);
      return;
    }
    const normalized = normalizeSiteAddress(address);
    if (!normalized.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    props.onStart(normalized.origin);
  };
  return (
    <form className="home__site-form" onSubmit={submit} noValidate>
      <label className="home__site-label" htmlFor={inputId}>
        {props.label}
      </label>
      <div className="home__site-row">
        <input
          id={inputId}
          className="control technical-input home__site-input"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder={props.placeholder}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            if (invalid) setInvalid(false);
          }}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={hintId}
        />
        <Button type="submit" variant="primary">
          {props.submitLabel}
        </Button>
      </div>
      <p
        id={hintId}
        className={invalid ? 'home__site-hint home__site-hint--error' : 'home__site-hint'}
        role={invalid ? 'alert' : undefined}
      >
        {invalid ? INVALID_ADDRESS[props.language] : props.note}
      </p>
    </form>
  );
}
