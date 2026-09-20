// The home page's first question: which site?
//
// The hero's "Run a free homepage check" used to open a registration form and
// nothing else, so a visitor typed their address for the first time three
// screens later, after a tour and an eight-field profile form. The address is
// now asked for where the promise is made, carried through sign-up, and checked
// the moment the account exists.

import { useId, useState, type FormEvent } from 'react';

import { Button } from './components';
import type { Language } from './i18n';
import { normalizeSiteAddress } from './site-address-input';
import './styles/hero-site-form.css';

const HERO_FORM_COPY: Record<
  Language,
  { label: string; placeholder: string; invalid: string; hint: string }
> = {
  en: {
    label: 'Your website',
    placeholder: 'yoursite.com',
    invalid: 'Enter a public website address, like yoursite.com.',
    hint: 'Free: title, description, headings and indexability of your homepage. No card.',
  },
  uk: {
    label: 'Ваш сайт',
    placeholder: 'yoursite.com',
    invalid: 'Введіть адресу публічного сайту, наприклад yoursite.com.',
    hint: 'Безкоштовно: title, опис, заголовки та індексація головної сторінки. Без картки.',
  },
};

export function HeroSiteForm(props: {
  language: Language;
  submitLabel: string;
  /** The normalised origin the visitor typed, or null when they left the field empty. */
  onStart: (site: string | null) => void;
}) {
  const t = HERO_FORM_COPY[props.language];
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
        {t.label}
      </label>
      <div className="home__site-row">
        <input
          id={inputId}
          className="control technical-input home__site-input"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder={t.placeholder}
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
        {invalid ? t.invalid : t.hint}
      </p>
    </form>
  );
}
