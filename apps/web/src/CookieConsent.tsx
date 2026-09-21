import { useEffect, useId, useState } from 'react';

import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_KEY,
  EVERYTHING_ALLOWED,
  NECESSARY_ONLY,
  analyticsAllowed,
  preferencesAllowed,
  readCookieConsent,
  saveCookieConsent,
  type CookieConsentChoice,
} from './browser-consent';
import { Checkbox } from './components';
import { cookieCopy } from './cookie-copy';
import type { Language } from './i18n';
import './styles/cookie-consent.css';

type CookieConsentProps = { readonly language: Language };
const OPEN_SETTINGS_EVENT = 'fluxradar:open-cookie-settings';
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * What the checkboxes start from: the visitor's standing permissions, so
 * reopening the settings shows the choice they made rather than a blank form.
 * Nothing is ticked for someone who has not chosen yet.
 */
function standingChoice(): CookieConsentChoice {
  return { preferences: preferencesAllowed(), analytics: analyticsAllowed() };
}

function allowsEverything(): boolean {
  const consent = readCookieConsent();
  return consent !== null && consent.preferences && consent.analytics;
}

function rememberLanguage(language: Language): boolean {
  try {
    window.localStorage.setItem('fluxradar.language', language);
    return true;
  } catch {
    return false;
  }
}

export function CookieSettingsButton({ language }: CookieConsentProps): React.JSX.Element {
  return (
    <button
      className="button cookie-settings-button"
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))}
    >
      {cookieCopy[language].settings}
    </button>
  );
}

export function CookieConsent({ language }: CookieConsentProps): React.JSX.Element {
  const titleId = useId();
  const preferencesHintId = useId();
  const analyticsHintId = useId();
  const text = cookieCopy[language];
  const [isOpen, setIsOpen] = useState(() => readCookieConsent() === null);
  // The floating launcher is there so a visitor can change their choice. Once
  // everything is allowed it only covers the page, so it steps aside; withdrawal
  // stays one click away on the cookie policy page every footer links to.
  const [isEverythingAllowed, setIsEverythingAllowed] = useState(allowsEverything);
  const [draft, setDraft] = useState<CookieConsentChoice>(standingChoice);
  const [error, setError] = useState<'saveError' | 'languageError' | null>(null);

  useEffect(() => {
    let expiryTimer: number | undefined;
    const sync = () => {
      window.clearTimeout(expiryTimer);
      const consent = readCookieConsent();
      setIsOpen(consent === null);
      setIsEverythingAllowed(allowsEverything());
      setDraft(standingChoice());
      setError(null);
      if (consent !== null) {
        expiryTimer = window.setTimeout(
          sync,
          Math.min(consent.expiresAt - Date.now(), MAX_TIMEOUT_MS),
        );
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === COOKIE_CONSENT_KEY || event.key === null) sync();
    };
    const open = () => {
      setDraft(standingChoice());
      setIsOpen(true);
    };
    const checkExpiry = () => {
      if (readCookieConsent() === null) sync();
    };
    sync();
    window.addEventListener('storage', onStorage);
    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, sync);
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    return () => {
      window.clearTimeout(expiryTimer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, sync);
      window.removeEventListener(OPEN_SETTINGS_EVENT, open);
      window.removeEventListener('focus', checkExpiry);
      document.removeEventListener('visibilitychange', checkExpiry);
    };
  }, []);

  function choose(choice: CookieConsentChoice): void {
    if (!saveCookieConsent(choice)) {
      setIsOpen(true);
      setError('saveError');
      return;
    }
    if (choice.preferences && !rememberLanguage(language)) {
      // The language is the whole of the preferences category: if it cannot be
      // stored, the category is not in effect, and the record must not say it is.
      saveCookieConsent({ ...choice, preferences: false });
      setIsOpen(true);
      setError('languageError');
      return;
    }
    setError(null);
    setIsOpen(false);
  }

  const showsLauncher = !isOpen && !isEverythingAllowed;

  return (
    <div className="cookie-consent-dock">
      {showsLauncher && (
        <div className="cookie-settings-launcher">
          <CookieSettingsButton language={language} />
        </div>
      )}
      {isOpen && (
        <section className="cookie-consent" aria-labelledby={titleId}>
          <div className="cookie-consent__titlebar">
            <h2 id={titleId}>{text.title}</h2>
          </div>
          <div className="cookie-consent__body">
            <p>{text.description}</p>
            <fieldset className="cookie-consent__options">
              <legend>{text.optionalLegend}</legend>
              <Checkbox
                label={text.preferences}
                checked={draft.preferences}
                describedBy={preferencesHintId}
                onChange={(preferences) => setDraft({ ...draft, preferences })}
              />
              <p id={preferencesHintId} className="cookie-consent__hint">
                {text.preferencesHint}
              </p>
              <Checkbox
                label={text.analytics}
                checked={draft.analytics}
                describedBy={analyticsHintId}
                onChange={(analytics) => setDraft({ ...draft, analytics })}
              />
              <p id={analyticsHintId} className="cookie-consent__hint">
                {text.analyticsHint}
              </p>
            </fieldset>
            <p>{text.duration}</p>
            <a href={`/cookies?lang=${language}`}>{text.details}</a>
            {error !== null && (
              <p className="cookie-consent__error" role="alert">
                {text[error]}
              </p>
            )}
            <div className="cookie-consent__actions">
              <button className="button" type="button" onClick={() => choose(NECESSARY_ONLY)}>
                {text.necessary}
              </button>
              <button className="button" type="button" onClick={() => choose(draft)}>
                {text.save}
              </button>
              <button className="button" type="button" onClick={() => choose(EVERYTHING_ALLOWED)}>
                {text.allow}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
