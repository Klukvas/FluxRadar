import { useEffect, useId, useState } from 'react';

import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_KEY,
  EVERYTHING_ALLOWED,
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
 * What the checkboxes start from.
 *
 * Three cases, in order of how much the visitor has already said:
 *
 *   - A stored v2 record is their answer to both questions, so reopening the
 *     settings shows the choice they made rather than a blank form — and a
 *     refusal stays a refusal.
 *   - A v1 record predates the analytics category. The preferences permission
 *     it carries still stands; the question it never answered does not get
 *     answered on their behalf.
 *   - Nobody has chosen yet, so the form opens on the suggested answer: both
 *     categories ticked. This is a *draft* and nothing else — no storage is
 *     written and no analytics loaded until Save is pressed, which is the only
 *     thing that turns the form into a record.
 */
function standingChoice(): CookieConsentChoice {
  const consent = readCookieConsent();
  if (consent !== null) return { preferences: consent.preferences, analytics: consent.analytics };
  if (preferencesAllowed()) return { preferences: true, analytics: false };
  return EVERYTHING_ALLOWED;
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
  const allOptionalHintId = useId();
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
      // A failed save fires the change event too, and the `sync` it runs would
      // reset the form to "nothing chosen yet" — which is the suggested
      // everything-on draft. Someone whose refusal could not be written must
      // not find both boxes ticked again when they go to retry it.
      setDraft(choice);
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
  const allOptional = draft.preferences && draft.analytics;
  const someOptional = draft.preferences || draft.analytics;

  return (
    <>
      {showsLauncher && (
        // Alone, the launcher is only a way back to the settings; on a phone the
        // stylesheet takes it out of the floating dock and puts it at the foot of
        // the page, where it can no longer cover text or buttons.
        <div className="cookie-consent-dock cookie-consent-dock--launcher-only">
          <div className="cookie-settings-launcher">
            <CookieSettingsButton language={language} />
          </div>
        </div>
      )}
      {isOpen && (
        // Centred on the viewport rather than tucked into a corner: this asks
        // for a decision, and in the corner it read as a dismissible badge. The
        // layer stays click-through so it is still a nonmodal region — nothing
        // is trapped behind it and focus is not moved.
        <div className="cookie-consent-layer">
          <section className="cookie-consent" aria-labelledby={titleId}>
            <div className="cookie-consent__titlebar">
              <h2 id={titleId}>{text.title}</h2>
            </div>
            <div className="cookie-consent__body">
              <p>{text.description}</p>
              <fieldset className="cookie-consent__options">
                <legend>{text.optionalLegend}</legend>
                {/* One switch over both categories, in place of the
                    "only necessary" and "allow all" buttons that used to do the
                    same job from the action row. A button pair decided and
                    saved in one press; this states what is about to be saved
                    and leaves the saving to Save — and the two boxes under it
                    stay, so either category can still be chosen on its own. */}
                <Checkbox
                  className="cookie-consent__master"
                  label={text.allOptional}
                  checked={allOptional}
                  indeterminate={someOptional && !allOptional}
                  describedBy={allOptionalHintId}
                  onChange={(enabled) => setDraft({ preferences: enabled, analytics: enabled })}
                />
                <p id={allOptionalHintId} className="cookie-consent__hint">
                  {text.allOptionalHint}
                </p>
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
                <button className="button" type="button" onClick={() => choose(draft)}>
                  {text.save}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
