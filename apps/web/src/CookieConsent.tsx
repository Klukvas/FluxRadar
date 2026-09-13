import { useEffect, useId, useState } from 'react';

import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_KEY,
  readCookieConsent,
  saveCookieConsent,
} from './browser-consent';
import { cookieCopy } from './cookie-copy';
import type { Language } from './i18n';
import './styles/cookie-consent.css';

type CookieConsentProps = { readonly language: Language };
const OPEN_SETTINGS_EVENT = 'fluxradar:open-cookie-settings';
const MAX_TIMEOUT_MS = 2_147_483_647;

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
  const text = cookieCopy[language];
  const [isOpen, setIsOpen] = useState(() => readCookieConsent() === null);
  // The floating launcher is there so a visitor can change their choice. Once
  // everything is allowed it only covers the page, so it steps aside; withdrawal
  // stays one click away on the cookie policy page every footer links to.
  const [isEverythingAllowed, setIsEverythingAllowed] = useState(
    () => readCookieConsent()?.preferences === true,
  );
  const [error, setError] = useState<'saveError' | 'languageError' | null>(null);

  useEffect(() => {
    let expiryTimer: number | undefined;
    const sync = () => {
      window.clearTimeout(expiryTimer);
      const consent = readCookieConsent();
      setIsOpen(consent === null);
      setIsEverythingAllowed(consent?.preferences === true);
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
    const open = () => setIsOpen(true);
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

  function choose(preferences: boolean): void {
    if (!saveCookieConsent(preferences)) {
      setIsOpen(true);
      setError('saveError');
      return;
    }
    if (preferences) {
      try {
        window.localStorage.setItem('fluxradar.language', language);
      } catch {
        saveCookieConsent(false);
        setIsOpen(true);
        setError('languageError');
        return;
      }
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
            <p>{text.duration}</p>
            <a href={`/cookies?lang=${language}`}>{text.details}</a>
            {error !== null && (
              <p className="cookie-consent__error" role="alert">
                {text[error]}
              </p>
            )}
            <div className="cookie-consent__actions">
              <button className="button" type="button" onClick={() => choose(false)}>
                {text.necessary}
              </button>
              <button className="button" type="button" onClick={() => choose(true)}>
                {text.allow}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
